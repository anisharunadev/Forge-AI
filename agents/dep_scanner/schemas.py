"""
Schemas for the Dependency Scanner (FORA-76, Sub-goal 5.2).

Defines the v1.0.0 handoff output schema that:

  - Coding (3.2) hands a PlanOutput + lockfile diff digest to Security.
  - Dependency scanner runs Trivy + Dependabot and emits a HandoffOutput.
  - On `pass`, DevOps (6.1 / 6.2) consumes the artefact.
  - On `block`, the orchestrator loops back to Coding with the
    sanitised findings (no internal CVE detail beyond what the
    orchestrator needs to plan a fix).

The envelope is a strict superset of the FORA-74 SecretScanner
contract — `decision`, `verdict`, `findings`, `severity_counts`,
`scanners_used`, `scanner_versions`, `pr_comment_posted`,
`evidence_audit_id`, `schema_version` all carry the same field
names and values. New fields:

  - `sbom` — the CycloneDX 1.5 SBOM attached to the run
             (artifact_id + sha256 + format + component_count).
             AC #4 requires an SBOM on every run.
  - `mode` — "per_pr" (default) or "full_history" (Dependabot).

A change here is a breaking change to the Security Agent contract;
bump `SCHEMA_VERSION` and update the worked example in the ADR
together.

Hard rules (per FORA-76):

  - High or critical CVE is ALWAYS `block`. There is no override
    at the agent level; the only override is a human security
    reviewer on the customer side.
  - Output schema version is `1.0.0`.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


SCHEMA_VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Verdict(str, Enum):
    """The scanner verdict posted to the orchestrator.

    PASS   — no high/critical findings; merge may proceed.
    BLOCK  — at least one finding; merge blocked.

    The verdict is a *machine-readable* signal; the PR comment is
    the human-readable form. They MUST agree: verdict == PASS iff
    findings == [].
    """

    PASS = "pass"
    BLOCK = "block"


# Alias for readability inside the handoff output ("decision" reads more
# naturally to a human reviewer than "verdict").
Decision = Verdict


class CveSeverity(str, Enum):
    """CVE severity classes (Trivy / NVD aligned).

    CRITICAL — must be fixed before merge. Forces `block`.
    HIGH     — must be fixed before merge. Forces `block`.
    MEDIUM   — should be fixed before merge. Forces `block`.
    LOW      — informational. Forces `block` (we don't pass on
               LOW-only scans because transitive CVE lists are
               noisy and the orchestrator's reviewer can downgrade).

    The contract (per FORA-76 issue body and §4 of the Security
    Agent Design) is: CRITICAL or HIGH ⇒ BLOCK always. MEDIUM
    ⇒ BLOCK. LOW ⇒ BLOCK. There is no agent-level override.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Ecosystem(str, Enum):
    """The package ecosystem the scanner reported a finding against.

    The ecosystem drives the remediation hint in the PR comment
    AND the SBOM component classifier (CycloneDX 1.5). Names are
    stable; adding a new ecosystem is a minor version bump + ADR.
    """

    PYPI = "pypi"
    NPM = "npm"
    MAVEN = "maven"
    GO = "go"
    NUGET = "nuget"
    RUBYGEMS = "rubygems"
    CARGO = "cargo"
    COMPOSER = "composer"
    GENERIC = "generic"


class ScannerKind(str, Enum):
    """Which scanner produced the finding.

    v0 supports Trivy (per-PR gate, fast, deterministic) and
    Dependabot (full-history, weekly, advisory-driven). Snyk is
    optional and behind a customer licence check (FORA-76 open
    question — we recommend Trivy-only for the OSS gate and Snyk
    behind a feature flag).
    """

    TRIVY = "trivy"
    DEPENDABOT = "dependabot"
    SNYK = "snyk"  # gated on customer licence, v1.1


# Severity mapping for known Trivy rule ids. We keep this here (not
# in the scanner) so the mapping is unit-testable without subprocess
# mocks.
TRIVY_SEVERITY: Dict[str, CveSeverity] = {
    "CRITICAL": CveSeverity.CRITICAL,
    "HIGH": CveSeverity.HIGH,
    "MEDIUM": CveSeverity.MEDIUM,
    "LOW": CveSeverity.LOW,
    "UNKNOWN": CveSeverity.MEDIUM,  # conservative default
}

DEPENDABOT_SEVERITY: Dict[str, CveSeverity] = {
    "critical": CveSeverity.CRITICAL,
    "high": CveSeverity.HIGH,
    "moderate": CveSeverity.MEDIUM,
    "medium": CveSeverity.MEDIUM,
    "low": CveSeverity.LOW,
}


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class PackageRef:
    """The package reference a finding is anchored to.

    The Security Agent only sees this — not the file content. The
    `lockfile_path` and `lockfile_line` are the deterministic
    pointers the orchestrator can pass back to Coding when looping
    on `block`.
    """

    ecosystem: Ecosystem
    name: str
    installed_version: str
    fixed_versions: List[str] = field(default_factory=list)
    lockfile_path: str = ""
    lockfile_line: int = 0

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["ecosystem"] = self.ecosystem.value
        return out


@dataclass
class DependencyFinding:
    """One CVE finding from a scanner.

    The scanner keeps the raw CVE payload in memory only; the
    serialised form (via `to_dict()`) drops everything except the
    public fields the orchestrator needs to plan a fix.

    `cve_id` may be empty when the scanner reports an advisory id
    instead (e.g. `GHSA-xxxx`). The validator accepts either.
    """

    finding_id: str
    severity: CveSeverity
    package: PackageRef
    cve_id: str = ""
    advisory_id: str = ""
    title: str = ""
    fixed_version: str = ""
    remediation: str = ""
    rule_id: str = ""
    scanner: ScannerKind = ScannerKind.TRIVY
    # raw scanner payload (in-memory only)
    raw_payload: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["severity"] = self.severity.value
        out["package"] = self.package.to_dict()
        out["scanner"] = self.scanner.value
        # The raw scanner payload is dropped on serialisation.
        out.pop("raw_payload", None)
        # Surface a stable `fixed_version` for callers that prefer
        # the scalar (vs the list).
        if not out["fixed_version"] and self.package.fixed_versions:
            out["fixed_version"] = self.package.fixed_versions[0]
        return out


# ---------------------------------------------------------------------------
# Scan output (internal to the scanner)
# ---------------------------------------------------------------------------


@dataclass
class ScanDiff:
    """One lockfile's worth of scan hits.

    `commit_sha` and `path` are enough to anchor a finding back to
    a PR. The scanner does NOT carry the lockfile content — that
    is the Developer's scratch space; the dep scanner must not
    read it (FORA-76 hard isolation rule #1).
    """

    path: str
    commit_sha: str = ""
    findings: List[DependencyFinding] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["commit_sha"] = self.commit_sha
        out["findings"] = [f.to_dict() for f in self.findings]
        return out


@dataclass
class ScanResult:
    """The scanner's raw output (pre-verdict).

    `scanner_version` is the tool version (Trivy 0.50.x,
    Dependabot CLI 1.x); it is part of the audit evidence so
    the daily audit sample can pin the ruleset that produced
    each finding.
    """

    scanner: ScannerKind
    scanner_version: str
    diffs: List[ScanDiff] = field(default_factory=list)
    duration_ms: float = 0.0

    @property
    def findings(self) -> List[DependencyFinding]:
        out: List[DependencyFinding] = []
        for d in self.diffs:
            out.extend(d.findings)
        return out

    @property
    def finding_count(self) -> int:
        return len(self.findings)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scanner": self.scanner.value,
            "scanner_version": self.scanner_version,
            "duration_ms": self.duration_ms,
            "diff_count": len(self.diffs),
            "finding_count": self.finding_count,
            "diffs": [d.to_dict() for d in self.diffs],
        }


# ---------------------------------------------------------------------------
# SBOM envelope
# ---------------------------------------------------------------------------


@dataclass
class SbomRef:
    """Pointer to the CycloneDX SBOM attached to this run.

    The SBOM is emitted alongside the verdict (AC #4) so
    downstream compliance tooling can correlate a verdict with
    a precise package list. The SHA-256 hash pins the bytes —
    replaying the audit entry must reproduce the same hash.
    """

    artifact_id: str
    format: str = "CycloneDX"
    spec_version: str = "1.5"
    sha256: str = ""
    byte_size: int = 0
    component_count: int = 0
    storage_key: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Handoff contract — the v1.0.0 envelope
# ---------------------------------------------------------------------------


@dataclass
class HandoffInput:
    """The immutable handoff artefact the dep scanner consumes.

    The orchestrator stamps this from the Coding Agent's CodeDiff
    (sub-goal 3.2) plus the lockfile diff produced by the same
    PR. The dep scanner MUST treat this as write-once: it never
    re-fetches the developer's prompt or scratch space; it never
    re-reads the lockfile content beyond what `lockfile_path`
    provides.
    """

    handoff_id: str
    run_id: str
    tenant_id: str
    pr_url: str
    pr_diff_path: str
    lockfile_path: str
    pr_number: int
    repo: str
    base_sha: str
    head_sha: str
    author: str
    story_id: str = ""
    plan_id: str = ""
    # The Coding Agent's CodeDiff digest. The Security Agent does NOT
    # need the diff body — only enough to anchor its findings back
    # to the developer's output.
    code_diff_digest: str = ""
    # Lockfile content digest — same role for the lockfile diff.
    lockfile_diff_digest: str = ""
    # Optional override: when set, the scanner also runs the
    # Dependabot path (Snyk is gated on customer licence, v1.1).
    customer_id: str = ""
    enable_snyk: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class HandoffOutput:
    """The dep scanner's v1.0.0 handoff output.

    The verdict is derived from the findings list (verdict == PASS
    iff findings == []). The contract is:

      - `pass`     → orchestrator hands off to DevOps (6.1/6.2)
      - `block`    → orchestrator loops back to Coding (3.2)

    `evidence_audit_id` is the audit-log row that proves the
    scanner ran (run id, scanner version, finding count, decision,
    duration). Replaying the audit log proves the scanner never
    read the Developer's prompt or context (AC #4 — same
    invariant as FORA-74).

    `sbom` carries the CycloneDX 1.5 SBOM pointer; AC #4 requires
    an SBOM on every run.

    `pr_comment_posted` is True iff the scanner successfully wrote
    the PR comment to GitHub via the GitHub MCP. On `pass`, no
    comment is posted (the scanner returns without writing).
    """

    schema_version: str = SCHEMA_VERSION
    handoff_id: str = ""
    run_id: str = ""
    tenant_id: str = ""
    scanner_run_id: str = ""  # the dep scanner's own run id
    decision: Verdict = Verdict.PASS
    verdict: Verdict = Verdict.PASS  # alias, kept for spec parity
    findings: List[DependencyFinding] = field(default_factory=list)
    finding_count: int = 0
    severity_counts: Dict[str, int] = field(default_factory=dict)
    scanners_used: List[str] = field(default_factory=list)
    scanner_versions: Dict[str, str] = field(default_factory=dict)
    pr_comment_posted: bool = False
    evidence_audit_id: str = ""
    duration_ms: float = 0.0
    generated_at: str = ""
    # New for FORA-76
    sbom: Optional[SbomRef] = None
    mode: str = "per_pr"

    def __post_init__(self) -> None:
        # Mirror `decision` into `verdict` (the spec uses both names
        # in different sections; they must agree).
        if self.verdict != self.decision:
            if self.decision != Verdict.PASS:
                self.verdict = self.decision
            else:
                self.decision = self.verdict
        if not self.finding_count:
            self.finding_count = len(self.findings)
        if not self.severity_counts:
            counts: Dict[str, int] = {}
            for f in self.findings:
                counts[f.severity.value] = counts.get(f.severity.value, 0) + 1
            self.severity_counts = counts
        if not self.generated_at:
            self.generated_at = _utcnow_iso()

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["decision"] = self.decision.value
        out["verdict"] = self.verdict.value
        out["findings"] = [f.to_dict() for f in self.findings]
        out["sbom"] = self.sbom.to_dict() if self.sbom else None
        return out


def validate_handoff_output(out: HandoffOutput) -> List[str]:
    """Validate the handoff output. Returns a list of errors; empty = valid.

    Enforces:

      - AC #3 (schema v1.0.0 conformance)
      - AC #4 (SBOM attached to every run)
      - FORA-76 hard rule: HIGH or CRITICAL ⇒ BLOCK (no override)
      - Verdict invariant: PASS iff findings == []
      - Audit replay invariant: `evidence_audit_id` set + scanners_used non-empty
    """
    errors: List[str] = []
    if out.schema_version != SCHEMA_VERSION:
        errors.append(
            f"schema_version {out.schema_version!r} != {SCHEMA_VERSION!r}"
        )
    if not out.handoff_id:
        errors.append("handoff_id is required")
    if not out.run_id:
        errors.append("run_id is required")
    if not out.tenant_id:
        errors.append("tenant_id is required")
    if not out.scanner_run_id:
        errors.append("scanner_run_id is required")

    # Verdict invariant: PASS iff findings == [].
    has_findings = bool(out.findings)
    if out.decision == Verdict.PASS and has_findings:
        errors.append(
            "decision is 'pass' but findings is non-empty — must be 'block'"
        )
    if out.decision == Verdict.BLOCK and not has_findings:
        errors.append(
            "decision is 'block' but findings is empty — must be 'pass'"
        )

    if out.finding_count != len(out.findings):
        errors.append(
            f"finding_count ({out.finding_count}) does not match "
            f"len(findings) ({len(out.findings)})"
        )

    # FORA-76 hard rule: HIGH or CRITICAL ⇒ BLOCK always.
    if out.decision == Verdict.PASS:
        for f in out.findings:
            if f.severity in (CveSeverity.HIGH, CveSeverity.CRITICAL):
                errors.append(
                    f"finding {f.finding_id!r} is HIGH/CRITICAL but "
                    "decision is 'pass' — FORA-76 hard rule violated"
                )

    # Severity counts must match.
    actual: Dict[str, int] = {}
    for f in out.findings:
        actual[f.severity.value] = actual.get(f.severity.value, 0) + 1
    if out.severity_counts != actual:
        errors.append(
            f"severity_counts ({out.severity_counts}) does not match actual "
            f"({actual})"
        )

    # AC #4 — SBOM attached to every run.
    if out.sbom is None:
        errors.append("sbom is required (AC #4 — SBOM attached to every run)")
    else:
        if not out.sbom.artifact_id:
            errors.append("sbom.artifact_id is required")
        if not out.sbom.sha256:
            errors.append("sbom.sha256 is required")
        if not re.fullmatch(r"[a-f0-9]{64}", out.sbom.sha256):
            errors.append(
                f"sbom.sha256 must be 64-char lowercase hex — got "
                f"{out.sbom.sha256!r}"
            )
        if out.sbom.format != "CycloneDX":
            errors.append(
                f"sbom.format must be 'CycloneDX' — got {out.sbom.format!r}"
            )
        if out.sbom.component_count < 0:
            errors.append(
                f"sbom.component_count must be >= 0 — got "
                f"{out.sbom.component_count}"
            )
        # When there are findings, the SBOM MUST carry the components
        # those findings anchor to. A 0-component SBOM with findings is
        # a contract violation (the compliance tooling cannot correlate
        # the verdict to a package list).
        if out.findings and out.sbom.component_count <= 0:
            errors.append(
                f"sbom.component_count must be > 0 when findings are "
                f"present — got {out.sbom.component_count} for "
                f"{len(out.findings)} finding(s)"
            )

    # Audit replay: evidence row must exist; scanners_used must be non-empty.
    if not out.evidence_audit_id:
        errors.append("evidence_audit_id is required (audit replay)")
    if not out.scanners_used:
        errors.append("scanners_used must be non-empty (no scanner ran)")

    # Every finding has either cve_id or advisory_id (advisories are
    # accepted when the scanner reports GHSA-* style ids).
    for f in out.findings:
        if not f.cve_id and not f.advisory_id:
            errors.append(
                f"finding {f.finding_id!r} has neither cve_id nor advisory_id"
            )
        if not f.package or not f.package.name:
            errors.append(
                f"finding {f.finding_id!r} missing package.name"
            )

    return errors


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def derive_handoff_id(run_id: str, pr_number: int) -> str:
    """Stable handoff id derived from (run_id, pr_number).

    Same run_id + same PR → same handoff_id. Lets the orchestrator
    correlate a posted PR comment with its underlying scanner run
    without a separate mapping table.
    """
    digest = hashlib.sha1(f"{run_id}:{pr_number}".encode("utf-8")).hexdigest()[:10]
    return f"depscan-{digest}"


def derive_sbom_hash(sbom_bytes: bytes) -> str:
    """Stable SHA-256 hex of the SBOM bytes (AC #4 — replay invariant)."""
    return hashlib.sha256(sbom_bytes).hexdigest()