"""
Reviewer Agent mock fixtures — hand-crafted CodeDiff inputs that
exercise each review path.

These complement `mock_data.py` (which feeds the Planner → Coding
pipeline). Here we build CodeDiff instances directly so the Reviewer
smoke can isolate the rule engine from the planner/coding pipeline.

The three canonical shapes the smoke covers:

  clean_crud      — a well-formed diff. Expect APPROVE, possibly with
                    perf-suggestions and CLN nits.
  insecure_endpoint — a diff with hardcoded secrets, eval(), and SQL
                    string concatenation. Expect REQUEST_CHANGES with
                    ≥3 SECURITY blockers.
  scaffold_only   — the raw v0.1 Coding output (carries
                    TODO[3.2/v0.2] markers by design). Expect APPROVE
                    with TEST_QUALITY nits.
  duplicate_files — two files with byte-identical content. Expect
                    REQUEST_CHANGES is not triggered; only DUP001
                    suggestion.

A 5th fixture `bad_paths` puts a model under /services/ and a
controller under /models/ to exercise ARC001/ARC003.

Each fixture builds via `_make_diff(story_id, plan_id, files)` which
computes a stable summary, so the Reviewer smoke can assert against
the diff's `summary` field.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List

from .schemas import (
    CodeDiff,
    CodeDiffSummary,
    FileAction,
    FileChange,
    Language,
    derive_diff_id,
)


def _ext_lang(path: str) -> Language:
    if path.endswith(".py"):
        return Language.PYTHON
    if path.endswith(".sql"):
        return Language.SQL
    if path.endswith(".yaml") or path.endswith(".yml"):
        return Language.YAML
    if path.endswith(".md"):
        return Language.MARKDOWN
    if path.endswith(".json"):
        return Language.JSON
    return Language.UNKNOWN


def _make_diff(story_id: str, plan_id: str, files: List[Dict[str, Any]]) -> CodeDiff:
    """Construct a CodeDiff from a list of file spec dicts.

    Each spec dict: {path, content, task_id, task_type, ac_refs}
    """
    plan_id_str = plan_id
    file_changes: List[FileChange] = []
    total_lines = 0
    by_language: Dict[str, int] = {}
    ac_refs: set = set()
    task_ids: set = set()
    for spec in files:
        path = spec["path"]
        content = spec["content"]
        lang = _ext_lang(path)
        file_changes.append(
            FileChange(
                path=path,
                action=FileAction.CREATE,
                content=content,
                language=lang,
                task_id=spec["task_id"],
                task_type=spec["task_type"],
                ac_refs=list(spec.get("ac_refs", [])),
                description=spec.get("description", ""),
            )
        )
        total_lines += content.count("\n")
        by_language[lang.value] = by_language.get(lang.value, 0) + 1
        ac_refs.update(spec.get("ac_refs", []))
        task_ids.add(spec["task_id"])

    # Minimal valid unified diff (sufficient for Reviewer — it only reads `files`).
    unified = ""
    for fc in file_changes:
        unified += f"diff --git a/{fc.path} b/{fc.path}\n"
        unified += f"new file mode 100644\n"
        unified += f"--- /dev/null\n"
        unified += f"+++ b/{fc.path}\n"
        for line in fc.content.splitlines():
            unified += f"+{line}\n"

    summary = CodeDiffSummary(
        total_files=len(file_changes),
        total_lines=total_lines,
        lines_added=total_lines,
        lines_removed=0,
        by_language=by_language,
        ac_coverage=sorted(ac_refs),
        task_coverage=sorted(task_ids),
    )

    return CodeDiff(
        diff_id=derive_diff_id(plan_id_str),
        plan_id=plan_id_str,
        story_id=story_id,
        files=file_changes,
        unified_diff=unified,
        summary=summary,
        generated_at="2026-06-18T00:00:00Z",
    )


# ---------------------------------------------------------------------------
# Fixture 1 — clean_crud
# A well-formed CRUD diff. Expect APPROVE; maybe a few nits.
# ---------------------------------------------------------------------------

_CLEAN_USER_MIGRATION = """-- Auto-generated scaffold.
-- plan_id: PLAN-401  story_id: STORY-401  task_id: T-401
-- description: users table

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
"""

_CLEAN_USER_MODEL = '''"""
Auto-generated scaffold.
plan_id: PLAN-401  story_id: STORY-401  task_id: T-402

User entity.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass
class User:
    id: uuid.UUID
    email: str
    password_hash: str
    created_at: datetime
    updated_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "email": self.email,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
'''

_CLEAN_USER_SERVICE = '''"""
User service. async CRUD with pagination.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional


class UserService:
    """CRUD + business logic for User."""

    def __init__(self, db):
        self._db = db

    async def create(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        # TODO[3.2/v0.2]: validate, persist, return created entity
        raise NotImplementedError

    async def get(self, entity_id: uuid.UUID) -> Optional[Dict[str, Any]]:
        # TODO[3.2/v0.2]
        raise NotImplementedError

    async def list(self, *, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        # TODO[3.2/v0.2]
        raise NotImplementedError

    async def update(self, entity_id: uuid.UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
        # TODO[3.2/v0.2]
        raise NotImplementedError

    async def delete(self, entity_id: uuid.UUID) -> None:
        # TODO[3.2/v0.2]
        raise NotImplementedError
'''

_CLEAN_USER_CONTROLLER = '''"""
User controller.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

router = APIRouter(prefix="/users", tags=["users"])


class UserCreateRequest(BaseModel):
    email: str
    password_hash: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreateRequest) -> UserResponse:
    # TODO[3.2/v0.2]
    raise HTTPException(status_code=501, detail="not implemented")


@router.get("/{entity_id}", response_model=UserResponse)
async def get_user(entity_id: uuid.UUID) -> UserResponse:
    # TODO[3.2/v0.2]
    raise HTTPException(status_code=501, detail="not implemented")


@router.get("/", response_model=List[UserResponse])
async def list_users(limit: int = 50, offset: int = 0) -> List[UserResponse]:
    # TODO[3.2/v0.2]
    raise HTTPException(status_code=501, detail="not implemented")
'''

_CLEAN_USER_TEST = '''"""Unit tests for User."""
from __future__ import annotations

import pytest


class TestUser:
    """Unit tests for User."""

    def test_constructor_happy_path(self):
        # TODO[3.2/v0.2]
        pytest.skip("scaffold-only")

    def test_validate_rejects_invalid_input(self):
        # TODO[3.2/v0.2]
        pytest.skip("scaffold-only")

    def test_to_dict_round_trip(self):
        # TODO[3.2/v0.2]
        pytest.skip("scaffold-only")
'''


def make_clean_crud_diff() -> CodeDiff:
    """A clean CRUD diff — expect APPROVE with at most a few nits."""
    return _make_diff(
        story_id="STORY-401",
        plan_id="PLAN-401",
        files=[
            {"path": "apps/users/src/db/migrations/001_create_users.sql",
             "content": _CLEAN_USER_MIGRATION, "task_id": "T-401",
             "task_type": "migration", "ac_refs": ["ac-1"]},
            {"path": "apps/users/src/models/user.py",
             "content": _CLEAN_USER_MODEL, "task_id": "T-402",
             "task_type": "model", "ac_refs": ["ac-1", "ac-2"]},
            {"path": "apps/users/src/services/user_service.py",
             "content": _CLEAN_USER_SERVICE, "task_id": "T-403",
             "task_type": "service", "ac_refs": ["ac-1", "ac-2", "ac-3"]},
            {"path": "apps/users/src/controllers/user_controller.py",
             "content": _CLEAN_USER_CONTROLLER, "task_id": "T-404",
             "task_type": "controller", "ac_refs": ["ac-1", "ac-2", "ac-3"]},
            {"path": "apps/users/test/unit/user_test.py",
             "content": _CLEAN_USER_TEST, "task_id": "T-405",
             "task_type": "test", "ac_refs": ["ac-1", "ac-2"]},
        ],
    )


# ---------------------------------------------------------------------------
# Fixture 2 — insecure_endpoint
# Hardcoded secrets + eval() + SQL string concat. Expect REQUEST_CHANGES.
# ---------------------------------------------------------------------------

_INSECURE_LOGIN_SERVICE = '''"""
Login service. (INCLUDES SECURITY ANTI-PATTERNS for review.)
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Dict, Optional


class LoginService:
    """Authenticate users and issue JWTs."""

    def __init__(self, db):
        self._db = db

    async def authenticate(self, email: str, password: str) -> Optional[Dict[str, Any]]:
        # SECURITY: hardcoded credential — should be flagged.
        api_key = "sk_test_1234567890abcdef"
        # SECURITY: SQL injection via f-string.
        query = f"SELECT * FROM users WHERE email = '{email}' AND password_hash = '{password}'"
        row = await self._db.fetchrow(query)
        if row is None:
            return None
        # SECURITY: eval call.
        result = eval(f"{{'user_id': '{row['id']}', 'role': 'member'}}")
        return result
'''


def make_insecure_endpoint_diff() -> CodeDiff:
    """Diff with hardcoded secret, eval, and SQL injection — expect REQUEST_CHANGES."""
    return _make_diff(
        story_id="STORY-402",
        plan_id="PLAN-402",
        files=[
            {"path": "apps/auth/src/services/login_service.py",
             "content": _INSECURE_LOGIN_SERVICE, "task_id": "T-501",
             "task_type": "service", "ac_refs": ["ac-1"]},
        ],
    )


# ---------------------------------------------------------------------------
# Fixture 3 — scaffold_only
# Raw v0.1 Coding output (carries TODO[3.2/v0.2] markers). Expect APPROVE.
# ---------------------------------------------------------------------------


def make_scaffold_only_diff() -> CodeDiff:
    """Build a CodeDiff by running the Coding Agent on `crud_user` fixture."""
    from .coding import code_for_plan
    from .mock_data import build_plan_for
    return code_for_plan(build_plan_for("crud_user"))


# ---------------------------------------------------------------------------
# Fixture 4 — duplicate_files
# Two files with byte-identical content. Expect DUP001 SUGGESTION only.
# ---------------------------------------------------------------------------

_IDENTICAL_A = '''"""
Twin module.
"""

def hello() -> str:
    return "hello"
'''

_IDENTICAL_B = '''"""
Twin module.
"""

def hello() -> str:
    return "hello"
'''


def make_duplicate_files_diff() -> CodeDiff:
    """Two byte-identical files — expect DUP001 SUGGESTION."""
    return _make_diff(
        story_id="STORY-403",
        plan_id="PLAN-403",
        files=[
            {"path": "apps/x/src/utils/a.py",
             "content": _IDENTICAL_A, "task_id": "T-601",
             "task_type": "other", "ac_refs": ["ac-1"]},
            {"path": "apps/x/src/utils/b.py",
             "content": _IDENTICAL_B, "task_id": "T-602",
             "task_type": "other", "ac_refs": ["ac-1"]},
        ],
    )


# ---------------------------------------------------------------------------
# Fixture 5 — bad_paths
# A model under /services/ and a controller under /models/.
# Expect ARC001 + ARC003 BLOCKERs.
# ---------------------------------------------------------------------------

_BAD_MODEL_IN_SERVICES = '''"""
Model placed under /services/ by mistake.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass
class Widget:
    id: uuid.UUID
    name: str
'''

_BAD_CONTROLLER_IN_MODELS = '''"""
Controller placed under /models/ by mistake.
"""
from __future__ import annotations

import uuid
from fastapi import APIRouter

router = APIRouter(prefix="/widget", tags=["widget"])


async def get_widget(entity_id: uuid.UUID) -> dict:
    return {"id": str(entity_id)}
'''


def make_bad_paths_diff() -> CodeDiff:
    """Wrong-path file placement — expect ARC001 + ARC003 BLOCKERs."""
    return _make_diff(
        story_id="STORY-404",
        plan_id="PLAN-404",
        files=[
            {"path": "apps/widgets/src/services/widget.py",
             "content": _BAD_MODEL_IN_SERVICES, "task_id": "T-701",
             "task_type": "model", "ac_refs": ["ac-1"]},
            {"path": "apps/widgets/src/models/widget_controller.py",
             "content": _BAD_CONTROLLER_IN_MODELS, "task_id": "T-702",
             "task_type": "controller", "ac_refs": ["ac-1"]},
        ],
    )


# ---------------------------------------------------------------------------
# Convenience list
# ---------------------------------------------------------------------------


ALL_REVIEWER_FIXTURES = {
    "clean_crud": make_clean_crud_diff,
    "insecure_endpoint": make_insecure_endpoint_diff,
    "scaffold_only": make_scaffold_only_diff,
    "duplicate_files": make_duplicate_files_diff,
    "bad_paths": make_bad_paths_diff,
}