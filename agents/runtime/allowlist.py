"""
Tool allow-list enforcer (FORA-30 deliverable: tool allow-list per stage).

A sub-agent declares, at construction time, which tools it is allowed
to call in each of the four stages (plan / act / observe / reflect).
The runtime calls `check()` before *every* step; a non-allow-listed
tool call never reaches the handler.

The allow-list is the second line of defence.  The first is the
plan validation that happens before the run starts.  Both exist
because the first line is bypassable (a hand-crafted plan from a
malicious upstream) and the second is enforceable (a class invariant
the runtime never breaks).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Iterable, Mapping, Optional

from .schemas import Stage, ToolNotAllowedError


_log = logging.getLogger("fora.runtime.allowlist")


@dataclass(frozen=True)
class ToolAllowList:
    """Per-stage tool allow-list.

    Usage:

        al = ToolAllowList({
            Stage.PLAN:    {"plan_emitter", "context_loader"},
            Stage.ACT:     {"jira.create_issue", "github.open_pr"},
            Stage.OBSERVE: {"audit_log.read", "jira.search"},
            Stage.REFLECT: {"memory.write"},
        })
        al.check(Stage.ACT, "jira.create_issue")  # ok
        al.check(Stage.ACT, "shell.exec")         # raises ToolNotAllowedError
    """

    by_stage: Mapping[Stage, FrozenSet[str]]
    # The `*` sentinel allows the same set of tools in every stage.  This
    # is the escape hatch for sub-agents whose contract is "I only ever
    # use these two tools and they are safe in every stage."
    catch_all: FrozenSet[str] = field(default_factory=frozenset)

    @classmethod
    def of(cls, mapping: Optional[Dict[Stage, Iterable[str]]] = None,
           catch_all: Optional[Iterable[str]] = None) -> "ToolAllowList":
        return cls(
            by_stage={k: frozenset(v) for k, v in (mapping or {}).items()},
            catch_all=frozenset(catch_all or ()),
        )

    def check(self, stage: Stage, tool: str) -> None:
        """Raise ToolNotAllowedError if `tool` is not in the allow-list
        for `stage`.  The error message names the stage, the tool, and
        the allowed set so the audit log and the developer both know
        what to fix."""
        allowed = self.by_stage.get(stage, frozenset()) | self.catch_all
        if tool in allowed:
            return
        # Log the attempt.  This is the line the Audit system reads.
        _log.warning(
            "tool_not_allowed stage=%s tool=%s allowed=%s",
            stage.value, tool, sorted(allowed),
        )
        raise ToolNotAllowedError(
            f"tool {tool!r} is not allowed in stage {stage.value!r}",
            stage=stage.value,
            tool=tool,
            allowed=sorted(allowed),
        )

    def tools_for(self, stage: Stage) -> FrozenSet[str]:
        """The set of tools allowed in `stage`.  Used by the plan
        validator to refuse a plan that references non-allow-listed
        tools before the run starts."""
        return self.by_stage.get(stage, frozenset()) | self.catch_all

    def is_compatible(self, plan_stages: Iterable[Stage], plan_tools: Iterable[str]) -> bool:
        """Return True iff every (stage, tool) pair in a plan is in the
        allow-list.  Used to validate a plan up-front, before the
        runtime commits to executing it."""
        stages = list(plan_stages)
        tools = list(plan_tools)
        for s, t in zip(stages, tools):
            if t not in self.tools_for(s):
                return False
        return True

    def to_dict(self) -> Dict[str, list]:
        out: Dict[str, list] = {}
        for stage, tools in self.by_stage.items():
            out[stage.value] = sorted(tools)
        out["*"] = sorted(self.catch_all)
        return out
