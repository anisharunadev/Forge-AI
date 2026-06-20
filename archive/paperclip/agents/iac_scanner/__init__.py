"""
IaC Scanner — Epic 5 / Sub-goal 5.3 (FORA-77).

The IaC scanner is the AppSec gate for Infrastructure-as-Code
misconfigurations (Terraform, CloudFormation, Kubernetes, Dockerfile).
It blocks a merge if any HIGH or CRITICAL misconfiguration is
present in the PR's added or updated files. v0 covers AWS-first
with the rule structure extensible to GCP / Azure.

Hard isolation rules (per FORA-77 acceptance criteria):

  1. The agent only reads the immutable handoff artefact and the
     GitHub PR diff filtered to IaC-shaped files. It NEVER reads
     the Coding Agent's prompt, scratch space, or conversation
     log.
  2. The agent runs in a separate process with a separate JWT.
     The runtime enforces a tool allow-list of: read PR diff,
     write PR comment, write scan evidence, write handoff artefact.
     The agent itself asserts the allow-list at start and refuses
     any tool not on it.
  3. HIGH or CRITICAL IaC misconfiguration is ALWAYS `block`.
     There is no override at the agent level; the only override
     is a human security reviewer on the customer side.
  4. The verdict object conforms to v1.0.0 of the Security Agent
     handoff output schema. Breaking changes are a major version
     bump + ADR.

v0 implementation: deterministic, no LLM. The scanners are
checkov (Terraform + CloudFormation), kube-score + conftest
(Kubernetes), and docker-bench (Dockerfile). The agent itself
never invokes commit or merge — it returns a Verdict; the
orchestrator routes on it (`pass` → DevOps, `block` → back to
Coding).

Public surface:

    SCHEMA_VERSION                 — "1.0.0"
    Verdict, Decision              — pass / block enum + strings
    IacSeverity                    — critical / high / medium / low / unknown
    FileType                       — terraform / cloudformation / kubernetes / dockerfile
    ScannerKind                    — checkov / kube-score / conftest / docker-bench
    FileRef                        — path + line + file_type
    IacFinding                     — one IaC misconfiguration finding
    ScanFile                       — one file's worth of scan hits
    ScanResult                     — the scanner output (pre-verdict)
    HandoffInput                   — immutable handoff artefact
    HandoffOutput                  — the v1.0.0 verdict object
    is_iac_filename                — filter helper (FORA-77 hard rule)
    classify_iac_file              — routing helper
    ToolAllowList                  — runtime check + audit seam
    DepScanner                     — the deterministic agent (alias)
    IacScanner                     — the deterministic agent
    IacScannerInputs / IacScannerOutputs — typed bundles
    scan_iac                       — convenience entry point

The audit emit + PR-comment formatter are sibling modules
(`audit.py`, `pr_comment.py`); both share the same isolation rules.
The I/O seams (evidence / artifact / PR comment) live in
`writers.py` and use Protocol-style injection.
"""

from __future__ import annotations

from .audit import (
    AUDIT_SCHEMA_VERSION,
    SecurityAuditRecorder,
    ToolCallRecord,
    record_tool_call,
)
from .isolation import (
    ALLOWED_TOOLS,
    FORBIDDEN_TOOLS,
    AgentRoleError,
    IsolationError,
    ToolAllowList,
    assert_process_identity,
    assert_tool_allowed,
)
from .pr_comment import (
    PRComment,
    assert_comment_has_no_secret,
    build_pr_comment,
    comment_for_block,
    comment_for_pass,
)
from .schemas import (
    SCHEMA_VERSION,
    Decision,
    FileRef,
    FileType,
    HandoffInput,
    HandoffOutput,
    IacFinding,
    IacSeverity,
    ScanFile,
    ScanResult,
    ScannerKind,
    Verdict,
    classify_iac_file,
    derive_artifact_id,
    derive_handoff_id,
    is_iac_filename,
    validate_handoff_output,
)
from .iac_scanner import (
    IacScanner,
    IacScannerInputs,
    IacScannerOutputs,
    ScannerError,
    scan_iac,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    InMemoryEvidenceWriter,
    InMemoryHandoffArtifactWriter,
    InMemoryPRCommentPoster,
    PRCommentPoster,
    default_writers,
)

# Aliases for spec parity with dep_scanner (which exports DepScanner).
DepScanner = IacScanner
DepScannerInputs = IacScannerInputs
DepScannerOutputs = IacScannerOutputs
scan_lockfile = scan_iac  # legacy alias; IaC scanner does not scan a lockfile

__all__ = [
    # Schema + enums
    "SCHEMA_VERSION",
    "Decision",
    "Verdict",
    "IacSeverity",
    "FileType",
    "ScannerKind",
    "FileRef",
    "IacFinding",
    "ScanFile",
    "ScanResult",
    "HandoffInput",
    "HandoffOutput",
    "is_iac_filename",
    "classify_iac_file",
    "derive_handoff_id",
    "derive_artifact_id",
    "validate_handoff_output",
    # Isolation
    "ALLOWED_TOOLS",
    "FORBIDDEN_TOOLS",
    "ToolAllowList",
    "assert_tool_allowed",
    "IsolationError",
    "AgentRoleError",
    "assert_process_identity",
    # Audit
    "AUDIT_SCHEMA_VERSION",
    "SecurityAuditRecorder",
    "ToolCallRecord",
    "record_tool_call",
    # PR comment
    "PRComment",
    "build_pr_comment",
    "comment_for_block",
    "comment_for_pass",
    "assert_comment_has_no_secret",
    # Agent
    "IacScanner",
    "IacScannerInputs",
    "IacScannerOutputs",
    "ScannerError",
    "scan_iac",
    # Legacy aliases (spec parity with dep_scanner)
    "DepScanner",
    "DepScannerInputs",
    "DepScannerOutputs",
    "scan_lockfile",
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
