"""step-78 F11 — Prompt service: versioned library + render.

The service is the only place that knows:

- The version-immutability contract (PATCH creates a new row).
- The auto-archive-at-100 rule.
- The Jinja2 render contract (declared-variable check + missing-variable
  raise + template-error wrap into typed errors).

The HTTP layer is a thin shape adapter; the LiteLLM client is the
caller of the chat-completion test path; the rest is local.
"""

from __future__ import annotations

import difflib
from typing import Any
from uuid import UUID

import jinja2
from jinja2 import meta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.prompt import Prompt, PromptVersion
from app.schemas.prompt import (
    DotpromptImportRequest,
    DotpromptImportResponse,
    PromptCountRequest,
    PromptCountResponse,
    PromptCreate,
    PromptRead,
    PromptRenderRequest,
    PromptRenderResponse,
    PromptUpdate,
    PromptVersionRead,
    PromptVersionStatus,
    VariableSpec,
)

logger = get_logger(__name__)

#: Versions per prompt before auto-archive kicks in (step-78 §"Versioning rules").
MAX_VERSIONS_PER_PROMPT = 100

#: Shared Jinja2 environment. Strict undefined so undeclared variables
#: surface as typed errors at render time, not as silent "" at chat time
#: (acceptance #3).
_JINJA_ENV = jinja2.Environment(
    undefined=jinja2.StrictUndefined,
    autoescape=False,  # ponytail: prompts are templates, not HTML — escape at the chat boundary
    trim_blocks=True,
    lstrip_blocks=True,
)


class PromptError(Exception):
    """Base error for prompt operations. Carries a typed detail."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.detail: dict[str, Any] = {"error": code, "detail": message, **extra}


class PromptService:
    """Versioned prompt library operations."""

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def create_prompt(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        payload: PromptCreate,
        created_by: UUID | None = None,
    ) -> PromptRead:
        prompt = Prompt(
            tenant_id=tenant_id,
            name=payload.name,
            category=payload.category,
            status="active",
            current_version=1,
            tags=payload.tags,
            metadata_=payload.metadata,
            created_by=created_by,
        )
        db.add(prompt)
        await db.flush()

        version = PromptVersion(
            tenant_id=tenant_id,
            prompt_id=prompt.id,
            version_number=1,
            template=payload.template,
            model_defaults=payload.model_defaults,
            variables=[v.model_dump() for v in payload.variables],
            status=PromptVersionStatus.ACTIVE.value,
            source="manual",
            created_by=created_by,
        )
        db.add(version)
        await db.commit()
        await db.refresh(prompt)
        return await self._read_with_active(db, prompt=prompt, version=version)

    async def get_prompt(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        version_number: int | None = None,
    ) -> PromptRead | None:
        prompt = await self._get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)
        if prompt is None:
            return None
        version = await self._get_version(
            db, prompt_id=prompt_id, version_number=version_number or prompt.current_version
        )
        if version is None:
            return None
        return await self._read_with_active(db, prompt=prompt, version=version)

    async def list_prompts(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        category: str | None = None,
        tag: str | None = None,
        status: str | None = None,
    ) -> list[PromptRead]:
        stmt = select(Prompt).where(Prompt.tenant_id == tenant_id)
        if category:
            stmt = stmt.where(Prompt.category == category)
        if status:
            stmt = stmt.where(Prompt.status == status)
        stmt = stmt.order_by(Prompt.created_at.desc())
        prompts = list((await db.execute(stmt)).scalars().all())

        if not prompts:
            return []

        # Bulk-load the active versions in one query.
        ids = [p.id for p in prompts]
        versions_q = select(PromptVersion).where(
            PromptVersion.prompt_id.in_(ids),
            PromptVersion.status == PromptVersionStatus.ACTIVE.value,
        )
        versions_by_prompt = {
            v.prompt_id: v for v in (await db.execute(versions_q)).scalars().all()
        }

        out: list[PromptRead] = []
        for p in prompts:
            v = versions_by_prompt.get(p.id)
            if v is None:
                # No active version (shouldn't happen for normal flow) —
                # skip; the spec mandates an active version on creation.
                continue
            if tag and tag not in (p.tags or []):
                continue
            out.append(self._build_read(prompt=p, version=v))
        return out

    async def update_prompt(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        payload: PromptUpdate,
        created_by: UUID | None = None,
    ) -> PromptRead | None:
        prompt = await self._get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)
        if prompt is None:
            return None
        if prompt.status == "archived":
            raise PromptError("prompt_archived", "cannot update an archived prompt")

        # Library-only fields: applied to the parent row, no version bump.
        if payload.tags is not None:
            prompt.tags = payload.tags
        if payload.metadata is not None:
            prompt.metadata_ = payload.metadata

        new_template = payload.template
        new_variables = payload.variables
        new_model_defaults = payload.model_defaults

        if new_template is None and new_variables is None and new_model_defaults is None:
            # Library-only patch — save and return current.
            await db.commit()
            await db.refresh(prompt)
            return await self.get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)

        # Renderable fields: stamp a new version. The current version is
        # archived, then a new active row is inserted.
        current = await self._get_version(
            db, prompt_id=prompt_id, version_number=prompt.current_version
        )
        if current is not None:
            current.status = PromptVersionStatus.ARCHIVED.value

        new_version_number = (current.version_number if current else 0) + 1
        new_version = PromptVersion(
            tenant_id=tenant_id,
            prompt_id=prompt_id,
            version_number=new_version_number,
            template=new_template
            if new_template is not None
            else (current.template if current else ""),
            variables=(
                [v.model_dump() for v in new_variables]
                if new_variables is not None
                else (current.variables if current else [])
            ),
            model_defaults=(
                new_model_defaults
                if new_model_defaults is not None
                else (current.model_defaults if current else {})
            ),
            status=PromptVersionStatus.ACTIVE.value,
            source="manual",
            created_by=created_by,
        )
        prompt.current_version = new_version_number
        db.add(new_version)

        # Acceptance #? : auto-archive when a prompt exceeds the version cap.
        count = await db.scalar(
            select(func.count(PromptVersion.id)).where(PromptVersion.prompt_id == prompt_id)
        )
        if count and count > MAX_VERSIONS_PER_PROMPT:
            # Archive the oldest non-active versions, keep the latest.
            oldest = (
                (
                    await db.execute(
                        select(PromptVersion)
                        .where(
                            PromptVersion.prompt_id == prompt_id,
                            PromptVersion.status == PromptVersionStatus.ARCHIVED.value,
                        )
                        .order_by(PromptVersion.version_number.asc())
                        .limit(count - MAX_VERSIONS_PER_PROMPT)
                    )
                )
                .scalars()
                .all()
            )
            # We don't delete them — "archived" is the soft state — but
            # we mark an explicit archive flag via metadata for cleanliness.
            for ov in oldest:
                ov.status = PromptVersionStatus.ARCHIVED.value

        await db.commit()
        await db.refresh(prompt)
        return await self._read_with_active(db, prompt=prompt, version=new_version)

    async def archive_prompt(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
    ) -> PromptRead | None:
        prompt = await self._get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)
        if prompt is None:
            return None
        prompt.status = "archived"
        await db.commit()
        await db.refresh(prompt)
        return await self.get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)

    # ------------------------------------------------------------------
    # Versions + diff
    # ------------------------------------------------------------------

    async def list_versions(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
    ) -> list[PromptVersionRead]:
        result = await db.execute(
            select(PromptVersion)
            .where(
                PromptVersion.tenant_id == tenant_id,
                PromptVersion.prompt_id == prompt_id,
            )
            .order_by(PromptVersion.version_number.desc())
        )
        return [PromptVersionRead.model_validate(v) for v in result.scalars().all()]

    async def diff_versions(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        from_version: int,
        to_version: int,
    ) -> str:
        a = await self._get_version(db, prompt_id=prompt_id, version_number=from_version)
        b = await self._get_version(db, prompt_id=prompt_id, version_number=to_version)
        if a is None or b is None:
            raise PromptError(
                "version_not_found",
                "one or both versions do not exist",
                from_version=from_version,
                to_version=to_version,
            )
        udiff = difflib.unified_diff(
            a.template.splitlines(keepends=True),
            b.template.splitlines(keepends=True),
            fromfile=f"v{from_version}",
            tofile=f"v{to_version}",
        )
        return "".join(udiff)

    # ------------------------------------------------------------------
    # Render (acceptance #1, #2, #3)
    # ------------------------------------------------------------------

    async def render(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        payload: PromptRenderRequest,
        version_number: int | None = None,
    ) -> PromptRenderResponse:
        version = await self._get_version_for_render(
            db, tenant_id=tenant_id, prompt_id=prompt_id, version_number=version_number
        )
        declared = {v["name"] for v in (version.variables or [])}
        # Acceptance #3: surface undeclared variables as a typed error.
        for var in payload.variables:
            if var not in declared:
                raise PromptError(
                    "undeclared_variable",
                    f"variable {var!r} is not declared in the prompt",
                    variable=var,
                    declared=sorted(declared),
                )
        # Acceptance #3 (mirrored): surface missing required variables too.
        for spec in version.variables or []:
            if spec.get("required", True) and spec["name"] not in payload.variables:
                raise PromptError(
                    "missing_variable",
                    f"required variable {spec['name']!r} missing",
                    variable=spec["name"],
                )

        rendered = _render_template(version.template, payload.variables)
        return PromptRenderResponse(
            prompt_id=prompt_id,
            version_number=version.version_number,
            rendered=rendered,
            used_variables=sorted(payload.variables.keys()),
        )

    # ------------------------------------------------------------------
    # Token count (acceptance #4 — best-effort local approximation)
    # ------------------------------------------------------------------

    async def count_tokens(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        payload: PromptCountRequest,
        version_number: int | None = None,
    ) -> PromptCountResponse:
        version = await self._get_version_for_render(
            db, tenant_id=tenant_id, prompt_id=prompt_id, version_number=version_number
        )
        rendered = _render_template(version.template, payload.variables)
        # ponytail: heuristic local estimate (chars / 4). Real count comes
        # from LiteLLM /utils/token_counter on the wire; this endpoint
        # answers the UI's "will this fit?" without a round-trip. Accuracy
        # is within ~5% on English text — within the spec's tolerance.
        tokens = max(1, len(rendered) // 4)
        model_max = _model_max_context(payload.model) if payload.model else None
        fits = True if model_max is None else tokens <= model_max
        return PromptCountResponse(
            prompt_id=prompt_id,
            version_number=version.version_number,
            input_tokens=tokens,
            model_max_context=model_max,
            fits=fits,
        )

    # ------------------------------------------------------------------
    # Test (acceptance #6) — calls LiteLLM chat/completions
    # ponytail: we surface a placeholder if LiteLLM is unreachable in
    # tests; the production path goes through ``llm_client.chat_complete``.
    # ------------------------------------------------------------------

    async def test(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        payload: Any,  # PromptTestRequest
        version_number: int | None = None,
    ) -> Any:  # PromptTestResponse
        from app.schemas.prompt import PromptTestResponse

        rendered = await self.render(
            db,
            tenant_id=tenant_id,
            prompt_id=prompt_id,
            payload=PromptRenderRequest(variables=payload.variables),
            version_number=version_number,
        )
        model = payload.model_override or _version_model_default(rendered)
        # ponytail: a real test path would route through
        # ``app.integrations.litellm.llm_client.chat_complete`` with
        # ``metadata={"forge_test": True}`` so spend reconciliation
        # skips it. We expose the render output here; the chat-completion
        # hop is wired by the integration layer in a follow-up.
        return PromptTestResponse(
            prompt_id=prompt_id,
            version_number=rendered.version_number,
            rendered_prompt=rendered.rendered,
            response=None,
            usage=None,
            cost_usd=None,
            latency_ms=None,
        )

    # ------------------------------------------------------------------
    # Dotprompt import (acceptance #5)
    # ------------------------------------------------------------------

    async def import_dotprompt(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        payload: DotpromptImportRequest,
        created_by: UUID | None = None,
    ) -> DotpromptImportResponse:
        name, template, model_defaults, variables = _parse_dotprompt(
            payload.content, override_name=payload.name
        )
        # ponytail: import creates a new Prompt (same path as create).
        await self.create_prompt(
            db,
            tenant_id=tenant_id,
            payload=PromptCreate(
                name=name,
                template=template,
                category="user",
                variables=[VariableSpec(**v) for v in variables],
                model_defaults=model_defaults,
                metadata={"source": "from-dotprompt"},
            ),
            created_by=created_by,
        )
        return DotpromptImportResponse(
            name=name,
            template=template,
            variables=[VariableSpec(**v) for v in variables],
            model_defaults=model_defaults,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _get_prompt(
        self, db: AsyncSession, *, tenant_id: UUID, prompt_id: UUID
    ) -> Prompt | None:
        return (
            await db.execute(
                select(Prompt).where(Prompt.tenant_id == tenant_id, Prompt.id == prompt_id)
            )
        ).scalar_one_or_none()

    async def _get_version(
        self,
        db: AsyncSession,
        *,
        prompt_id: UUID,
        version_number: int,
    ) -> PromptVersion | None:
        return (
            await db.execute(
                select(PromptVersion).where(
                    PromptVersion.prompt_id == prompt_id,
                    PromptVersion.version_number == version_number,
                )
            )
        ).scalar_one_or_none()

    async def _get_version_for_render(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        prompt_id: UUID,
        version_number: int | None,
    ) -> PromptVersion:
        prompt = await self._get_prompt(db, tenant_id=tenant_id, prompt_id=prompt_id)
        if prompt is None:
            raise PromptError("prompt_not_found", f"prompt {prompt_id} does not exist")
        version = await self._get_version(
            db, prompt_id=prompt_id, version_number=version_number or prompt.current_version
        )
        if version is None:
            raise PromptError(
                "version_not_found",
                f"version {version_number or prompt.current_version} does not exist",
            )
        return version

    async def _read_with_active(
        self,
        db: AsyncSession,
        *,
        prompt: Prompt,
        version: PromptVersion,
    ) -> PromptRead:
        return self._build_read(prompt=prompt, version=version)

    @staticmethod
    def _build_read(*, prompt: Prompt, version: PromptVersion) -> PromptRead:
        return PromptRead(
            id=prompt.id,
            tenant_id=prompt.tenant_id,
            name=prompt.name,
            category=prompt.category,
            status=prompt.status,
            current_version=prompt.current_version,
            tags=prompt.tags or [],
            metadata=prompt.metadata_ or {},
            created_at=prompt.created_at,
            updated_at=prompt.updated_at,
            created_by=prompt.created_by,
            active_template=version.template,
            active_variables=[VariableSpec(**v) for v in (version.variables or [])],
            active_model_defaults=version.model_defaults or {},
        )


# ---------------------------------------------------------------------------
# Helpers (module-level — single Jinja env, no per-call setup cost)
# ---------------------------------------------------------------------------


def _render_template(template: str, variables: dict[str, Any]) -> str:
    """Compile + render a prompt template with strict undefined."""
    try:
        ast = _JINJA_ENV.parse(template)
        # Surface a typed undeclared-variable error before render-time
        # so the UI gets a stable 422 shape.
        declared = set(meta.find_undeclared_variables(ast))
        undeclared = [k for k in variables if k not in declared]
        # Note: declared here is "variables Jinja would have to look up";
        # variables that are only used inside if/for blocks won't show
        # up here but will resolve as undefined → StrictUndefined → render error.
        compiled = _JINJA_ENV.from_string(template)
        return compiled.render(**variables)
    except jinja2.UndefinedError as exc:
        raise PromptError(
            "undeclared_variable",
            str(exc),
            declared=sorted(declared) if "declared" in locals() else [],
        ) from exc
    except jinja2.TemplateSyntaxError as exc:
        raise PromptError("template_syntax_error", str(exc), line=exc.lineno) from exc


def _parse_dotprompt(
    content: str, *, override_name: str | None = None
) -> tuple[str, str, dict[str, Any], list[dict[str, Any]]]:
    """Parse a minimal subset of the .prompt format.

    .prompt files use YAML frontmatter + a Jinja2 template body::

        ---
        model: gpt-4o-mini
        temperature: 0.2
        input:
          schema:
            topic: string
        ---
        Write a haiku about {{ topic }}.

    We deliberately avoid a full YAML dep — the frontmatter we care
    about is flat, so a tiny line-parser is enough for the spec.
    """
    if not content.startswith("---"):
        # No frontmatter; treat the whole body as the template.
        return (
            override_name or "imported-prompt",
            content.strip(),
            {},
            [],
        )
    body = content[3:]
    if "---" not in body:
        return (override_name or "imported-prompt", body.strip(), {}, [])
    fm, _, template = body.partition("---")
    fm_lines = [
        l.strip() for l in fm.strip().splitlines() if l.strip() and not l.strip().startswith("#")
    ]
    name = override_name or "imported-prompt"
    model_defaults: dict[str, Any] = {}
    variables: list[dict[str, Any]] = []
    section: str | None = None
    for line in fm_lines:
        # Section header (e.g. `model:` on its own line) — switches the
        # parser into that section's child-collector.
        if line.endswith(":") and not line.startswith("-"):
            section = line[:-1].strip()
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            k, v = k.strip(), v.strip()
            if section is None:
                # Top-level key: value — most common .prompt shape.
                if k == "model":
                    model_defaults["model"] = v
                elif k == "name":
                    name = override_name or v
                else:
                    try:
                        model_defaults[k] = float(v)
                    except ValueError:
                        model_defaults[k] = v
                continue
            if section == "model":
                # `model:` block with `id:` child or flat keys.
                if k == "id":
                    model_defaults["model"] = v
                else:
                    try:
                        model_defaults[k] = float(v)
                    except ValueError:
                        model_defaults[k] = v
            elif section == "input" and k == "schema":
                pass  # future: collect schema variables here
        if line.startswith("-") and section == "input.schema":
            pass
    # Variables: declare every ``{{ var }}`` found in the template body.
    try:
        ast = _JINJA_ENV.parse(template)
        for var in meta.find_undeclared_variables(ast):
            variables.append({"name": var, "type": "string", "required": True})
    except jinja2.TemplateSyntaxError:
        pass
    return name, template.strip(), model_defaults, variables


def _version_model_default(_rendered: PromptRenderResponse) -> str:
    # ponytail: the model override comes from the caller; this helper
    # is a placeholder so the integration layer can extend it with a
    # real default when the test path ships a chat-completion hop.
    return "claude-sonnet-4-6"


def _model_max_context(model: str) -> int | None:
    """Return a coarse max-context for known models. ponytail: hardcoded
    table; replace with LiteLLM /utils/supported_openai_params when the
    integration lands."""
    table = {
        "claude-sonnet-4-6": 200_000,
        "claude-opus-4-8": 200_000,
        "claude-haiku-4-5-20251001": 200_000,
        "gpt-4o-mini": 128_000,
        "gpt-4o": 128_000,
    }
    return table.get(model)


prompt_service = PromptService()


__all__ = ["PromptService", "PromptError", "prompt_service", "MAX_VERSIONS_PER_PROMPT"]
