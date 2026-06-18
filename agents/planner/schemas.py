"""
Schemas for the Planning Agent's input and output.

The Planning Agent converts an approved story + acceptance criteria + design
into a concrete, ordered task list. This is the contract the Coding Agent
reads; a change here is a breaking change to the Dev pipeline.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum


class TaskType(str, Enum):
    """Types of tasks the planner can emit."""
    MIGRATION = "migration"
    MODEL = "model"
    SERVICE = "service"
    CONTROLLER = "controller"
    TEST = "test"
    CONFIG = "config"
    DOCS = "docs"
    OTHER = "other"


class TaskStatus(str, Enum):
    """Status of a task in the plan."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    BLOCKED = "blocked"
    SKIPPED = "skipped"


@dataclass
class Task:
    """A single task in the implementation plan."""
    id: str
    type: TaskType
    title: str
    description: str
    files_touched: List[str] = field(default_factory=list)
    depends_on: List[str] = field(default_factory=list)  # other task IDs
    acceptance_criteria_refs: List[str] = field(default_factory=list)  # AC IDs from the story
    effort: str = "M"  # XS, S, M, L, XL
    status: TaskStatus = TaskStatus.PENDING
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["type"] = self.type.value
        out["status"] = self.status.value
        return out


@dataclass
class PlanContext:
    """Input context the planner receives from upstream stages."""
    story_id: str
    story_title: str
    story_description: str
    acceptance_criteria: List[Dict[str, Any]]  # from Epic 1
    design_doc_path: Optional[str] = None  # path to docs/architecture/<story-id>.md
    design_doc_content: Optional[str] = None
    tech_stack: Optional[Dict[str, Any]] = None  # from workspace/project/tech-stack.md
    conventions: Optional[str] = None  # from workspace/customer/conventions.md

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PlanOutput:
    """The planner's output: a validated plan document and task list."""
    story_id: str
    plan_id: str
    tasks: List[Task]
    plan_markdown: str
    generated_at: str
    schema_version: str = "0.1.0"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["tasks"] = [t.to_dict() for t in self.tasks]
        return out

    def validate(self) -> List[str]:
        """Validate the plan. Returns list of errors; empty = valid."""
        errors: List[str] = []

        if not self.story_id:
            errors.append("story_id is required")
        if not self.plan_id:
            errors.append("plan_id is required")
        if not self.tasks:
            errors.append("plan must contain at least one task")

        seen_ids = set()
        for task in self.tasks:
            if task.id in seen_ids:
                errors.append(f"duplicate task id: {task.id}")
            seen_ids.add(task.id)

            if task.type not in TaskType:
                errors.append(f"task {task.id}: invalid type {task.type}")

            # Validate dependencies exist
            for dep in task.depends_on:
                if dep not in seen_ids:
                    errors.append(f"task {task.id}: depends on unknown task {dep}")

            if not task.files_touched:
                errors.append(f"task {task.id}: must declare at least one file_touched")

            if not task.acceptance_criteria_refs:
                errors.append(f"task {task.id}: must reference at least one acceptance criterion")

        return errors


# Example task list for reference (matches the design contract example):
EXAMPLE_TASKS = [
    Task(
        id="t-001",
        type=TaskType.MIGRATION,
        title="Create users table migration",
        description="Add users table with id, email, password_hash, created_at, updated_at columns",
        files_touched=["apps/api/src/db/migrations/001_create_users.sql"],
        depends_on=[],
        acceptance_criteria_refs=["ac-1"],
        effort="S",
    ),
    Task(
        id="t-002",
        type=TaskType.MODEL,
        title="Create User model",
        description="Implement User entity with validation and password hashing",
        files_touched=["apps/api/src/models/user.py"],
        depends_on=["t-001"],
        acceptance_criteria_refs=["ac-1"],
        effort="M",
    ),
    Task(
        id="t-003",
        type=TaskType.SERVICE,
        title="Create AuthService",
        description="Implement login, register, token refresh logic",
        files_touched=["apps/api/src/services/auth_service.py"],
        depends_on=["t-002"],
        acceptance_criteria_refs=["ac-1", "ac-2"],
        effort="M",
    ),
    Task(
        id="t-004",
        type=TaskType.CONTROLLER,
        title="Create AuthController",
        description="Implement POST /auth/login, POST /auth/register, POST /auth/refresh endpoints",
        files_touched=["apps/api/src/controllers/auth_controller.py"],
        depends_on=["t-003"],
        acceptance_criteria_refs=["ac-1", "ac-2"],
        effort="M",
    ),
    Task(
        id="t-005",
        type=TaskType.TEST,
        title="Add auth unit tests",
        description="Unit tests for User model, AuthService, AuthController",
        files_touched=["apps/api/test/unit/auth/"],
        depends_on=["t-002", "t-003", "t-004"],
        acceptance_criteria_refs=["ac-1", "ac-2"],
        effort="M",
    ),
    Task(
        id="t-006",
        type=TaskType.TEST,
        title="Add auth integration tests",
        description="Integration tests for login/register flows with real DB",
        files_touched=["apps/api/test/integration/auth/"],
        depends_on=["t-005"],
        acceptance_criteria_refs=["ac-1", "ac-2"],
        effort="L",
    ),
]