"""
Mock data for the Story Planner smoke test.

These fixtures are the canonical "shape" of inputs the planner is expected
to handle in v0.1. The smoke test asserts the planner turns each shape
into a valid, ordered task list with the right AC refs and depends_on
graph.

Adding a new story shape in v0.2? Add a fixture here + a template builder
in planner.py + an assertion in smoke_test_planner.py.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .planner import PlannerInputs


def _ac(id: str, description: str) -> Dict[str, Any]:
    return {"id": id, "description": description}


# --- CRUD entity shape ----------------------------------------------------

CRUD_USER_STORY = PlannerInputs(
    story_id="STORY-101",
    story_title="Add User entity",
    story_description=(
        "Create the User table and CRUD API for the auth service. "
        "Email + password_hash + audit columns; index on email."
    ),
    acceptance_criteria=[
        _ac("ac-1", "POST /users creates a user with email + password_hash"),
        _ac("ac-2", "GET /users/{id} returns the user without password_hash"),
        _ac("ac-3", "GET /users?email=… returns a list (paginated)"),
    ],
    design_doc_path="forge/2.3/lld.md",
    design_doc_content="LLD §2 apps/agent-runtime — Python agent execution.",
    tech_stack={"language": "Python 3.12", "framework": "FastAPI"},
    conventions="workspace/memory/coding.md",
)


# --- API endpoint shape (auth / webhooks) ---------------------------------

AUTH_LOGIN_STORY = PlannerInputs(
    story_id="STORY-202",
    story_title="Implement auth login endpoint",
    story_description=(
        "POST /auth/login accepts email + password, returns access + refresh "
        "tokens. Rate-limited at 5 attempts per minute per email."
    ),
    acceptance_criteria=[
        _ac("ac-1", "Valid credentials return 200 with access + refresh tokens"),
        _ac("ac-2", "Invalid credentials return 401 with the typed error envelope"),
        _ac("ac-3", "Rate limit triggers 429 after 5 failed attempts in 60s"),
    ],
    design_doc_path="forge/2.3/openapi.yaml",
    design_doc_content="OpenAPI 3.1 — securitySchemes + /auth/login path.",
    tech_stack={"language": "Python 3.12", "framework": "FastAPI"},
    conventions="workspace/memory/coding.md",
)


# --- Migration-only shape (schema change) ---------------------------------

ADD_AUDIT_COLUMNS_STORY = PlannerInputs(
    story_id="STORY-303",
    story_title="Add created_by + updated_by audit columns",
    story_description=(
        "Add created_by and updated_by uuid columns to every domain table. "
        "Backfill from the auth.users table for existing rows."
    ),
    acceptance_criteria=[
        _ac("ac-1", "Every domain table has created_by + updated_by uuid FKs"),
        _ac("ac-2", "Down migration reverses the change without data loss"),
    ],
    design_doc_path="forge/2.3/erd.mmd",
    design_doc_content="ERD audit columns convention.",
    tech_stack={"language": "SQL", "framework": "alembic"},
    conventions="workspace/memory/coding.md",
)


# --- All fixtures (used by the smoke) -------------------------------------

ALL_FIXTURES: List[PlannerInputs] = [
    CRUD_USER_STORY,
    AUTH_LOGIN_STORY,
    ADD_AUDIT_COLUMNS_STORY,
]
