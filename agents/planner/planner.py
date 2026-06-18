"""
Story Planner core — deterministic Story → task breakdown.

This module is the v0.1 implementation of Epic 3 / Sub-goal 3.1 (FORA-69).
The output is consumed by the Coding Agent (Sub-goal 3.2) and audited by
the Reviewer (Sub-goal 3.3). The contract lives in `schemas.py` — keep the
two in lockstep.

Design rules (from FORA-15 §1 Epic 3 + coding.md §1):

- Every task declares at least one `files_touched` and at least one AC ref.
- Dependency order is fixed: migration → model → service → controller →
  test (unit). Integration tests pin to the end of the chain. No
  back-edges.
- Effort is XS / S / M / L / XL; defaults to M, capped per task type.
- The plan_markdown is rendered deterministically from the task list so
  two planner runs on the same inputs produce the same bytes.

v0.1 does NOT call an LLM. The story template is inferred from a small
number of canonical story shapes (CRUD entity, API endpoint, integration).
v0.2 will add a Jira MCP reader + LLM-assisted parsing; the public API
(plan_story) is stable.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .schemas import (
    PlanContext,
    PlanOutput,
    Task,
    TaskStatus,
    TaskType,
)


# ---------------------------------------------------------------------------
# Story shape inference (v0.1: small, explicit list — no fuzzy matching)
# ---------------------------------------------------------------------------

# Maps a story-title keyword to a template id. Order matters: the
# most-specific shape (migration_only) is checked first, so a word
# like "table" in a migration story doesn't pull the planner into the
# CRUD template. Generic endpoint words (auth, login, …) are last.
STORY_SHAPE_KEYWORDS: Tuple[Tuple[str, str], ...] = (
    # migration_only — schema-level changes; most specific.
    ("migration", "migration_only"),
    ("schema", "migration_only"),
    ("columns", "migration_only"),
    ("column", "migration_only"),
    ("index", "migration_only"),
    ("constraint", "migration_only"),
    ("alter", "migration_only"),
    # crud_entity — entity / model / table CRUD work.
    ("crud", "crud_entity"),
    ("entity", "crud_entity"),
    ("model", "crud_entity"),
    ("table", "crud_entity"),
    # api_endpoint — generic HTTP/endpoint words; checked last so a
    # stray "auth" mention doesn't override a stronger signal.
    ("auth", "api_endpoint"),
    ("login", "api_endpoint"),
    ("register", "api_endpoint"),
    ("token", "api_endpoint"),
    ("webhook", "api_endpoint"),
    ("endpoint", "api_endpoint"),
)


def _infer_story_shape(story_title: str, story_description: str) -> str:
    """Return the template id for the story. Default is `crud_entity`.

    Matching order: title first (specific intent), then description
    (fallback). This prevents a generic word like "auth" in the
    description from overriding a specific word like "entity" in the
    title — e.g. `Add User entity` for the auth service should pick
    `crud_entity`, not `api_endpoint`.
    """
    title_lc = story_title.lower()
    desc_lc = story_description.lower()
    for keyword, shape in STORY_SHAPE_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", title_lc):
            return shape
    for keyword, shape in STORY_SHAPE_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", desc_lc):
            return shape
    return "crud_entity"


# ---------------------------------------------------------------------------
# Effort budgeting per task type — keeps the plan readable at a glance
# ---------------------------------------------------------------------------

DEFAULT_EFFORT_BY_TYPE: Dict[TaskType, str] = {
    TaskType.MIGRATION: "S",
    TaskType.MODEL: "M",
    TaskType.SERVICE: "M",
    TaskType.CONTROLLER: "M",
    TaskType.TEST: "M",
    TaskType.CONFIG: "S",
    TaskType.DOCS: "S",
    TaskType.OTHER: "M",
}


# ---------------------------------------------------------------------------
# Public input / output bundles — the API the Coding Agent imports
# ---------------------------------------------------------------------------

@dataclass
class PlannerInputs:
    """Stable input bundle. v0.2 will replace Story's `raw` with a Jira issue fetch."""

    story_id: str
    story_title: str
    story_description: str
    acceptance_criteria: List[Dict[str, Any]]  # [{id, description, ...}]
    design_doc_path: Optional[str] = None
    design_doc_content: Optional[str] = None
    tech_stack: Optional[Dict[str, Any]] = None
    conventions: Optional[str] = None
    plan_id: Optional[str] = None  # if None, derived from story_id

    def to_plan_context(self) -> PlanContext:
        return PlanContext(
            story_id=self.story_id,
            story_title=self.story_title,
            story_description=self.story_description,
            acceptance_criteria=list(self.acceptance_criteria),
            design_doc_path=self.design_doc_path,
            design_doc_content=self.design_doc_content,
            tech_stack=self.tech_stack,
            conventions=self.conventions,
        )


@dataclass
class PlannerOutputs:
    """Stable output bundle. The Coding Agent imports `plan` and `plan_markdown`."""

    plan: PlanOutput
    plan_markdown: str
    shape: str


# ---------------------------------------------------------------------------
# The Planner
# ---------------------------------------------------------------------------

class Planner:
    """Deterministic Story → Plan transformer. v0.1 is pure Python; no I/O.

    Usage:
        planner = Planner()
        out = planner.plan(PlannerInputs(story_id=..., story_title=..., ...))
        # out.plan.tasks is the typed task list
        # out.plan_markdown is the rendered markdown (stable bytes)
        # out.shape is the inferred story shape
    """

    def __init__(self) -> None:
        self._templates = {
            "crud_entity": _build_crud_entity_plan,
            "api_endpoint": _build_api_endpoint_plan,
            "migration_only": _build_migration_only_plan,
        }

    # --- public API -------------------------------------------------------

    def plan(self, inputs: PlannerInputs) -> PlannerOutputs:
        ctx = inputs.to_plan_context()
        shape = _infer_story_shape(ctx.story_title, ctx.story_description)
        builder = self._templates[shape]
        tasks = builder(ctx)

        # Plan id is stable for a given story id — same input, same id.
        plan_id = inputs.plan_id or _derive_plan_id(ctx.story_id)
        generated_at = _utcnow_iso()

        plan = PlanOutput(
            story_id=ctx.story_id,
            plan_id=plan_id,
            tasks=tasks,
            plan_markdown="",  # filled in by the renderer below
            generated_at=generated_at,
        )
        plan_markdown = render_plan_markdown(plan, shape)
        plan.plan_markdown = plan_markdown

        # Validate before returning. The Coding Agent imports the plan, so a
        # broken plan is a pipeline-wide incident.
        errors = plan.validate()
        if errors:
            raise PlannerError(
                f"planner produced an invalid plan for story {ctx.story_id}: "
                + "; ".join(errors)
            )
        return PlannerOutputs(plan=plan, plan_markdown=plan_markdown, shape=shape)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class PlannerError(RuntimeError):
    """Raised when the planner cannot produce a valid plan."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _derive_plan_id(story_id: str) -> str:
    digest = hashlib.sha1(story_id.encode("utf-8")).hexdigest()[:10]
    return f"plan-{digest}"


def _ac_ids(acceptance_criteria: Iterable[Dict[str, Any]]) -> List[str]:
    ids: List[str] = []
    for ac in acceptance_criteria:
        ac_id = ac.get("id")
        if ac_id:
            ids.append(str(ac_id))
    return ids


def _task(
    *,
    id: str,
    type: TaskType,
    title: str,
    description: str,
    files_touched: List[str],
    depends_on: List[str],
    ac_refs: List[str],
    effort: str = "M",
) -> Task:
    return Task(
        id=id,
        type=type,
        title=title,
        description=description,
        files_touched=files_touched,
        depends_on=depends_on,
        acceptance_criteria_refs=ac_refs,
        effort=effort,
        status=TaskStatus.PENDING,
    )


def _entity_slug(title: str) -> str:
    """`User login flow` -> `user_login_flow`. Used to build file paths."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", title).strip("_").lower()
    return slug or "story"


# ---------------------------------------------------------------------------
# Template builders — one per story shape
# ---------------------------------------------------------------------------

def _build_crud_entity_plan(ctx: PlanContext) -> List[Task]:
    """CRUD entity: migration -> model -> service -> controller -> unit + integration tests."""
    slug = _entity_slug(ctx.story_title)
    acs = _ac_ids(ctx.acceptance_criteria)
    return [
        _task(
            id="t-001",
            type=TaskType.MIGRATION,
            title=f"Create {slug} table migration",
            description=(
                f"Add the database table for {ctx.story_title}. "
                "Include id (uuid), audit columns (created_at, updated_at), "
                "and the per-AC columns derived from the acceptance criteria."
            ),
            files_touched=[f"apps/api/src/db/migrations/{slug}_table.sql"],
            depends_on=[],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.MIGRATION],
        ),
        _task(
            id="t-002",
            type=TaskType.MODEL,
            title=f"Implement {slug} model",
            description=(
                f"Implement the {slug} entity with field validation and the "
                "to_dict / from_row converters used by the service layer."
            ),
            files_touched=[f"apps/api/src/models/{slug}.py"],
            depends_on=["t-001"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.MODEL],
        ),
        _task(
            id="t-003",
            type=TaskType.SERVICE,
            title=f"Implement {slug} service",
            description=(
                f"Implement the {slug} business logic — CRUD + any "
                "side-effects called out in the AC descriptions."
            ),
            files_touched=[f"apps/api/src/services/{slug}_service.py"],
            depends_on=["t-002"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.SERVICE],
        ),
        _task(
            id="t-004",
            type=TaskType.CONTROLLER,
            title=f"Wire {slug} controller",
            description=(
                f"Expose {slug} over the HTTP surface — RESTful routes that "
                "delegate to the service. Validate request bodies, shape "
                "responses, and surface typed errors."
            ),
            files_touched=[f"apps/api/src/controllers/{slug}_controller.py"],
            depends_on=["t-003"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.CONTROLLER],
        ),
        _task(
            id="t-005",
            type=TaskType.TEST,
            title=f"Add {slug} unit tests",
            description=(
                f"Unit tests for the {slug} model, service, and controller. "
                "Cover the happy path and the AC failure cases."
            ),
            files_touched=[f"apps/api/test/unit/{slug}/"],
            depends_on=["t-002", "t-003", "t-004"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.TEST],
        ),
        _task(
            id="t-006",
            type=TaskType.TEST,
            title=f"Add {slug} integration tests",
            description=(
                f"Integration tests for {slug} end-to-end against a real "
                "(test-container) DB. Verifies migration + service + "
                "controller wiring."
            ),
            files_touched=[f"apps/api/test/integration/{slug}/"],
            depends_on=["t-005"],
            ac_refs=acs,
            effort="L",
        ),
    ]


def _build_api_endpoint_plan(ctx: PlanContext) -> List[Task]:
    """API endpoint (auth, webhooks, token endpoints): no model — service is first."""
    slug = _entity_slug(ctx.story_title)
    acs = _ac_ids(ctx.acceptance_criteria)
    return [
        _task(
            id="t-001",
            type=TaskType.SERVICE,
            title=f"Implement {slug} service",
            description=(
                f"Implement the {slug} business logic — the function or "
                "small set of functions the controller will call."
            ),
            files_touched=[f"apps/api/src/services/{slug}_service.py"],
            depends_on=[],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.SERVICE],
        ),
        _task(
            id="t-002",
            type=TaskType.CONTROLLER,
            title=f"Wire {slug} controller",
            description=(
                f"Expose {slug} over the HTTP surface. Define the route, "
                "request schema, response schema, and typed error envelope."
            ),
            files_touched=[f"apps/api/src/controllers/{slug}_controller.py"],
            depends_on=["t-001"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.CONTROLLER],
        ),
        _task(
            id="t-003",
            type=TaskType.TEST,
            title=f"Add {slug} unit tests",
            description=(
                f"Unit tests for {slug} service and controller — happy path "
                "plus every AC failure case."
            ),
            files_touched=[f"apps/api/test/unit/{slug}/"],
            depends_on=["t-001", "t-002"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.TEST],
        ),
        _task(
            id="t-004",
            type=TaskType.TEST,
            title=f"Add {slug} integration tests",
            description=(
                f"Integration tests for {slug} — POST/GET flow against a "
                "test server. Includes auth header handling where relevant."
            ),
            files_touched=[f"apps/api/test/integration/{slug}/"],
            depends_on=["t-003"],
            ac_refs=acs,
            effort="L",
        ),
    ]


def _build_migration_only_plan(ctx: PlanContext) -> List[Task]:
    """Schema-only stories: a single migration + a smoke integration test."""
    slug = _entity_slug(ctx.story_title)
    acs = _ac_ids(ctx.acceptance_criteria)
    return [
        _task(
            id="t-001",
            type=TaskType.MIGRATION,
            title=f"Apply {slug} migration",
            description=(
                f"Write the SQL migration that introduces the {slug} change. "
                "Include a down migration in the same file."
            ),
            files_touched=[f"apps/api/src/db/migrations/{slug}.sql"],
            depends_on=[],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.MIGRATION],
        ),
        _task(
            id="t-002",
            type=TaskType.TEST,
            title=f"Add {slug} migration smoke test",
            description=(
                f"Smoke test that applies the migration on a fresh DB and "
                "rolls it back. Asserts the schema diff matches the spec."
            ),
            files_touched=[f"apps/api/test/integration/migrations/{slug}/"],
            depends_on=["t-001"],
            ac_refs=acs,
            effort=DEFAULT_EFFORT_BY_TYPE[TaskType.TEST],
        ),
    ]


# ---------------------------------------------------------------------------
# Markdown renderer — deterministic, byte-stable
# ---------------------------------------------------------------------------

def render_plan_markdown(plan: PlanOutput, shape: str) -> str:
    """Render the plan to markdown. Stable across runs for the same inputs."""
    lines: List[str] = []
    lines.append(f"# Plan — {plan.story_id}")
    lines.append("")
    lines.append(f"- **Plan id:** `{plan.plan_id}`")
    lines.append(f"- **Story shape:** `{shape}`")
    lines.append(f"- **Generated at:** {plan.generated_at}")
    lines.append(f"- **Schema version:** {plan.schema_version}")
    lines.append(f"- **Task count:** {len(plan.tasks)}")
    lines.append("")
    lines.append("## Task list")
    lines.append("")
    for t in plan.tasks:
        deps = ", ".join(t.depends_on) if t.depends_on else "—"
        acs = ", ".join(t.acceptance_criteria_refs) if t.acceptance_criteria_refs else "—"
        files = ", ".join(f"`{f}`" for f in t.files_touched) if t.files_touched else "—"
        lines.append(f"### {t.id} — {t.title}")
        lines.append("")
        lines.append(f"- **Type:** `{t.type.value}`")
        lines.append(f"- **Effort:** {t.effort}")
        lines.append(f"- **Depends on:** {deps}")
        lines.append(f"- **Acceptance criteria:** {acs}")
        lines.append(f"- **Files touched:** {files}")
        lines.append("")
        lines.append(t.description)
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Convenience entry point — what the Coding Agent / smoke test call
# ---------------------------------------------------------------------------

def plan_story(inputs: PlannerInputs) -> PlannerOutputs:
    """One-shot plan. Equivalent to `Planner().plan(inputs)`."""
    return Planner().plan(inputs)
