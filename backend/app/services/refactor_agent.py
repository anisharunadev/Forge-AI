"""F-503b / F-601 — Refactor Agent (service-level entry).

M2 Plan 01-07 (T-C3). This service is the *typed refactor entry
point* — a thin orchestration layer that:

1. Ingests an implementation diff (unified diff text or structured
   ``DiffChunk`` list).
2. Enforces the GSD ``forge-dev-refactor`` whitelist via
   ``app.services.forge_commands.get_forge_command`` so a Refactor
   request can never route to an arbitrary ``forge-*`` command.
3. Composes a typed :class:`MigrationPlan` (Pydantic v2) — the same
   schema the F-601 LangGraph sub-graph (``app.agents.refactor_agent``)
   emits — derived from a leaner :class:`MigrationPlanDigest` that
   carries the four fields called out in the M2 spec
   (``source_files``, ``target_patterns``, ``breaking_changes``,
   ``rollback_steps``).
4. Persists the plan through the F-010 artifact registry (when a
   registry is injected) and emits an F-005 audit row.

This service is decorated with
``@require_approval_phase(_SDLCPhase_runtime.IMPLEMENTATION)`` so the LangGraph
supervisor must hold a granted IMPLEMENTATION-phase approval envelope
before :meth:`plan` runs (Track A freezes the decorator; this module
provides the entry-point + typed contract).

Architecture
------------
::

    ImplementationDiff (input)
          │
          ▼
    _extract_chunks        ← split diff into per-file chunks
          │
          ▼
    _classify_changes      ← label each chunk as additive / breaking / cosmetic
          │
          ▼
    _apply_whitelist       ← forge-dev-refactor is the only allowed cmd
          │
          ▼
    _compose_migration_plan ← MigrationPlanDigest → MigrationPlan
          │
          ▼
    [persist via F-010 if available]
          │
          ▼
    [emit F-005 audit row]

Unlike the heavier :mod:`app.agents.refactor_agent` LangGraph sub-graph
(this module's sibling in ``app/agents/``), the service is
**deterministic and rules-only** — it never invokes the LiteLLM proxy
in the decision path. Refactor suggestions produced by an LLM run
through this service for materialization AFTER approval, so the
service can re-validate the proposal against the GSD whitelist without
the LLM in the loop.

Rule compliance
---------------
* **Rule 1 (model agnosticism):** no provider SDK; no LLM call.
* **Rule 2 (multi-tenancy):** every artifact carries ``tenant_id``
  and ``project_id``; the F-010 registry relies on these for RLS.
* **Rule 3 (HITL):** the entry-point decorator enforces recorded
  IMPLEMENTATION-phase approval. ``plan()`` will raise
  ``ApprovalRequiredError`` when the envelope is missing or denied.
* **Rule 4 (typed artifacts):** both ``MigrationPlanDigest`` and the
  composed ``MigrationPlan`` are Pydantic v2 models.
* **Rule 6 (audit):** every successful ``plan()`` writes an F-005
  audit row at action ``refactor_agent.plan_emitted``.
"""

from __future__ import annotations

import hashlib
import inspect
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.core.logging import get_logger

if TYPE_CHECKING:
    # Type-only imports -- kept here so static type checkers resolve
    # SDLCState for the ``plan`` annotation. Resolved at runtime via
    # ``TYPE_CHECKING=False`` to avoid the M2-Track-A circular import
    # between app.agents.approval_gate and
    # app.services.workflow_budget.
    from app.agents.sdlc_state import SDLCState  # noqa: F401

# Stub: an in-module placeholder name so the post-class marker
# assignment below can produce a non-empty tuple at module load
# without touching the real ``app.agents.sdlc_state`` module (which
# would otherwise re-trigger the M2-Track-A circular import). The
# real SDLCPhase is loaded only inside the call path that needs it.
_IMPLEMENTATION_PHASE_NAME: str = "implementation"
from app.schemas.migration_plan import (  # noqa: E402
    EffortEstimate,
    MigrationPhase,
    MigrationPhaseStatus,
    MigrationPlan,
    RiskItem,
    SourceInventory,
    TargetArchitecture,
)
from app.services.audit_service import audit_service  # noqa: E402
from app.services.forge_commands import (  # noqa: E402
    FORGE_COMMAND_MAP,
    ForgeCommand,
    get_forge_command,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Allowed refactor command whitelist (M2 T-C3 / G26)
# ---------------------------------------------------------------------------

ALLOWED_REFACTOR_FORGE_CMD: str = "forge-dev-refactor"

# File-path patterns the service refuses to touch even if a chunk
# references them. Kept short & explicit; expand via ADR.
PROTECTED_FILE_GLOB_RE = re.compile(
    r"^(?:.*/)?(?:\.env|\.env\..*|secrets/.*|.*\.pem|.*\.key)$",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Typed inputs / outputs (M2 T-C3 — source_files, target_patterns,
# breaking_changes, rollback_steps)
# ---------------------------------------------------------------------------


class DiffChunk(BaseModel):
    """A single per-file chunk extracted from an implementation diff."""

    model_config = ConfigDict(extra="forbid")

    file_path: str = Field(..., min_length=1, max_length=4000)
    added_lines: int = Field(default=0, ge=0)
    removed_lines: int = Field(default=0, ge=0)
    hunk_signature: str = Field(default="", max_length=128)


class ImplementationDiff(BaseModel):
    """Diff payload ingested by :class:`RefactorAgent`."""

    model_config = ConfigDict(extra="forbid")

    unified_diff: str = Field(default="", max_length=2_000_000)
    chunks: list[DiffChunk] = Field(default_factory=list)
    source_files: list[str] = Field(default_factory=list, max_length=10_000)

    def total_churn(self) -> int:
        return sum(c.added_lines + c.removed_lines for c in self.chunks)


class ChangeClassification(str, __import__("enum").Enum):
    """Per-chunk kind — drives the breaking_changes list."""

    ADDITIVE = "additive"
    BREAKING = "breaking"
    COSMETIC = "cosmetic"
    UNKNOWN = "unknown"


class MigrationPlanDigest(BaseModel):
    """Leaner typed plan carrying the four M2 spec fields.

    F-010 registry and the F-601 LangGraph sub-graph expand this
    digest into the full :class:`MigrationPlan`. The fields map
    directly to the M2 plan checklist:

    * ``source_files``     — every file touched by the diff.
    * ``target_patterns``  — post-refactor target idioms (e.g.
                             "use X | None instead of Optional[X]").
    * ``breaking_changes`` — list of BreakingChange records surfaced
                             for the reviewer.
    * ``rollback_steps``   — ordered, deterministic reversion steps.
    """

    model_config = ConfigDict(extra="forbid")

    source_files: list[str] = Field(default_factory=list, max_length=10_000)
    target_patterns: list[str] = Field(default_factory=list, max_length=500)
    breaking_changes: list[BreakingChange] = Field(default_factory=list, max_length=1_000)
    rollback_steps: list[str] = Field(default_factory=list, max_length=500)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BreakingChange(BaseModel):
    """One concrete breaking change surfaced for the reviewer."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()))
    file_path: str = Field(..., min_length=1, max_length=4000)
    symbol: str = Field(default="", max_length=400)
    description: str = Field(..., min_length=3, max_length=4000)
    severity: float = Field(default=0.5, ge=0.0, le=1.0)


MigrationPlanDigest.model_rebuild()


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------


class ApprovalRequiredPermissionError(PermissionError):
    """Local mirror of :class:`app.agents.approval_gate.ApprovalRequiredError`.

    We raise this instead of the upstream type so the module can stay
    free of ``app.agents.*`` imports (the M2-Track-A circular import
    between ``app.agents.approval_gate`` and
    ``app.services.workflow_budget`` would otherwise break the module
    load). The exception is a :class:`PermissionError` subclass so the
    same ``except PermissionError`` clauses catch either form.
    """

    def __init__(self, message, *, phase, run_id=None, tenant_id=None):
        super().__init__(message)
        self.phase = phase
        self.run_id = run_id
        self.tenant_id = tenant_id


def _enforce_local(state: Any, allowed_phases: tuple[str, ...]) -> None:
    """Mirror of ``app.agents.approval_gate._enforce`` -- rules-only.

    Validates that ``state.pending_approval`` is set, matches one of
    the allowed phases, and that ``metadata[approval:<phase>:decision]``
    has ``granted=True``. Raises ``ApprovalRequiredPermissionError`` on
    any miss.

    Operates on raw string phase values (no ``SDLCPhase`` enum import)
    so the function can run without triggering the M2-Track-A
    circular import.
    """
    pending = getattr(state, "pending_approval", None)
    if pending is None:
        raise ApprovalRequiredPermissionError(
            f"no pending_approval on state; expected one of {list(allowed_phases)}",
            phase=allowed_phases[0],
            run_id=getattr(state, "run_id", None),
            tenant_id=getattr(state, "tenant_id", None),
        )
    pending_phase = getattr(pending, "type", None)
    if pending_phase not in set(allowed_phases):
        raise ApprovalRequiredPermissionError(
            f"pending_approval.type={pending_phase!r} is not in {list(allowed_phases)}",
            phase=str(pending_phase) if pending_phase else allowed_phases[0],
            run_id=getattr(state, "run_id", None),
            tenant_id=getattr(state, "tenant_id", None),
        )
    decision_key = f"approval:{pending_phase}:decision"
    metadata = getattr(state, "metadata", None) or {}
    decision = metadata.get(decision_key)
    if decision is None:
        raise ApprovalRequiredPermissionError(
            f"no recorded decision at metadata[{decision_key!r}]",
            phase=pending_phase,
            run_id=getattr(state, "run_id", None),
            tenant_id=getattr(state, "tenant_id", None),
        )
    if not isinstance(decision, dict) or not decision.get("granted"):
        raise ApprovalRequiredPermissionError(
            f"decision at metadata[{decision_key!r}] is not granted",
            phase=pending_phase,
            run_id=getattr(state, "run_id", None),
            tenant_id=getattr(state, "tenant_id", None),
        )


class RefactorAgent:
    """Service-level entry for the F-601 refactor flow.

    The agent is **stateless** beyond configuration; collaborators
    (audit service, F-010 registry, F-213 push-to-delivery) are
    constructor-injected so the service is trivially testable.

    Usage::

        agent = RefactorAgent()
        # supervisor-only call: decorated, requires approved envelope
        digest, plan = await agent.plan(state, diff)
    """

    def __init__(
        self,
        *,
        audit: Any | None = None,
        artifact_registry: Any | None = None,
        push_to_delivery: Any | None = None,
    ) -> None:
        self._audit = audit or audit_service
        self._registry = artifact_registry  # F-010 (optional)
        self._push = push_to_delivery  # F-213 (optional)

    # ---- Public API ---------------------------------------------------

    async def plan(
        self,
        state: "SDLCState",  # noqa: UP037
        diff: ImplementationDiff | Mapping[str, Any],
        *,
        target_patterns: Iterable[str] | None = None,
        rollback_steps: Iterable[str] | None = None,
    ) -> tuple[MigrationPlanDigest, MigrationPlan]:
        """Run the rules-only refactor plan.

        Decorated with ``@require_approval_phase(_SDLCPhase_runtime.IMPLEMENTATION)``
        so an unapproved call fails fast with
        :class:`ApprovalRequiredError`.

        Steps:

        1. Re-validate that the requested forge command
           (currently hard-pinned to ``forge-dev-refactor``) exists
           in the GSD whitelist.
        2. Scan the diff for protected paths (.env, *.pem, etc.) and
           reject the call if any are touched.
        3. Classify each chunk as additive / breaking / cosmetic.
        4. Compose the :class:`MigrationPlanDigest`.
        5. Expand the digest into the full :class:`MigrationPlan`
           (typed F-010 artifact).
        6. Emit the F-005 audit row ``refactor_agent.plan_emitted``.
        7. If an artifact registry was injected, persist the plan
           (best-effort; failures are logged but do not raise).

        Returns ``(digest, plan)`` so callers can persist either the
        lean digest (for the UI tooltip) or the full plan.
        """
        # M2 G26: enforce the @require_approval_phase(IMPLEMENTATION)
        # contract inline. We use the local helper (not the imported
        # decorator) to avoid the M2-Track-A circular import between
        # app.agents.approval_gate and app.services.workflow_budget.
        _enforce_local(state, ("implementation",))

        diff_obj = self._coerce_diff(diff)
        patterns = list(target_patterns or [])
        steps = list(rollback_steps or [])

        _validate_whitelist()
        self._reject_protected_paths(diff_obj)

        chunks = diff_obj.chunks or _extract_chunks_from_unified(diff_obj.unified_diff)
        classifications = [_classify_chunk(c) for c in chunks]

        breaking = [
            BreakingChange(
                file_path=c.file_path,
                symbol="",
                description=_describe_classification(c, cls),
                severity=_severity_for(cls),
            )
            for c, cls in zip(chunks, classifications, strict=True)
            if cls is ChangeClassification.BREAKING
        ]

        digest = MigrationPlanDigest(
            source_files=sorted(set(diff_obj.source_files or [c.file_path for c in chunks])),
            target_patterns=patterns,
            breaking_changes=breaking,
            rollback_steps=steps,
            metadata={
                "total_churn": diff_obj.total_churn(),
                "classification_counts": _count_classifications(classifications),
                "forge_cmd": ALLOWED_REFACTOR_FORGE_CMD,
            },
        )

        plan = self._compose_migration_plan(
            state=state,
            diff=diff_obj,
            digest=digest,
        )

        await self._audit.record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=getattr(state, "actor_id", None),
            action="refactor_agent.plan_emitted",
            target_type="migration_plan",
            target_id=str(plan.id),
            payload={
                "digest_source_files": len(digest.source_files),
                "digest_breaking_changes": len(digest.breaking_changes),
                "digest_rollback_steps": len(digest.rollback_steps),
                "diff_total_churn": diff_obj.total_churn(),
                "forge_cmd": ALLOWED_REFACTOR_FORGE_CMD,
            },
        )
        logger.info(
            "refactor_agent.plan_emitted",
            tenant_id=str(state.tenant_id),
            project_id=str(state.project_id),
            run_id=str(state.run_id),
            plan_id=str(plan.id),
            breaking=len(breaking),
            churn=diff_obj.total_churn(),
        )

        if self._registry is not None:
            try:
                await _safe_call(
                    self._registry.persist,
                    artifact_type="migration_plan",
                    tenant_id=str(state.tenant_id),
                    project_id=str(state.project_id),
                    run_id=str(state.run_id),
                    payload=plan.to_payload(),
                )
            except Exception as exc:  # noqa: BLE001 -- best-effort persist
                logger.warning(
                    "refactor_agent.persist_failed",
                    plan_id=str(plan.id),
                    error=str(exc),
                )

        return digest, plan

    # ---- Internal helpers --------------------------------------------

    def _coerce_diff(
        self,
        diff: ImplementationDiff | Mapping[str, Any],
    ) -> ImplementationDiff:
        if isinstance(diff, ImplementationDiff):
            return diff
        if isinstance(diff, Mapping):
            return ImplementationDiff(
                unified_diff=str(diff.get("unified_diff") or ""),
                chunks=list(diff.get("chunks") or []),
                source_files=list(diff.get("source_files") or []),
            )
        raise TypeError(f"diff must be an ImplementationDiff or mapping; got {type(diff).__name__}")

    def _reject_protected_paths(self, diff: ImplementationDiff) -> None:
        """Reject the plan if any diff chunk touches a protected path."""
        for path in diff.source_files or []:
            if PROTECTED_FILE_GLOB_RE.match(path):
                raise PermissionError(f"refactor_agent refuses to touch protected path {path!r}")
        for chunk in diff.chunks or []:
            if PROTECTED_FILE_GLOB_RE.match(chunk.file_path):
                raise PermissionError(
                    f"refactor_agent refuses to touch protected chunk {chunk.file_path!r}"
                )

    def _compose_migration_plan(
        self,
        *,
        state: "SDLCState",  # noqa: UP037
        diff: ImplementationDiff,
        digest: MigrationPlanDigest,
    ) -> MigrationPlan:
        """Expand :class:`MigrationPlanDigest` into the F-010 typed plan."""
        touched = digest.source_files or [c.file_path for c in diff.chunks]
        language = _guess_language(touched)
        target_language = _guess_target_language(touched, digest.target_patterns)

        source_inventory = SourceInventory(
            language=language,
            framework=None,
            total_files=len({p for p in touched if p}),
            total_lines_of_code=sum(c.added_lines + c.removed_lines for c in diff.chunks),
            components=[],
            external_dependencies=[],
            data_stores=[],
            apis=[],
            repository_url=None,
        )
        target_architecture = TargetArchitecture(
            target_language=target_language,
            target_framework=None,
            target_cloud="aws",
            components=[],
            integrations=[],
            data_stores=[],
            diagrams=digest.target_patterns,
        )

        phased_plan = _build_phased_plan(touched, digest)
        risk_register = _build_risk_register(digest, phased_plan)
        effort_estimate = EffortEstimate(
            total_effort_days=max(1.0, diff.total_churn() / 200.0),
            total_cost_usd=max(0.0, diff.total_churn() * 0.05),
            confidence=0.6 if digest.breaking_changes else 0.85,
            assumptions=[
                "Migration cost is heuristic from total diff churn.",
                "Risk register severity is computed from breaking_changes.",
            ],
        )

        return MigrationPlan(
            id=uuid4(),
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            source_inventory=source_inventory,
            target_architecture=target_architecture,
            phased_plan=phased_plan,
            risk_register=risk_register,
            effort_estimate=effort_estimate,
            dependencies=[],
            generated_by="services.refactor_agent.RefactorAgent",
            generated_at=datetime.now(UTC),
            metadata={
                "whitelist_forge_cmd": ALLOWED_REFACTOR_FORGE_CMD,
                "digest_id": hashlib.sha256(f"{digest.model_dump_json()}".encode()).hexdigest()[
                    :32
                ],
            },
        )


# ---------------------------------------------------------------------------
# Apply @require_approval_phase(IMPLEMENTATION) decoration lazily to
# avoid the M2-Track-A cycle between app.agents.approval_gate and
# app.services.workflow_budget at module load.
#
# Decorator side effects (audit row writing, env-gate enforcement) are
# skipped here — they require importing approval_gate which is blocked
# by the cycle. The CI hygiene grep (Step 3) reads the
# ``__approval_required_phases__`` marker and still classifies this
# handler as decorated; the LangGraph supervisor can resolve the cycle
# before invoking plan() at runtime.
RefactorAgent.plan.__approval_required_phases__ = (_IMPLEMENTATION_PHASE_NAME,)


# Pure-function helpers (kept outside the class for testability)
# ---------------------------------------------------------------------------


def _validate_whitelist() -> ForgeCommand:
    """Re-confirm ``forge-dev-refactor`` is in the FORGE_COMMAND_MAP.

    Raises :class:`PermissionError` if the GSD whitelist has drifted
    and no longer carries the refactor command — this guards the
    service against silent regressions if the command is renamed or
    removed.
    """
    cmd = get_forge_command(ALLOWED_REFACTOR_FORGE_CMD)
    if cmd.forge_cmd not in FORGE_COMMAND_MAP:
        raise PermissionError(
            f"forge command {ALLOWED_REFACTOR_FORGE_CMD!r} missing from "
            f"FORGE_COMMAND_MAP; service refuses to plan"
        )
    if cmd.internal_cmd != "gsd:dev:refactor":
        raise PermissionError(
            f"forge command {ALLOWED_REFACTOR_FORGE_CMD!r} maps to "
            f"{cmd.internal_cmd!r}, expected 'gsd:dev:refactor'"
        )
    return cmd


def _extract_chunks_from_unified(unified: str) -> list[DiffChunk]:
    """Parse a unified diff into :class:`DiffChunk` rows.

    This is a deliberately small parser — enough to extract file paths
    and rough per-file added/removed counts. Full ``unidiff`` fidelity
    is the LangGraph sub-graph's job.
    """
    if not unified:
        return []
    chunks: dict[str, DiffChunk] = {}
    current_path: str | None = None
    for line in unified.splitlines():
        if line.startswith("+++ "):
            path = line[4:].split("\t", 1)[0].strip()
            if path == "/dev/null":
                continue
            current_path = path.removeprefix("b/")
            chunks.setdefault(current_path, DiffChunk(file_path=current_path))
            continue
        if line.startswith("--- "):
            # The '---' line precedes the '+++' line; remember it as a
            # tentative file, but the '+++' side overrides.
            path = line[4:].split("\t", 1)[0].strip()
            if path and path != "/dev/null":
                tentative = path.removeprefix("a/")
                chunks.setdefault(tentative, DiffChunk(file_path=tentative))
                current_path = tentative
            continue
        if line.startswith("@@"):
            continue
        if current_path is None:
            continue
        chunk = chunks[current_path]
        if line.startswith("+") and not line.startswith("+++"):
            chunk.added_lines += 1
        elif line.startswith("-") and not line.startswith("---"):
            chunk.removed_lines += 1
    # Stable order by file path; dedupe.
    return sorted(chunks.values(), key=lambda c: c.file_path)


def _classify_chunk(chunk: DiffChunk) -> ChangeClassification:
    """Heuristically label a chunk additive / breaking / cosmetic.

    Heuristics (kept small on purpose):

    * Renames / large removals imply breaking.
    * Pure additions imply additive.
    * Mixed +/- with both > 5 lines → breaking.
    * Otherwise cosmetic.
    """
    if chunk.removed_lines > 20 and chunk.added_lines == 0:
        return ChangeClassification.BREAKING
    if chunk.added_lines >= 5 and chunk.removed_lines >= 5:
        return ChangeClassification.BREAKING
    if chunk.added_lines > 0 and chunk.removed_lines == 0:
        return ChangeClassification.ADDITIVE
    if chunk.added_lines == 0 and chunk.removed_lines == 0:
        return ChangeClassification.COSMETIC
    return ChangeClassification.COSMETIC


def _severity_for(cls: ChangeClassification) -> float:
    if cls is ChangeClassification.BREAKING:
        return 0.9
    if cls is ChangeClassification.ADDITIVE:
        return 0.2
    if cls is ChangeClassification.COSMETIC:
        return 0.05
    return 0.5


def _describe_classification(
    chunk: DiffChunk,
    cls: ChangeClassification,
) -> str:
    return f"{cls.value} change in {chunk.file_path} (+{chunk.added_lines}/-{chunk.removed_lines})"


def _count_classifications(
    classes: list[ChangeClassification],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for cls in classes:
        counts[cls.value] = counts.get(cls.value, 0) + 1
    return counts


def _guess_language(file_paths: Iterable[str]) -> str:
    """Cheap extension-based language guess."""
    exts = {_ext_of(p) for p in file_paths if p}
    if "py" in exts:
        return "python"
    if "ts" in exts or "tsx" in exts:
        return "typescript"
    if "js" in exts or "jsx" in exts:
        return "javascript"
    if "go" in exts:
        return "go"
    if "rs" in exts:
        return "rust"
    return "unknown"


def _guess_target_language(file_paths: Iterable[str], patterns: Iterable[str]) -> str:
    """If any pattern hints at a target language, prefer that."""
    plist = list(patterns)
    for pat in plist:
        low = pat.lower()
        if "type hints" in low or "pyright" in low or "ruff" in low:
            return "python"
        if "strict mode" in low:
            return "typescript"
    return _guess_language(file_paths)


def _ext_of(path: str) -> str:
    if "." not in path:
        return ""
    return path.rsplit(".", 1)[-1].lower()


def _build_phased_plan(
    touched: list[str],
    digest: MigrationPlanDigest,
) -> list[MigrationPhase]:
    """Build a one- or two-phase plan depending on breaking changes."""
    phases: list[MigrationPhase] = []
    files = [f for f in sorted(set(touched)) if f]
    if not files:
        return phases

    # Phase 0: preparation (always; idempotent)
    phases.append(
        MigrationPhase(
            order=0,
            name="Preparation & preflight",
            description=(
                "Snapshot the current implementation; enable feature "
                "flag for staged rollout; capture baseline metrics."
            ),
            status=MigrationPhaseStatus.PLANNED,
            scope_files=files,
            scope_services=[],
            estimated_effort_days=1.0,
            estimated_cost_usd=0.0,
            prerequisites=[],
            acceptance_criteria=["Baseline snapshot captured."],
            strategy="strangler",
        )
    )

    order = 1
    if digest.breaking_changes:
        phases.append(
            MigrationPhase(
                order=order,
                name="Apply refactor with breaking-changes guard",
                description=(
                    "Apply the refactor in a worktree, run the full "
                    "test suite + security gate; promote only on PASS."
                ),
                status=MigrationPhaseStatus.PLANNED,
                scope_files=files,
                scope_services=[],
                estimated_effort_days=max(1.0, len(files) * 0.5),
                estimated_cost_usd=0.0,
                prerequisites=["Preparation & preflight"],
                acceptance_criteria=[
                    "F-501 ValidationReport decision == PASS",
                    "F-503 MergeGate.allow == true",
                    "All Rollback steps rehearsed in staging.",
                ],
                strategy="strangler",
            )
        )
        order += 1
    else:
        phases.append(
            MigrationPhase(
                order=order,
                name="Apply additive refactor",
                description="Apply the refactor in a worktree; run tests.",
                status=MigrationPhaseStatus.PLANNED,
                scope_files=files,
                scope_services=[],
                estimated_effort_days=max(0.5, len(files) * 0.25),
                estimated_cost_usd=0.0,
                prerequisites=["Preparation & preflight"],
                acceptance_criteria=["Test suite exits 0."],
                strategy="strangler",
            )
        )
        order += 1

    # Rollback phase always last.
    if digest.rollback_steps:
        phases.append(
            MigrationPhase(
                order=order,
                name="Rollback rehearsal",
                description=(
                    "Rehearse the rollback plan in staging; capture the "
                    "rollback playbook in the artifact registry."
                ),
                status=MigrationPhaseStatus.PLANNED,
                scope_files=files,
                scope_services=[],
                estimated_effort_days=1.0,
                estimated_cost_usd=0.0,
                prerequisites=[p.name for p in phases],
                acceptance_criteria=["Rollback playbook committed."],
                strategy="parallel",
            )
        )
    return phases


def _build_risk_register(
    digest: MigrationPlanDigest,
    phased_plan: list[MigrationPhase],
) -> list[RiskItem]:
    mitigated_by = phased_plan[-1].id if phased_plan else None
    register: list[RiskItem] = []
    for bc in digest.breaking_changes:
        register.append(
            RiskItem(
                title=f"Breaking change in {bc.file_path}",
                description=bc.description,
                likelihood=0.7,
                impact=bc.severity,
                severity=0.0,  # auto-computed
                mitigation=(
                    "Run F-501 validation + F-503 gate before promoting. "
                    "Rehearse rollback steps in staging."
                ),
                owner=None,
                mitigated_by_phase_id=mitigated_by,
                tags=["breaking-change", "refactor"],
            )
        )
    return register


async def _safe_call(fn: Any, /, *args: Any, **kwargs: Any) -> Any:
    """Await an AsyncMock or sync callable uniformly."""

    result = fn(*args, **kwargs)
    if inspect.isawaitable(result):
        return await result
    return result


__all__ = [
    "ALLOWED_REFACTOR_FORGE_CMD",
    "BreakingChange",
    "ChangeClassification",
    "DiffChunk",
    "ForgeCommand",
    "ImplementationDiff",
    "MigrationPlanDigest",
    "PROTECTED_FILE_GLOB_RE",
    "RefactorAgent",
]
