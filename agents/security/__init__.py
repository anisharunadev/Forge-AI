"""
Security Agent — Epic 5 / Sub-goal 5.1 (FORA-74).

The Security Agent is the AppSec gate between the Coding Agent
(3.2 / FORA-70) and the DevOps Agent (Epic 6). It blocks a merge
if any secret — AWS keys, passwords, tokens, private keys,
.env values, connection strings — is present in the PR diff or
the repository history.

Hard isolation rules (per FORA-74 acceptance criteria):

  1. The agent only reads the immutable handoff artefact (the PR
     diff digest and the file paths) and the GitHub PR diff. It
     NEVER reads the Coding Agent's prompt, scratch space, or
     conversation log.
  2. The agent runs in a separate process with a separate JWT.
     The runtime enforces a tool allow-list of: read PR diff,
     write PR comment, write scan evidence, write handoff artefact.
     The agent itself asserts the allow-list at start and refuses
     any tool not on it.
  3. The verdict object conforms to v1.0.0 of the Security Agent
     handoff output schema. Breaking changes are a major version
     bump + ADR.

v0 implementation: deterministic, no LLM. The scanners are
gitleaks (per-PR gate, fast and deterministic) and trufflehog
(weekly full-history, higher recall). The agent itself never
invokes commit or merge — it returns a Verdict; the orchestrator
routes on it (`pass` → DevOps, `block` → back to Coding).

Public surface:

    SCHEMA_VERSION                 — "1.0.0"
    Verdict, Decision              — pass / block enum + strings
    SecretSeverity                 — critical / high / medium / low
    SecretCategory                 — aws_access_key, github_pat, ...
    SecretFinding                  — one sanitised finding
    ScanDiff                       — one file's worth of scan hits
    ScanResult                     — the scanner output (pre-verdict)
    HandoffInput                   — immutable handoff artefact
    HandoffOutput                  — the v1.0.0 verdict object
    ToolAllowList                  — the four tools the agent may call
    SecretScanner                  — the deterministic agent
    ScannerInputs / ScannerOutputs — typed bundles
    scan_pr                        — convenience entry point
    redact_secret                  — never-leak helper

The audit emit + PR-comment formatter are sibling modules
(`audit.py`, `pr_comment.py`); both share the same isolation rules.
The I/O seams (evidence / artifact / PR comment) live in
`writers.py` and use Protocol-style injection.
"""

from __future__ import annotations

from .audit import (
    SecurityAuditRecorder,
    ToolCallRecord,
    record_tool_call,
)
from .isolation import (
    ALLOWED_TOOLS,
    ToolAllowList,
    assert_tool_allowed,
    IsolationError,
    assert_process_identity,
)
from .pr_comment import (
    build_pr_comment,
    comment_for_block,
    comment_for_pass,
    assert_comment_has_no_secret,
)
from .schemas import (
    SCHEMA_VERSION,
    Decision,
    HandoffInput,
    HandoffOutput,
    ScanDiff,
    ScanResult,
    SecretCategory,
    SecretFinding,
    SecretSeverity,
    Verdict,
    derive_handoff_id,
    redact_secret,
    validate_handoff_output,
)
from .secret_scanner import (
    ScannerInputs,
    ScannerOutputs,
    SecretScanner,
    ScannerError,
    scan_pr,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    PRCommentPoster,
    InMemoryEvidenceWriter,
    InMemoryHandoffArtifactWriter,
    InMemoryPRCommentPoster,
    default_writers,
)

__all__ = [
    # Schema + enums
    "SCHEMA_VERSION",
    "Decision",
    "Verdict",
    "SecretSeverity",
    "SecretCategory",
    "SecretFinding",
    "ScanDiff",
    "ScanResult",
    "HandoffInput",
    "HandoffOutput",
    "derive_handoff_id",
    "validate_handoff_output",
    "redact_secret",
    # Isolation
    "ALLOWED_TOOLS",
    "ToolAllowList",
    "assert_tool_allowed",
    "IsolationError",
    "assert_process_identity",
    # Audit
    "SecurityAuditRecorder",
    "ToolCallRecord",
    "record_tool_call",
    # PR comment
    "build_pr_comment",
    "comment_for_block",
    "comment_for_pass",
    "assert_comment_has_no_secret",
    # Agent
    "SecretScanner",
    "ScannerInputs",
    "ScannerOutputs",
    "ScannerError",
    "scan_pr",
    # I/O seams
    "EvidenceWriter",
    "HandoffArtifactWriter",
    "PRCommentPoster",
    "InMemoryEvidenceWriter",
    "InMemoryHandoffArtifactWriter",
    "InMemoryPRCommentPoster",
    "default_writers",
]

__version__ = SCHEMA_VERSION
