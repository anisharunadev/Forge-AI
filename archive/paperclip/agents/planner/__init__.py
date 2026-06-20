"""
Story Planner — converts an approved story + acceptance criteria + design
context into a concrete, ordered task list. The Coding Agent reads this
output; a change here is a breaking change to the Dev pipeline.

Public surface:
    Planner              — the deterministic Story → Plan transformer
    PlannerInputs        — typed input bundle (Story + ACs + design context)
    PlannerOutputs       — typed output bundle (Plan + plan_markdown)
    plan_story           — convenience entry point used by the smoke test
    EXAMPLE_STORY_*      — canonical fixtures for tests / docs / smoke

v0.1 is template-driven (no LLM call): the story shape picks which task
template to apply, the AC IDs become the AC refs, the depends_on graph is
inferred from the canonical ordering. v0.2 will add LLM-assisted story
parsing for free-form Jira descriptions; the public API stays the same.
"""

from .planner import (
    Planner,
    PlannerInputs,
    PlannerOutputs,
    plan_story,
)
from .schemas import (
    PlanContext,
    PlanOutput,
    Task,
    TaskStatus,
    TaskType,
)

__all__ = [
    "Planner",
    "PlannerInputs",
    "PlannerOutputs",
    "plan_story",
    "PlanContext",
    "PlanOutput",
    "Task",
    "TaskStatus",
    "TaskType",
]

__version__ = "0.1.0"
