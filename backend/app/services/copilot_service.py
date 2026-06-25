"""F-800 Plan 1 — Forge Co-pilot service layer.

:class:`CopilotService` is the single business-logic surface that backs
the 7 Co-pilot REST endpoints (``backend/app/api/v1/copilot.py``). It
owns:

* Conversation lifecycle — create, continue, list, fetch, soft-delete.
* The chat-turn orchestration pipeline (per spec §3.1):
  1. Load or create the conversation (and its synthetic budget row).
  2. Load the recent message history (last 20).
  3. Assemble the message list for the LLM (system prompt + history +
     user turn + page context).
  4. Resolve tool specs from :data:`app.copilot.tools.registry.tool_registry`.
  5. Drive :meth:`LiteLLMClient.agent_loop` with a tool executor that
     delegates to :meth:`ToolRegistry.dispatch`.
  6. Persist user + assistant messages with the citation/tool-call
     JSON envelopes and per-turn cost telemetry.
  7. Write audit + emit event-bus events for the fanout pieces.
  8. Return the typed :class:`CopilotChatResponse` to the API layer.

Constitutional invariants
-------------------------

* Rule 1 — provider agnostic; LiteLLM client only.
* Rule 2 — every row carries ``tenant_id`` and ``project_id``.
* Rule 3 — human gates stay outside this layer; ``run_command`` /
  ``draft_artifact`` tools surface confirmation requests the API layer
  can render.
* Rule 6 — every write path calls :func:`audit_service.record`.
* Rule 7 — each turn opens an OpenTelemetry span.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.core.telemetry import get_tracer
from app.copilot.tools import tool_registry
from app.db.models.copilot import CopilotConversation, CopilotMessage
from app.schemas.copilot import (
    CopilotChatRequest,
    CopilotChatResponse,
    CopilotConversationRead,
    CopilotConversationSummary,
    CopilotCostRead,
    CopilotFeedbackRequest,
    CopilotMessageRead,
    CopilotToolCall,
    CopilotToolRead,
)
from app.services.audit_service import audit_service
from app.services.copilot_budget import (
    copilot_synthetic_workflow_id,
    ensure_conversation_budget,
)
from app.services.event_bus import EventType, bus as default_bus
from app.services.workflow_budget import BudgetExceeded

logger = get_logger(__name__)
_tracer = get_tracer("forge.copilot")


# History window — last N messages to feed back to the model on each
# turn. Matches the spec §3.1 "last 20 messages" budget.
_HISTORY_LIMIT = 20


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CopilotDisabled(RuntimeError):
    """Master toggle is off; surface as 404 at the API boundary."""


class CopilotToolDenied(RuntimeError):
    """The principal lacks the permission required for a tool call."""


class CopilotToolInvalidArgs(RuntimeError):
    """Tool arguments failed validation."""


class CopilotBudgetBlocked(BudgetExceeded):
    """Synthetic per-conversation budget exhausted.

    Inherits :class:`BudgetExceeded` so callers (and existing admission
    gates) can catch the broader type. The API layer additionally
    inspects this subclass to map to ``429 + Retry-After``.
    """


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class CopilotService:
    """Stateless orchestration for Co-pilot conversation endpoints.

    The class is intentionally light: every method takes a DB session
    (or uses the global session factory) so the API layer can keep
    FastAPI's per-request session lifecycle.

    Args:
        db: An open :class:`AsyncSession` owned by the request.
        principal: The authenticated caller.
        settings: The application settings (lazy-imported so the
            service can be instantiated in tests without the full
            Settings chain).
    """

    def __init__(
        self,
        *,
        db: AsyncSession,
        principal: AuthenticatedPrincipal,
    ) -> None:
        self._db = db
        self._principal = principal
        # Lazy so test code can patch :func:`get_settings` per-test.
        from app.core.config import settings

        self._settings = settings
        self._bus = default_bus

    # ------------------------------------------------------------------
    # Public surface — chat orchestration
    # ------------------------------------------------------------------

    async def chat(self, request: CopilotChatRequest) -> CopilotChatResponse:
        """Run one chat turn end-to-end and persist the transcript.

        See module docstring for the full pipeline.
        """
        start = time.perf_counter()
        with _tracer.start_as_current_span("copilot.turn") as turn_span:
            # 1. Conversation + budget.
            conversation, is_new = await self.get_or_create_conversation(
                conversation_id=request.conversation_id,
                project_id=request.project_id,
            )
            turn_span.set_attribute("conversation_id", str(conversation.id))
            turn_span.set_attribute("user_id", self._principal.user_id)
            turn_span.set_attribute(
                "tenant_id", str(self._principal.tenant_id)
            )
            turn_span.set_attribute(
                "project_id", str(conversation.project_id) if conversation.project_id else ""
            )

            workflow_id = copilot_synthetic_workflow_id(conversation.id)

            # 2. History.
            history = await self._load_history(conversation.id, limit=_HISTORY_LIMIT)

            # 3. Persist the user turn BEFORE the LLM call so a
            # mid-turn failure still has the user's question on record.
            user_message = CopilotMessage(
                conversation_id=conversation.id,
                tenant_id=conversation.tenant_id,
                role="user",
                content=request.message,
            )
            self._db.add(user_message)
            await self._db.flush()
            await self._audit_and_emit(
                action="copilot.message.recorded",
                target_type="copilot_message",
                target_id=str(user_message.id),
                payload={"role": "user", "conversation_id": str(conversation.id)},
                project_id=conversation.project_id,
                event_type=EventType.COPILOT_MESSAGE_RECORDED,
            )

            # 4 + 5. Tool specs + LLM loop.
            tool_specs: list[dict[str, Any]] = tool_registry.list_specs()

            messages = self._assemble_messages(history, request)

            async def _tool_executor(call: Any) -> Any:
                return await self._execute_tool(call, conversation)

            # Lazy import: the LiteLLM facade triggers an eager
            # ``app.integrations.litellm`` chain at import time, which
            # is fragile in test contexts that don't wire a real DB
            # engine. Defer to first use.
            from app.services.litellm_client import LiteLLMClient

            async with LiteLLMClient() as client:
                try:
                    response, tool_calls, tool_results = await client.agent_loop(
                        messages=messages,
                        tools=tool_specs,
                        tool_executor=_tool_executor,
                        max_turns=self._settings.copilot_tool_call_max,
                        tenant_id=self._principal.tenant_id,
                        project_id=conversation.project_id,
                        workflow_id=workflow_id,
                        actor_id=self._principal.user_id,
                    )
                except BudgetExceeded as exc:
                    await self._audit_and_emit(
                        action="copilot.budget.blocked",
                        target_type="copilot_conversation",
                        target_id=str(conversation.id),
                        payload={
                            "workflow_id": str(workflow_id),
                            "spent_usd": exc.spent,
                            "ceiling_usd": exc.ceiling,
                        },
                        project_id=conversation.project_id,
                        event_type=EventType.COPILOT_BUDGET_BLOCKED,
                    )
                    raise

            assistant_text = self._extract_assistant_text(response)
            tool_call_records = self._build_tool_call_records(tool_calls, tool_results)
            tokens_in, tokens_out, cost_usd = self._extract_usage(response)

            # 6. Persist assistant message.
            assistant_message = CopilotMessage(
                conversation_id=conversation.id,
                tenant_id=conversation.tenant_id,
                role="assistant",
                content=assistant_text,
                tool_calls=[r.model_dump() for r in tool_call_records] or None,
                citations=self._extract_citations(tool_results),
                suggested_actions=self._extract_suggested_actions(tool_results),
                confidence=self._infer_confidence(tool_results, assistant_text),
                model=self._settings.litellm_default_model,
                cost_usd=cost_usd,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=int((time.perf_counter() - start) * 1000),
            )
            self._db.add(assistant_message)
            conversation.message_count = (conversation.message_count or 0) + 2
            conversation.total_cost_usd = float(
                Decimal(str(conversation.total_cost_usd or 0)) + Decimal(str(cost_usd))
            )
            conversation.total_tokens_in = (conversation.total_tokens_in or 0) + tokens_in
            conversation.total_tokens_out = (conversation.total_tokens_out or 0) + tokens_out
            await self._db.flush()

            await self._audit_and_emit(
                action="copilot.message.recorded",
                target_type="copilot_message",
                target_id=str(assistant_message.id),
                payload={
                    "role": "assistant",
                    "conversation_id": str(conversation.id),
                    "tool_call_count": len(tool_call_records),
                },
                project_id=conversation.project_id,
                event_type=EventType.COPILOT_MESSAGE_RECORDED,
            )
            if cost_usd > 0:
                await self._audit_and_emit(
                    action="copilot.cost.incurred",
                    target_type="copilot_conversation",
                    target_id=str(conversation.id),
                    payload={
                        "message_id": str(assistant_message.id),
                        "cost_usd": float(cost_usd),
                        "tokens_in": tokens_in,
                        "tokens_out": tokens_out,
                    },
                    project_id=conversation.project_id,
                    event_type=EventType.COPILOT_COST_INCURRED,
                )

            latency_ms = int((time.perf_counter() - start) * 1000)
            turn_span.set_attribute("tool_count", len(tool_call_records))
            turn_span.set_attribute("total_cost_usd", float(cost_usd))
            turn_span.set_attribute("latency_ms", latency_ms)
            turn_span.set_attribute(
                "model", self._settings.litellm_default_model
            )

            return CopilotChatResponse(
                conversation_id=conversation.id,
                message_id=assistant_message.id,
                content=assistant_text,
                citations=self._extract_citations(tool_results),
                confidence=assistant_message.confidence or "medium",
                tool_calls=tool_call_records,
                suggested_actions=self._extract_suggested_actions(tool_results),
                cost_usd=Decimal(str(cost_usd)),
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=self._settings.litellm_default_model,
                latency_ms=latency_ms,
            )

    # ------------------------------------------------------------------
    # Public surface — conversation lifecycle
    # ------------------------------------------------------------------

    async def get_or_create_conversation(
        self,
        *,
        conversation_id: UUID | None,
        project_id: UUID | None,
        title: str | None = None,
    ) -> tuple[CopilotConversation, bool]:
        """Find an existing conversation or create one.

        Returns ``(conversation, is_new)``. The synthetic
        :class:`WorkflowBudget` is created on first turn via
        :func:`ensure_conversation_budget`.

        Raises:
            LookupError: The conversation id does not exist OR belongs
                to a different user (we collapse both into 404 to avoid
                leaking existence).
        """
        if conversation_id is not None:
            stmt = select(CopilotConversation).where(
                CopilotConversation.id == conversation_id,
                CopilotConversation.tenant_id == self._principal.tenant_id,
                CopilotConversation.user_id == self._principal.user_id,
            )
            conversation = (await self._db.execute(stmt)).scalar_one_or_none()
            if conversation is None:
                raise LookupError(f"conversation {conversation_id} not found")
            # Make sure the budget row exists for legacy rows.
            await ensure_conversation_budget(self._db, conversation)
            await self._db.flush()
            return conversation, False

        conversation = CopilotConversation(
            tenant_id=self._principal.tenant_id,
            project_id=project_id,
            user_id=self._principal.user_id,
            title=title,
        )
        self._db.add(conversation)
        await self._db.flush()
        await ensure_conversation_budget(self._db, conversation)
        await self._db.flush()

        await self._audit_and_emit(
            action="copilot.conversation.created",
            target_type="copilot_conversation",
            target_id=str(conversation.id),
            payload={
                "title": title,
                "project_id": str(project_id) if project_id else None,
            },
            project_id=project_id,
            event_type=EventType.COPILOT_CONVERSATION_CREATED,
        )
        return conversation, True

    async def list_conversations(
        self, *, limit: int = 50, offset: int = 0
    ) -> list[CopilotConversationSummary]:
        """List the caller's conversations in the tenant."""
        stmt = (
            select(CopilotConversation)
            .where(
                CopilotConversation.tenant_id == self._principal.tenant_id,
                CopilotConversation.user_id == self._principal.user_id,
                CopilotConversation.archived_at.is_(None),
            )
            .order_by(CopilotConversation.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await self._db.execute(stmt)).scalars().all()
        return [
            CopilotConversationSummary(
                id=row.id,
                tenant_id=row.tenant_id,
                user_id=row.user_id,
                title=row.title,
                message_count=row.message_count or 0,
                total_cost_usd=Decimal(str(row.total_cost_usd or 0)),
                archived_at=row.archived_at,
            )
            for row in rows
        ]

    async def get_conversation(
        self, conversation_id: UUID
    ) -> CopilotConversationRead:
        """Load a single conversation (with messages) for the caller.

        Raises:
            LookupError: Not found OR belongs to another user (collapsed
                into 404 to avoid leaking existence).
        """
        stmt = select(CopilotConversation).where(
            CopilotConversation.id == conversation_id,
            CopilotConversation.tenant_id == self._principal.tenant_id,
            CopilotConversation.user_id == self._principal.user_id,
        )
        conversation = (await self._db.execute(stmt)).scalar_one_or_none()
        if conversation is None:
            raise LookupError(f"conversation {conversation_id} not found")

        msg_stmt = (
            select(CopilotMessage)
            .where(CopilotMessage.conversation_id == conversation.id)
            .order_by(CopilotMessage.created_at.asc())
        )
        messages = (await self._db.execute(msg_stmt)).scalars().all()

        return CopilotConversationRead(
            id=conversation.id,
            tenant_id=conversation.tenant_id,
            user_id=conversation.user_id,
            title=conversation.title,
            message_count=conversation.message_count or 0,
            total_cost_usd=Decimal(str(conversation.total_cost_usd or 0)),
            total_tokens_in=conversation.total_tokens_in or 0,
            total_tokens_out=conversation.total_tokens_out or 0,
            messages=[self._message_to_read(m) for m in messages],
            archived_at=conversation.archived_at,
        )

    async def delete_conversation(self, conversation_id: UUID) -> None:
        """Soft-delete the caller's conversation."""
        stmt = select(CopilotConversation).where(
            CopilotConversation.id == conversation_id,
            CopilotConversation.tenant_id == self._principal.tenant_id,
            CopilotConversation.user_id == self._principal.user_id,
        )
        conversation = (await self._db.execute(stmt)).scalar_one_or_none()
        if conversation is None:
            raise LookupError(f"conversation {conversation_id} not found")
        conversation.archived_at = datetime.now(timezone.utc)
        await self._db.flush()
        await audit_service.record(
            tenant_id=conversation.tenant_id,
            project_id=conversation.project_id,
            actor_id=self._principal.user_id,
            action="copilot.conversation.deleted",
            target_type="copilot_conversation",
            target_id=str(conversation.id),
            payload={},
        )

    async def submit_feedback(
        self, message_id: UUID, request: CopilotFeedbackRequest
    ) -> None:
        """Record a thumbs-up/down + comment on an assistant message."""
        stmt = (
            select(CopilotMessage, CopilotConversation)
            .join(CopilotConversation, CopilotMessage.conversation_id == CopilotConversation.id)
            .where(
                CopilotMessage.id == message_id,
                CopilotConversation.tenant_id == self._principal.tenant_id,
                CopilotConversation.user_id == self._principal.user_id,
            )
        )
        row = (await self._db.execute(stmt)).first()
        if row is None:
            raise LookupError(f"message {message_id} not found")
        message, conversation = row
        message.feedback_rating = request.rating
        message.feedback_comment = request.comment
        message.feedback_at = datetime.now(timezone.utc)
        await self._db.flush()
        await audit_service.record(
            tenant_id=conversation.tenant_id,
            project_id=conversation.project_id,
            actor_id=self._principal.user_id,
            action="copilot.feedback_submitted",
            target_type="copilot_message",
            target_id=str(message.id),
            payload={
                "rating": request.rating,
                "comment": request.comment,
                "conversation_id": str(conversation.id),
            },
        )

    async def list_tools(self) -> list[CopilotToolRead]:
        """Return metadata for every registered tool (Steward-facing)."""
        out: list[CopilotToolRead] = []
        for tool in tool_registry.list_tools():
            out.append(
                CopilotToolRead(
                    name=tool.name,
                    description=tool.description,
                    permission=tool.permission,
                    rate_limit_per_min=tool.rate_limit_per_min,
                )
            )
        return out

    async def get_conversation_cost(
        self, conversation_id: UUID
    ) -> CopilotCostRead:
        """Return running cost + budget status for the conversation."""
        stmt = select(CopilotConversation).where(
            CopilotConversation.id == conversation_id,
            CopilotConversation.tenant_id == self._principal.tenant_id,
            CopilotConversation.user_id == self._principal.user_id,
        )
        conversation = (await self._db.execute(stmt)).scalar_one_or_none()
        if conversation is None:
            raise LookupError(f"conversation {conversation_id} not found")

        budget_snapshot = await self._load_budget_snapshot(conversation)
        budget_remaining_usd = (
            Decimal(str(budget_snapshot["remaining_usd"]))
            if budget_snapshot
            else None
        )
        budget_ceiling_usd = (
            Decimal(str(budget_snapshot["ceiling_usd"]))
            if budget_snapshot
            else None
        )
        budget_status = (
            budget_snapshot["status"] if budget_snapshot else None
        )

        return CopilotCostRead(
            conversation_id=conversation.id,
            total_cost_usd=Decimal(str(conversation.total_cost_usd or 0)),
            total_tokens_in=conversation.total_tokens_in or 0,
            total_tokens_out=conversation.total_tokens_out or 0,
            budget_remaining_usd=budget_remaining_usd,
            budget_ceiling_usd=budget_ceiling_usd,
            budget_status=budget_status,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _load_history(
        self, conversation_id: UUID, *, limit: int
    ) -> list[CopilotMessage]:
        stmt = (
            select(CopilotMessage)
            .where(CopilotMessage.conversation_id == conversation_id)
            .order_by(CopilotMessage.created_at.desc())
            .limit(limit)
        )
        rows = list((await self._db.execute(stmt)).scalars().all())
        rows.reverse()
        return rows

    def _assemble_messages(
        self,
        history: list[CopilotMessage],
        request: CopilotChatRequest,
    ) -> list[dict[str, Any]]:
        """Build the OpenAI-shaped message list for the LLM.

        Order: [system, ...history (chronological), user turn with
        page-context instructions].
        """
        system_prompt = self._build_system_prompt(request)
        out: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for msg in history:
            out.append({"role": msg.role, "content": msg.content})
        out.append({"role": "user", "content": request.message})
        return out

    def _build_system_prompt(self, request: CopilotChatRequest) -> str:
        recent = ", ".join(request.context.recent_actions[-5:]) or "none"
        page = request.context.current_page
        center = request.context.current_center or "unknown"
        artifact = str(request.context.current_artifact_id) if request.context.current_artifact_id else "none"
        return (
            "You are Forge Co-pilot, an in-product AI assistant for the "
            "Forge platform. Ground every answer in tool results; cite "
            "sources via the citation tool output. For command "
            "proposals, ALWAYS use run_command (never propose raw shell). "
            "For draft artifacts, ALWAYS use draft_artifact (creates "
            "DRAFT for human review).\n\n"
            f"Current page: {page}\n"
            f"Current center: {center}\n"
            f"Open artifact: {artifact}\n"
            f"Recent actions: {recent}"
        )

    async def _execute_tool(self, call: Any, conversation: CopilotConversation) -> Any:
        """Dispatch a single tool call through the registry.

        Wraps the registry's exception types into the LiteLLM-shaped
        :class:`ToolResult` the agent loop expects. Errors are surfaced
        to the model as ``is_error=True`` rows so it can recover.
        """
        from app.services._litellm_tools import ToolResult

        try:
            args = json.loads(call.arguments_json or "{}")
        except json.JSONDecodeError:
            args = {}

        with _tracer.start_as_current_span(f"copilot.tool.{call.name}") as span:
            span.set_attribute("tool", call.name)
            span.set_attribute("conversation_id", str(conversation.id))
            try:
                result = await tool_registry.dispatch(
                    name=call.name,
                    args=args,
                    principal=self._principal,
                    tenant_id=self._principal.tenant_id,
                    project_id=conversation.project_id,
                )
                payload = json.dumps(result, default=str)
                tool_result = ToolResult(
                    tool_call_id=call.id,
                    name=call.name,
                    content=payload,
                    is_error=False,
                )
            except Exception as exc:  # noqa: BLE001 — broad on purpose
                logger.warning(
                    "copilot.tool.failed",
                    tool=call.name,
                    conversation_id=str(conversation.id),
                    error=str(exc),
                )
                tool_result = ToolResult(
                    tool_call_id=call.id,
                    name=call.name,
                    content=f"tool failed: {exc}",
                    is_error=True,
                )
                span.set_attribute("error", str(exc))
                await self._audit_and_emit(
                    action="copilot.tool.failed",
                    target_type="copilot_tool",
                    target_id=call.name,
                    payload={
                        "conversation_id": str(conversation.id),
                        "tool_call_id": call.id,
                        "error": str(exc),
                    },
                    project_id=conversation.project_id,
                    event_type=EventType.COPILOT_TOOL_EXECUTED,
                )
                return tool_result

        await self._audit_and_emit(
            action="copilot.tool.executed",
            target_type="copilot_tool",
            target_id=call.name,
            payload={
                "conversation_id": str(conversation.id),
                "tool_call_id": call.id,
                "args": args,
            },
            project_id=conversation.project_id,
            event_type=EventType.COPILOT_TOOL_EXECUTED,
        )
        return tool_result

    @staticmethod
    def _extract_assistant_text(response: dict[str, Any]) -> str:
        try:
            choices = response.get("choices") or []
            if not choices:
                return ""
            return (choices[0].get("message") or {}).get("content") or ""
        except (AttributeError, TypeError):  # pragma: no cover — defensive
            return ""

    @staticmethod
    def _extract_usage(response: dict[str, Any]) -> tuple[int, int, float]:
        usage = response.get("usage") or {}
        tokens_in = int(usage.get("prompt_tokens", 0))
        tokens_out = int(usage.get("completion_tokens", 0))
        cost_usd = float(
            response.get("cost_usd") or usage.get("cost_usd") or 0.0
        )
        return tokens_in, tokens_out, cost_usd

    @staticmethod
    def _build_tool_call_records(
        calls: list[Any], results: list[Any]
    ) -> list[CopilotToolCall]:
        """Pair :class:`ToolCall` rows with their :class:`ToolResult` rows."""
        out: list[CopilotToolCall] = []
        by_id: dict[str, Any] = {r.tool_call_id: r for r in results}
        for call in calls:
            result = by_id.get(call.id)
            try:
                args = json.loads(call.arguments_json or "{}")
            except json.JSONDecodeError:
                args = {}
            out.append(
                CopilotToolCall(
                    tool=call.name,
                    args=args,
                    result_status="error" if (result and result.is_error) else "success",
                    duration_ms=0,
                    error=str(result.content) if result and result.is_error else None,
                )
            )
        return out

    @staticmethod
    def _extract_citations(results: list[Any]) -> list[dict[str, Any]]:
        """Pull citation-shaped rows out of tool results.

        Tools that surface citations return a ``citations`` key inside
        their result dict. We aggregate them in tool-call order so the
        UI sees a single canonical list.
        """
        out: list[dict[str, Any]] = []
        for result in results:
            if result is None or getattr(result, "is_error", False):
                continue
            try:
                payload = json.loads(result.content or "{}")
            except json.JSONDecodeError:
                continue
            for c in payload.get("citations") or []:
                if isinstance(c, dict):
                    out.append(c)
        return out

    @staticmethod
    def _extract_suggested_actions(results: list[Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for result in results:
            if result is None or getattr(result, "is_error", False):
                continue
            try:
                payload = json.loads(result.content or "{}")
            except json.JSONDecodeError:
                continue
            for action in payload.get("suggested_actions") or []:
                if isinstance(action, dict):
                    out.append(action)
        return out

    @staticmethod
    def _infer_confidence(
        results: list[Any], assistant_text: str
    ) -> str:
        if not assistant_text:
            return "low"
        if any(getattr(r, "is_error", False) for r in results):
            return "low"
        if len(assistant_text) < 40:
            return "medium"
        return "high"

    async def _load_budget_snapshot(
        self, conversation: CopilotConversation
    ) -> dict[str, Any] | None:
        from app.services.workflow_budget import workflow_budget_service

        snapshot = await workflow_budget_service.get_budget(
            copilot_synthetic_workflow_id(conversation.id)
        )
        if snapshot is None:
            return None
        return snapshot.to_dict()

    async def _audit_and_emit(
        self,
        *,
        action: str,
        target_type: str,
        target_id: str,
        payload: dict[str, Any],
        project_id: UUID | None,
        event_type: EventType,
    ) -> None:
        """Best-effort audit + event publish — never fails the caller."""
        try:
            await audit_service.record(
                tenant_id=self._principal.tenant_id,
                project_id=project_id,
                actor_id=self._principal.user_id,
                action=action,
                target_type=target_type,
                target_id=target_id,
                payload=payload,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "copilot.audit_failed",
                action=action,
                error=str(exc),
            )
        try:
            await self._bus.publish(
                event_type,
                payload,
                tenant_id=self._principal.tenant_id,
                project_id=project_id,
                actor_id=self._principal.user_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "copilot.event_publish_failed",
                event_type=event_type.value,
                error=str(exc),
            )

    @staticmethod
    def _message_to_read(message: CopilotMessage) -> CopilotMessageRead:
        return CopilotMessageRead(
            id=message.id,
            conversation_id=message.conversation_id,
            role=message.role,  # type: ignore[arg-type]
            content=message.content,
            citations=list(message.citations or []),  # type: ignore[arg-type]
            tool_calls=list(message.tool_calls or []),  # type: ignore[arg-type]
            suggested_actions=list(message.suggested_actions or []),  # type: ignore[arg-type]
            confidence=message.confidence,  # type: ignore[arg-type]
            feedback_rating=message.feedback_rating,  # type: ignore[arg-type]
            model=message.model,
            cost_usd=Decimal(str(message.cost_usd or 0)),
            tokens_in=message.tokens_in or 0,
            tokens_out=message.tokens_out or 0,
            latency_ms=message.latency_ms or 0,
            created_at=message.created_at,
        )


__all__ = [
    "CopilotService",
    "CopilotDisabled",
    "CopilotToolDenied",
    "CopilotToolInvalidArgs",
    "CopilotBudgetBlocked",
]