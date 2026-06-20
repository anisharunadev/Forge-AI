"""
Dependency Scanner — Epic 5 / Sub-goal 5.2 (FORA-76).

The dep scanner is the AppSec gate for added or updated
dependencies. It blocks a merge if any HIGH or CRITICAL CVE is
present in the PR's added or updated dependencies. Snyk is
optional and behind a customer licence check (FORA-76 open
question).

Hard isolation rules (per FORA-76 acceptance criteria):

  1. The agent only reads the immutable handoff artefact (the PR
     diff digest, the lockfile diff digest, and the file paths)
     and the GitHub PR diff + lockfile diff. It NEVER reads the
     Coding Agent's prompt, scratch space, or conversation log.
  2. The agent runs in a separate process with a separate JWT.
     The runtime enforces a tool allow-list of: read PR diff,
     read lockfile, write PR comment, write scan evidence, write
     SBOM, write handoff artefact. The agent itself asserts the
     allow-list at start and refuses any tool not on it.
  3. HIGH or CRITICAL CVE is ALWAYS `block`. There is no
     override at the agent level; the only override is a human
     security reviewer on the customer side.
  4. The verdict object conforms to v1.0.0 of the Security Agent
     handoff output schema. Breaking changes are a major version
     bump + ADR.

v0 implementation: deterministic, no LLM. The scanners are Trivy
(per-PR gate, fast and deterministic) and Dependabot (full-history,
weekly, advisory-driven). The agent itself never invokes commit
or merge — it returns a Verdict; the orchestrator routes on it
(`pass` → DevOps, `block` → back to Coding).

Public surface:

    SCHEMA_VERSION                 — "1.0.0"
    Verdict, Decision              — pass / block enum + strings
    CveSeverity                    — critical / high / medium / low
    Ecosystem                      — pypi, npm, maven, go, ...
    ScannerKind                    — trivy / dependabot / snyk
    PackageRef                     — ecosystem + name + version
    DependencyFinding              — one CVE finding (sanitised)
    ScanDiff                       — one lockfile's worth of scan hits
    ScanResult                     — the scanner output (pre-verdict)
    SbomRef                        — CycloneDX 1.5 SBOM pointer
    HandoffInput                   — immutable handoff artefact
    HandoffOutput                  — the v1.0.0 verdict object
    ToolAllowList                  — the six tools the agent may call
    DepScanner                     — the deterministic agent
    DepScannerInputs / DepScannerOutputs — typed bundles
    scan_lockfile                  — convenience entry point

The audit emit + PR-comment formatter are sibling modules
(`audit.py`, `pr_comment.py`); both share the same isolation rules.
The SBOM emitter lives in `sbom.py`. The I/O seams (evidence /
SBOM / artifact / PR comment) live in `writers.py` and use
Protocol-style injection.
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
from .sbom import CycloneDxSbom
from .schemas import (
    SCHEMA_VERSION,
    CveSeverity,
    Decision,
    DependencyFinding,
    Ecosystem,
    HandoffInput,
    HandoffOutput,
    PackageRef,
    SbomRef,
    ScanDiff,
    ScanResult,
    ScannerKind,
    Verdict,
    derive_handoff_id,
    derive_sbom_hash,
    validate_handoff_output,
)
from .dep_scanner import (
    DepScanner,
    DepScannerInputs,
    DepScannerOutputs,
    ScannerError,
    scan_lockfile,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    InMemoryEvidenceWriter,
    InMemoryHandoffArtifactWriter,
    InMemoryPRCommentPoster,
    InMemorySbomWriter,
    PRCommentPoster,
    SbomWriter,
    default_writers,
)

__all__ = [
    # Schema + enums
    "SCHEMA_VERSION",
    "Decision",
    "Verdict",
    "CveSeverity",
    "Ecosystem",
    "ScannerKind",
    "DependencyFinding",
    "PackageRef",
    "SbomRef",
    "ScanDiff",
    "ScanResult",
    "HandoffInput",
    "HandoffOutput",
    "derive_handoff_id",
    "derive_sbom_hash",
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
    # SBOM
    "CycloneDxSbom",
    # Agent
    "DepScanner",
    "DepScannerInputs",
    "DepScannerOutputs",
    "ScannerError",
    "scan_lockfile",
    # I/O seams
    "EvidenceWriter",
    "SbomWriter",
    "HandoffArtifactWriter",
    "PRCommentPoster",
    "InMemoryEvidenceWriter",
    "InMemorySbomWriter",
    "InMemoryHandoffArtifactWriter",
    "InMemoryPRCommentPoster",
    "default_writers",
]

__version__ = SCHEMA_VERSION