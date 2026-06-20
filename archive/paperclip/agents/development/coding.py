"""
Coding Agent core — deterministic Plan → Code Diff.

v0.1 implementation of Epic 3 / Sub-goal 3.2 (FORA-70). Takes the Story
Planner's output (Sub-goal 3.1) and emits a structured Code Diff:

  - one FileChange per (task × files_touched) entry
  - a unified-diff string ready for `git apply` or a GitHub PR
  - a CodeDiffSummary with file/line counts and AC + task coverage

v0.1 produces SCAFFOLDING — minimal but compilable code that an
LLM-backed v0.2 (or a human reviewer) fills in via the TODO[3.2/v0.2]
markers. The templates respect the architectural conventions captured
in coding.md:

  apps/api/src/db/migrations/  → SQL migrations with id + audit columns
  apps/api/src/models/         → @dataclass + to_dict / from_row / validate
  apps/api/src/services/       → class with create/get/list/update/delete
  apps/api/src/controllers/    → FastAPI-style route handlers
  apps/api/test/{unit,integration}/<slug>/ → pytest class + test method stubs

Hard rules (per Epic 3 description):

  - No direct commit. The agent returns a CodeDiff; an operator or
    orchestrator decides how to apply it (git apply, raise a PR via
    GitHub MCP, etc.). The agent itself never invokes commit.
  - No LLM. The templates are deterministic — same plan + same context
    produces the same bytes. Two runs on the same input return equal
    unified_diff strings.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Callable, Dict, List, Optional, Tuple

from agents.planner import PlanOutput, Task, TaskType

from .schemas import (
    CodeDiff,
    CodeDiffSummary,
    FileAction,
    FileChange,
    Language,
    _utcnow_iso,
    derive_diff_id,
)


# ---------------------------------------------------------------------------
# File extension → language map (labels FileChange.language)
# ---------------------------------------------------------------------------

EXT_LANGUAGE: Dict[str, Language] = {
    ".py": Language.PYTHON,
    ".sql": Language.SQL,
    ".yaml": Language.YAML,
    ".yml": Language.YAML,
    ".md": Language.MARKDOWN,
    ".json": Language.JSON,
}


def _language_for(path: str) -> Language:
    suffix = PurePosixPath(path).suffix.lower()
    return EXT_LANGUAGE.get(suffix, Language.UNKNOWN)


def _normalize_path(path: str) -> str:
    """If the planner emitted a directory path (trailing `/`), pick a
    sensible default filename so the FileChange points at a real file.

    Test directories → `test_smoke.py`; other directories → `__init__.py`.
    Plain file paths are returned unchanged.
    """
    if not path.endswith("/"):
        return path
    if "/test" in path or "/tests" in path:
        return path + "test_smoke.py"
    return path + "__init__.py"


# ---------------------------------------------------------------------------
# Title → entity slug + class name (mirrors planner._entity_slug)
# ---------------------------------------------------------------------------

def _slug(title: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", title).strip("_").lower()
    return s or "story"


def _class_name(title: str) -> str:
    parts = [p for p in re.split(r"[^a-zA-Z0-9]+", title.strip()) if p]
    return "".join(p[0].upper() + p[1:] for p in parts) or "Story"


# ---------------------------------------------------------------------------
# Header block — embedded in every scaffold file as a traceability marker
# ---------------------------------------------------------------------------

def _header_comment(
    language: Language,
    plan_id: str,
    story_id: str,
    task_id: str,
    ac_refs: List[str],
    description: str,
) -> str:
    """Render a language-appropriate header comment for the scaffold body."""
    ac_str = ", ".join(ac_refs) if ac_refs else "—"
    desc = (description or "").strip() or "(no description)"
    if language == Language.SQL:
        return (
            f"-- Auto-generated scaffold — DO NOT COMMIT without review.\n"
            f"-- plan_id: {plan_id}\n"
            f"-- story_id: {story_id}\n"
            f"-- task_id: {task_id}\n"
            f"-- ac_refs: {ac_str}\n"
            f"-- description: {desc}\n"
        )
    if language == Language.PYTHON:
        return (
            f'"""\n'
            f"Auto-generated scaffold — DO NOT COMMIT without review.\n"
            f"\n"
            f"plan_id: {plan_id}\n"
            f"story_id: {story_id}\n"
            f"task_id: {task_id}\n"
            f"ac_refs: {ac_str}\n"
            f"\n"
            f"description: {desc}\n"
            f'"""\n'
        )
    if language == Language.YAML:
        return (
            f"# Auto-generated scaffold — DO NOT COMMIT without review.\n"
            f"# plan_id: {plan_id}\n"
            f"# story_id: {story_id}\n"
            f"# task_id: {task_id}\n"
            f"# ac_refs: {ac_str}\n"
            f"# description: {desc}\n"
        )
    # default: markdown-style comment
    return (
        f"<!-- Auto-generated scaffold — DO NOT COMMIT without review. -->\n"
        f"<!-- plan_id: {plan_id}  story_id: {story_id}  "
        f"task_id: {task_id}  ac_refs: {ac_str} -->\n"
    )


# ---------------------------------------------------------------------------
# Templates — one body-renderer per TaskType
# ---------------------------------------------------------------------------

def _tpl_migration(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    """Render a SQL migration. v0.1 emits the id + audit columns every
    table in this codebase needs; v0.2 fills in the per-AC columns."""
    path = task.files_touched[0]
    table = _slug(path)  # path-derived, stable across runs
    header = _header_comment(
        Language.SQL, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description
    )
    body = (
        f"{header}\n"
        f"-- TODO[3.2/v0.2]: fill in column definitions from the AC descriptions.\n"
        f"-- v0.1 emits the id + audit columns every table in this codebase needs.\n"
        f"\n"
        f"CREATE TABLE IF NOT EXISTS {table} (\n"
        f"    id UUID PRIMARY KEY,\n"
        f"    created_at TIMESTAMP NOT NULL DEFAULT NOW(),\n"
        f"    updated_at TIMESTAMP NOT NULL DEFAULT NOW()\n"
        f");\n"
        f"\n"
        f"-- Down migration\n"
        f"-- DROP TABLE IF EXISTS {table};\n"
    )
    return body, Language.SQL


def _tpl_model(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    """Render a Python @dataclass model with to_dict / from_row / validate."""
    cls = _class_name(task.title)
    header = _header_comment(
        Language.PYTHON, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description
    )
    body = (
        f"{header}\n"
        f"from __future__ import annotations\n"
        f"\n"
        f"import uuid\n"
        f"from dataclasses import dataclass, field\n"
        f"from datetime import datetime\n"
        f"from typing import Any, Dict, Optional\n"
        f"\n"
        f"\n"
        f"@dataclass\n"
        f"class {cls}:\n"
        f"    id: uuid.UUID\n"
        f"    created_at: datetime\n"
        f"    updated_at: datetime\n"
        f"    # TODO[3.2/v0.2]: add entity fields derived from the AC descriptions.\n"
        f"\n"
        f"    def to_dict(self) -> Dict[str, Any]:\n"
        f"        return {{\n"
        f'            "id": str(self.id),\n'
        f'            "created_at": self.created_at.isoformat(),\n'
        f'            "updated_at": self.updated_at.isoformat(),\n'
        f"        }}\n"
        f"\n"
        f"    @classmethod\n"
        f'    def from_row(cls, row: Dict[str, Any]) -> "{cls}":\n'
        f"        return cls(\n"
        f'            id=row["id"],\n'
        f'            created_at=row["created_at"],\n'
        f'            updated_at=row["updated_at"],\n'
        f"        )\n"
        f"\n"
        f"    def validate(self) -> None:\n"
        f"        if not self.id:\n"
        f'            raise ValueError("id is required")\n'
        f"        # TODO[3.2/v0.2]: add field-level validation per AC.\n"
    )
    return body, Language.PYTHON


def _tpl_service(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    """Render a Python service class with async CRUD method stubs."""
    cls = _class_name(task.title)
    slug = cls.lower()
    header = _header_comment(
        Language.PYTHON, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description
    )
    body = (
        f"{header}\n"
        f"from __future__ import annotations\n"
        f"\n"
        f"import uuid\n"
        f"from typing import Any, Dict, List, Optional\n"
        f"\n"
        f"\n"
        f"class {cls}Service:\n"
        f'    """CRUD + business logic for {cls}. v0.1 scaffold."""\n'
        f"\n"
        f"    def __init__(self, db):  # db is wired in v0.2\n"
        f"        self._db = db\n"
        f"\n"
        f"    async def create(self, payload: Dict[str, Any]) -> Dict[str, Any]:\n"
        f"        # TODO[3.2/v0.2]: validate, persist, return created entity\n"
        f"        raise NotImplementedError\n"
        f"\n"
        f"    async def get(self, entity_id: uuid.UUID) -> Optional[Dict[str, Any]]:\n"
        f"        # TODO[3.2/v0.2]\n"
        f"        raise NotImplementedError\n"
        f"\n"
        f"    async def list(self, *, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:\n"
        f"        # TODO[3.2/v0.2]\n"
        f"        raise NotImplementedError\n"
        f"\n"
        f"    async def update(self, entity_id: uuid.UUID, payload: Dict[str, Any]) -> Dict[str, Any]:\n"
        f"        # TODO[3.2/v0.2]\n"
        f"        raise NotImplementedError\n"
        f"\n"
        f"    async def delete(self, entity_id: uuid.UUID) -> None:\n"
        f"        # TODO[3.2/v0.2]\n"
        f"        raise NotImplementedError\n"
    )
    return body, Language.PYTHON


def _tpl_controller(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    """Render a Python FastAPI-style controller with route handlers."""
    cls = _class_name(task.title)
    slug = cls.lower()
    header = _header_comment(
        Language.PYTHON, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description
    )
    body = (
        f"{header}\n"
        f"from __future__ import annotations\n"
        f"\n"
        f"import uuid\n"
        f"from typing import Any, Dict, List, Optional\n"
        f"\n"
        f"from fastapi import APIRouter, HTTPException, status\n"
        f"from pydantic import BaseModel\n"
        f"\n"
        f"\n"
        f"router = APIRouter(prefix=\"/{slug}\", tags=[\"{slug}\"])\n"
        f"\n"
        f"\n"
        f"class {cls}CreateRequest(BaseModel):\n"
        f"    # TODO[3.2/v0.2]: derive request fields from AC descriptions\n"
        f"    pass\n"
        f"\n"
        f"\n"
        f"class {cls}Response(BaseModel):\n"
        f"    id: uuid.UUID\n"
        f"    created_at: str\n"
        f"    updated_at: str\n"
        f"\n"
        f"\n"
        f"@router.post(\"/\", response_model={cls}Response, status_code=status.HTTP_201_CREATED)\n"
        f"async def create_{slug}(payload: {cls}CreateRequest) -> {cls}Response:\n"
        f"        # TODO[3.2/v0.2]\n"
        f'        raise HTTPException(status_code=501, detail="not implemented")\n'
        f"\n"
        f"\n"
        f"@router.get(\"/{{entity_id}}\", response_model={cls}Response)\n"
        f"async def get_{slug}(entity_id: uuid.UUID) -> {cls}Response:\n"
        f"        # TODO[3.2/v0.2]\n"
        f'        raise HTTPException(status_code=501, detail="not implemented")\n'
        f"\n"
        f"\n"
        f"@router.get(\"/\", response_model=List[{cls}Response])\n"
        f"async def list_{slug}(limit: int = 50, offset: int = 0) -> List[{cls}Response]:\n"
        f"        # TODO[3.2/v0.2]\n"
        f'        raise HTTPException(status_code=501, detail="not implemented")\n'
    )
    return body, Language.PYTHON


def _tpl_test(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    """Render a pytest test scaffold with happy-path + AC failure case stubs."""
    cls = _class_name(task.title)
    test_cls = f"Test{cls}"
    header = _header_comment(
        Language.PYTHON, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description
    )
    body = (
        f"{header}\n"
        f"from __future__ import annotations\n"
        f"\n"
        f"import pytest\n"
        f"\n"
        f"\n"
        f"class {test_cls}:\n"
        f'    """Unit tests for {cls}. v0.1 scaffold — fill bodies in v0.2."""\n'
        f"\n"
        f"    def test_constructor_happy_path(self):\n"
        f"        # TODO[3.2/v0.2]: construct a valid {cls} and assert fields\n"
        f'        pytest.skip("scaffold-only — body in v0.2")\n'
        f"\n"
        f"    def test_validate_rejects_invalid_input(self):\n"
        f"        # TODO[3.2/v0.2]: assert validate() raises on bad input\n"
        f'        pytest.skip("scaffold-only — body in v0.2")\n'
        f"\n"
        f"    def test_to_dict_round_trip(self):\n"
        f"        # TODO[3.2/v0.2]: assert to_dict → from_row is identity\n"
        f'        pytest.skip("scaffold-only — body in v0.2")\n'
    )
    return body, Language.PYTHON


def _tpl_config(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    body = (
        f"{_header_comment(Language.YAML, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description)}\n"
        f"# v0.1 scaffold — fill in key-value config in v0.2.\n"
        f"# task_id: {task.id}\n"
    )
    return body, Language.YAML


def _tpl_docs(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    body = (
        f"{_header_comment(Language.MARKDOWN, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description)}\n"
        f"\n"
        f"# {task.title}\n"
        f"\n"
        f"<!-- TODO[3.2/v0.2]: write the section body. -->\n"
    )
    return body, Language.MARKDOWN


def _tpl_other(task: Task, plan_id: str, story_id: str) -> Tuple[str, Language]:
    body = (
        f"{_header_comment(Language.MARKDOWN, plan_id, story_id, task.id, task.acceptance_criteria_refs, task.description)}\n"
        f"\n"
        f"<!-- TODO[3.2/v0.2]: unspecified task type — manual handling required. -->\n"
    )
    return body, Language.MARKDOWN


TEMPLATES: Dict[TaskType, Callable[[Task, str, str], Tuple[str, Language]]] = {
    TaskType.MIGRATION: _tpl_migration,
    TaskType.MODEL: _tpl_model,
    TaskType.SERVICE: _tpl_service,
    TaskType.CONTROLLER: _tpl_controller,
    TaskType.TEST: _tpl_test,
    TaskType.CONFIG: _tpl_config,
    TaskType.DOCS: _tpl_docs,
    TaskType.OTHER: _tpl_other,
}


# ---------------------------------------------------------------------------
# Public input / output bundles
# ---------------------------------------------------------------------------

@dataclass
class CodeInputs:
    """Input bundle for the Coding Agent.

    `plan` is the Story Planner's output (Sub-goal 3.1). `design_context`
    is the architecture spec (Epic 2) and conventions; v0.1 doesn't read
    it, v0.2 will. `diff_id` is optional — defaults to a stable
    derivation from `plan_id`.
    """

    plan: PlanOutput
    design_context: Optional[Dict[str, Any]] = None
    diff_id: Optional[str] = None


@dataclass
class CodeOutputs:
    """Output bundle — what the orchestrator / Reviewer consume."""

    diff: CodeDiff


# ---------------------------------------------------------------------------
# The Coding Agent
# ---------------------------------------------------------------------------

class Coding:
    """Deterministic Plan → Code Diff transformer. v0.1 is pure Python; no I/O.

    Usage:
        coding = Coding()
        out = coding.code(CodeInputs(plan=plan))
        # out.diff is a CodeDiff with file changes, unified diff, and summary
    """

    # Path hints that should always render as test scaffolds, even if
    # the planner tagged the task with a different (legacy) type.
    TEST_PATH_HINTS = ("/test/", "/tests/")

    def __init__(self) -> None:
        pass

    # --- public API -------------------------------------------------------

    def code(self, inputs: CodeInputs) -> CodeOutputs:
        plan = inputs.plan
        plan_id = plan.plan_id
        story_id = plan.story_id
        # design_context is wired in v0.2; v0.1 ignores it but reserves
        # the seam so the public API stays stable.
        _ = inputs.design_context

        # 1. Build FileChange list (sorted by task id, then file index)
        files: List[FileChange] = []
        for task in sorted(plan.tasks, key=lambda t: t.id):
            for path in task.files_touched:
                normalized = _normalize_path(path)
                body, language = self._render(task, plan_id, story_id, normalized)
                files.append(
                    FileChange(
                        path=normalized,
                        action=FileAction.CREATE,
                        content=body,
                        language=language,
                        task_id=task.id,
                        task_type=task.type.value,
                        ac_refs=list(task.acceptance_criteria_refs),
                        description=task.title,
                    )
                )

        # 2. Build unified diff
        unified = self._build_unified_diff(files)

        # 3. Build summary
        summary = self._summarize(files, plan)

        # 4. Build CodeDiff envelope
        diff = CodeDiff(
            diff_id=inputs.diff_id or derive_diff_id(plan_id),
            plan_id=plan_id,
            story_id=story_id,
            files=files,
            unified_diff=unified,
            summary=summary,
            generated_at=_utcnow_iso(),
        )

        # 5. Validate
        errors = diff.validate()
        if errors:
            raise CodingError(
                f"coding produced an invalid diff for plan {plan_id}: "
                + "; ".join(errors)
            )

        return CodeOutputs(diff=diff)

    # --- internals --------------------------------------------------------

    def _render(
        self, task: Task, plan_id: str, story_id: str, path: str
    ) -> Tuple[str, Language]:
        """Dispatch to the right template; tolerate test paths even when
        the planner tagged the task with a non-test type."""
        is_test_path = any(hint in path for hint in self.TEST_PATH_HINTS)
        if is_test_path and task.type not in (TaskType.TEST,):
            return _tpl_test(task, plan_id, story_id)
        if task.type not in TEMPLATES:
            raise CodingError(f"unsupported task type: {task.type}")
        return TEMPLATES[task.type](task, plan_id, story_id)

    def _build_unified_diff(self, files: List[FileChange]) -> str:
        """Build a single concatenated unified-diff string for all files.

        Each file produces a `diff --git`/`--- /dev/null`/`+++ b/<path>`
        block followed by the new content with `+` prefixes.
        """
        chunks: List[str] = []
        for f in files:
            from_lines: List[str] = []
            to_lines = f.content.splitlines(keepends=True)
            if to_lines and not to_lines[-1].endswith("\n"):
                to_lines[-1] = to_lines[-1] + "\n"
            diff_iter = difflib.unified_diff(
                from_lines,
                to_lines,
                fromfile="/dev/null",
                tofile=f"b/{f.path}",
                lineterm="",
            )
            block = "".join(line + "\n" for line in diff_iter)
            chunks.append(block)
        joined = "\n".join(chunks).rstrip("\n")
        return joined + "\n" if joined else ""

    def _summarize(self, files: List[FileChange], plan: PlanOutput) -> CodeDiffSummary:
        total_lines = sum(f.content.count("\n") for f in files)
        lines_added = total_lines  # v0.1 only emits CREATE
        lines_removed = 0  # modify/delete land in v0.2
        by_language: Dict[str, int] = {}
        for f in files:
            by_language[f.language.value] = by_language.get(f.language.value, 0) + 1
        ac_refs = sorted({r for f in files for r in f.ac_refs})
        task_ids = sorted({f.task_id for f in files})
        return CodeDiffSummary(
            total_files=len(files),
            total_lines=total_lines,
            lines_added=lines_added,
            lines_removed=lines_removed,
            by_language=by_language,
            ac_coverage=ac_refs,
            task_coverage=task_ids,
        )


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class CodingError(RuntimeError):
    """Raised when the Coding Agent cannot produce a valid diff."""


# ---------------------------------------------------------------------------
# Convenience entry point — what the smoke test / orchestrator call
# ---------------------------------------------------------------------------

def code_for_plan(
    plan: PlanOutput, design_context: Optional[Dict[str, Any]] = None
) -> CodeDiff:
    """One-shot code diff. Equivalent to `Coding().code(CodeInputs(plan=plan))`."""
    return Coding().code(CodeInputs(plan=plan, design_context=design_context)).diff
