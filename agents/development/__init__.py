"""
Coding Agent (3.2 / FORA-70) and Reviewer Agent (3.3 / FORA-71).

The Coding Agent reads the Planner's output (Sub-goal 3.1) and emits:

  - a list of FileChange records (one per file the plan touches)
  - a unified-diff string ready for `git apply` or a GitHub MCP PR
  - a CodeDiffSummary with file/line counts and AC + task coverage

The Reviewer Agent reads the Coding Agent's CodeDiff and emits:

  - a list of ReviewFinding records (severity × category × rule_id)
  - an APPROVE / REQUEST_CHANGES verdict
  - a ReviewSummary with per-severity / per-category counts
  - inline-comment anchors ready for the GitHub MCP to post

Both agents are v0.1 deterministic (no LLM call); v0.2 will swap the
template / rule bodies for LLM-generated content while keeping the
public API stable.

Hard rule (per Epic 3): no direct commit. The agents return their
artefacts; an operator or orchestrator decides how to apply / post them.

Public surface:

    Coding                — deterministic Plan → Code Diff transformer
    CodeInputs            — typed input bundle (plan + optional design context)
    CodeOutputs           — typed output bundle (diff)
    code_for_plan         — convenience entry point for the smoke test
    CodeDiff              — the envelope: diff_id, files, unified_diff, summary
    FileChange            — one file's path, action, content, language, traceability
    FileAction            — CREATE / MODIFY / DELETE
    Language              — PYTHON / SQL / YAML / MARKDOWN / JSON / UNKNOWN
    CodeDiffSummary       — file/line counts + AC and task coverage
    derive_diff_id        — stable diff id from plan_id
    CodingError           — raised on invalid input

    Reviewer              — deterministic CodeDiff → ReviewReport transformer
    ReviewerInputs        — typed input bundle (diff + optional design context)
    ReviewerOutputs       — typed output bundle (report)
    review_diff           — convenience entry point for the smoke test
    ReviewReport          — the envelope: report_id, findings, verdict, summary
    ReviewFinding         — one finding (severity, category, rule_id, locations)
    ReviewSummary         — per-severity / per-category counts
    Severity              — BLOCKER / SUGGESTION / NIT
    FindingCategory       — clean_code / architecture / performance /
                            security / duplication / test_quality
    Verdict               — APPROVE / REQUEST_CHANGES
    InlineLocation        — file:line anchor for inline comments
    ReviewerError         — raised on invalid input
"""

from .coding import (
    Coding,
    CodeInputs,
    CodeOutputs,
    CodingError,
    code_for_plan,
)
from .reviewer import (
    Reviewer,
    ReviewerError,
    ReviewerInputs,
    ReviewerOutputs,
    review_diff,
)
from .schemas import (
    CodeDiff,
    CodeDiffSummary,
    FileAction,
    FileChange,
    FindingCategory,
    InlineLocation,
    Language,
    ReviewFinding,
    ReviewReport,
    ReviewSummary,
    Severity,
    Verdict,
    derive_diff_id,
    derive_report_id,
)

__all__ = [
    # Coding Agent
    "Coding",
    "CodeInputs",
    "CodeOutputs",
    "CodingError",
    "code_for_plan",
    "CodeDiff",
    "CodeDiffSummary",
    "FileAction",
    "FileChange",
    "Language",
    "derive_diff_id",
    # Reviewer Agent
    "Reviewer",
    "ReviewerError",
    "ReviewerInputs",
    "ReviewerOutputs",
    "review_diff",
    "ReviewReport",
    "ReviewFinding",
    "ReviewSummary",
    "Severity",
    "FindingCategory",
    "Verdict",
    "InlineLocation",
    "derive_report_id",
]

__version__ = "0.1.0"