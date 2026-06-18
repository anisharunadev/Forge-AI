"""
Schemas for the Ideation Agent's input and output.

These are the contract every other stage will read. Schemas live next
to the agent that emits them so the agent's docs, prompts, and tests
all stay in sync.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Input signal: a slice of evidence from one source.
# ---------------------------------------------------------------------------

@dataclass
class InputSignal:
    """A normalized evidence slice from one external source."""
    source: str                # "jira" | "github" | "zendesk" | ...
    fetched_at: str            # ISO 8601
    mode: str                  # "live" | "sample" — provenance
    items: List[Dict[str, Any]] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Output: the structured epic.
# ---------------------------------------------------------------------------

EFFORT_BUCKETS = ("XS", "S", "M", "L", "XL")
RISK_LEVELS = ("low", "medium", "high")


@dataclass
class UserStory:
    id: str
    role: str
    capability: str
    benefit: str
    priority: str               # "must" | "should" | "could" | "won't"
    story_points: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AcceptanceCriterion:
    id: str
    given: str
    when: str
    then: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Dependency:
    type: str                    # "internal_repo" | "external_system" | "team" | "mcp"
    name: str
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Risk:
    category: str                # "technical" | "operational" | "compliance" | "schedule" | "ux"
    description: str
    level: str                   # "low" | "medium" | "high"
    mitigation: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TechDebtSignal:
    repo: str
    area: str
    finding: str
    severity: str                # "info" | "minor" | "major" | "critical"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ArchitectureImpact:
    services: List[str] = field(default_factory=list)
    data_model_changes: List[str] = field(default_factory=list)
    api_changes: List[str] = field(default_factory=list)
    cross_cutting: List[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Epic:
    id: str
    title: str
    problem_statement: str
    proposed_solution: str
    user_stories: List[UserStory]
    acceptance_criteria: List[AcceptanceCriterion]
    dependencies: List[Dependency]
    effort: str                  # one of EFFORT_BUCKETS
    effort_rationale: str
    risk: str                    # one of RISK_LEVELS
    risk_summary: str
    tech_debt: List[TechDebtSignal]
    architecture_impact: ArchitectureImpact
    sources: List[str] = field(default_factory=list)
    generated_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["user_stories"] = [us.to_dict() for us in self.user_stories]
        out["acceptance_criteria"] = [ac.to_dict() for ac in self.acceptance_criteria]
        out["dependencies"] = [d.to_dict() for d in self.dependencies]
        out["tech_debt"] = [td.to_dict() for td in self.tech_debt]
        out["architecture_impact"] = self.architecture_impact.to_dict()
        return out

    def validate(self) -> List[str]:
        """Returns a list of validation errors; empty list means the epic is valid."""
        errors: List[str] = []
        if not self.id:
            errors.append("epic.id is required")
        if not self.title:
            errors.append("epic.title is required")
        if not self.user_stories:
            errors.append("epic.user_stories must contain at least one story")
        if not self.acceptance_criteria:
            errors.append("epic.acceptance_criteria must contain at least one AC")
        if self.effort not in EFFORT_BUCKETS:
            errors.append(f"epic.effort must be one of {EFFORT_BUCKETS}, got {self.effort!r}")
        if self.risk not in RISK_LEVELS:
            errors.append(f"epic.risk must be one of {RISK_LEVELS}, got {self.risk!r}")
        seen_story_ids = set()
        for us in self.user_stories:
            if us.id in seen_story_ids:
                errors.append(f"duplicate user_story id: {us.id}")
            seen_story_ids.add(us.id)
            if us.priority not in {"must", "should", "could", "won't"}:
                errors.append(f"user_story {us.id} priority must be "
                              f"must/should/could/won't, got {us.priority!r}")
            if us.story_points < 1 or us.story_points > 21:
                errors.append(f"user_story {us.id} story_points out of range: {us.story_points}")
        seen_ac_ids = set()
        for ac in self.acceptance_criteria:
            if ac.id in seen_ac_ids:
                errors.append(f"duplicate acceptance_criterion id: {ac.id}")
            seen_ac_ids.add(ac.id)
        return errors
