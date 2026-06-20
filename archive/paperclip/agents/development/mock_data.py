"""
Mock data for the Coding Agent smoke test.

The fixtures are built by running the Story Planner (Sub-goal 3.1) on
canonical story shapes, so the Coding Agent smoke covers the full
planner → coding pipeline. The Coding Agent itself doesn't need to know
about Jira or design docs; the planner hides that.

The fixtures hit all three story shapes the planner handles in v0.1:

  - crud_user     (crud_entity)   — User table + CRUD API
  - api_login     (api_endpoint)  — login endpoint (no migration/model)
  - migration_only (migration_only) — schema-only change with smoke test
"""

from __future__ import annotations

from typing import Any, Dict, List

from agents.planner import Planner, PlannerInputs


def _ac(id: str, description: str) -> Dict[str, Any]:
    return {"id": id, "description": description}


# Module-level fixture dict — stable across runs.
FIXTURES: Dict[str, PlannerInputs] = {
    "crud_user": PlannerInputs(
        story_id="STORY-201",
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
    ),
    "api_login": PlannerInputs(
        story_id="STORY-202",
        story_title="Add login endpoint",
        story_description=(
            "Implement POST /auth/login that returns a JWT. Validates "
            "credentials against the users table."
        ),
        acceptance_criteria=[
            _ac("ac-1", "POST /auth/login returns a JWT on valid creds"),
            _ac("ac-2", "POST /auth/login returns 401 on bad creds"),
        ],
    ),
    "migration_only": PlannerInputs(
        story_id="STORY-203",
        story_title="Add email index migration",
        story_description=(
            "Add a unique index on users.email to back the new "
            "GET /users?email=… query."
        ),
        acceptance_criteria=[
            _ac("ac-1", "Index is created in a forward migration"),
            _ac("ac-2", "Index is dropped in the down migration"),
        ],
    ),
}


ALL_FIXTURES: List[str] = list(FIXTURES.keys())


def build_plan_for(story_id: str):
    """Return a PlanOutput for the named story fixture.

    The plan is computed at call time so the smoke test can assert
    determinism (AC#17) by comparing two `code()` calls on the same
    plan instance.
    """
    if story_id not in FIXTURES:
        raise KeyError(f"unknown fixture story_id: {story_id}")
    return Planner().plan(FIXTURES[story_id]).plan
