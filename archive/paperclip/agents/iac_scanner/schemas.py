"""
Schemas for the IaC Scanner (FORA-77, Sub-goal 5.3).

Defines the v1.0.0 handoff output schema for the Infrastructure-as-Code
AppSec gate:

  - Coding (3.2) hands a PlanOutput + diff digest to Security.
  - IaC scanner routes the diff by file type and runs checkov
    (Terraform/CloudFormation), kube-score + conftest (Kubernetes),
    and docker-bench (Dockerfile). On `pass`, DevOps (6.1 / 6.2)
    consumes the artefact; on `block`, the orchestrator loops back
    to Coding with the sanitised findings.
  - The scanner short-circuits to `pass` with the `iacNotPresent`
    evidence flag when no IaC file is in the PR diff (AC #3) — we
    don't pay the scanner cost for app-only PRs.

The envelope is a strict superset of the FORA-74 SecretScanner
contract and FORA-76 DepScanner contract — `decision`, `verdict`,
`findings`, `severity_counts`, `scanners_used`, `scanner_versions`,
`pr_comment_posted`, `evidence_audit_id`, `schema_version` all carry
the same field names and values. New FORA-77 fields:

  - `file_types_scanned` — set of file types the scanner routed to
                           ("terraform" | "cloudformation" |
                            "kubernetes" | "dockerfile")
  - `iac_files`          — list of IaC files in the diff
  - `iac_not_present`    — True when the diff has no IaC files
                           (the short-circuit evidence flag)
  - `mode`               — "per_pr" (default) or "policy_pack" (v1.1)

A change here is a breaking change to the Security Agent contract;
bump `SCHEMA_VERSION` and update the worked example in the ADR
together.

Hard rules (per FORA-77):

  - High or critical IaC misconfiguration is ALWAYS `block`. There
    is no override at the agent level; the only override is a human
    security reviewer on the customer side.
  - Output schema version is `1.0.0`.
  - Reads only the PR diff filtered to the IaC file extensions and
    the immutable handoff artefact. Never reads the Developer's
    prompt, scratch space, or conversation log.
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


class IacSeverity(str, Enum):
    """IaC misconfiguration severity classes (checkov / kube-score aligned).

    CRITICAL — must be fixed before merge. Forces `block`.
    HIGH     — must be fixed before merge. Forces `block`.
    MEDIUM   — should be fixed before merge. Forces `block`.
    LOW      — informational. Forces `block` (this is the most
               aggressive gate in the Security Agent; the
               orchestrator's reviewer can downgrade).
    UNKNOWN  — treat as MEDIUM. Forces `block`.

    The contract (per FORA-77 issue body and §3 of the Security
    Agent Design) is: CRITICAL or HIGH ⇒ BLOCK always. MEDIUM,
    LOW, UNKNOWN ⇒ BLOCK. There is no agent-level override.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class FileType(str, Enum):
    """The file type the scanner routed to.

    Drives the scanner backend (checkov / kube-score / conftest /
    docker-bench) and the rule-id namespace. Names are stable;
    adding a new file type is a minor version bump + ADR.
    """

    TERRAFORM = "terraform"
    CLOUDFORMATION = "cloudformation"
    KUBERNETES = "kubernetes"
    DOCKERFILE = "dockerfile"
    UNKNOWN = "unknown"


class ScannerKind(str, Enum):
    """Which scanner produced the finding.

    v0 supports checkov (Terraform + CloudFormation),
    kube-score + conftest (Kubernetes), and docker-bench (Dockerfile).
    Adding a new scanner is a minor version bump + ADR.
    """

    CHECKOV = "checkov"
    KUBE_SCORE = "kube-score"
    CONFTEST = "conftest"
    DOCKER_BENCH = "docker-bench"


# Severity mapping for known scanner rule ids. We keep this here (not
# in the scanner) so the mapping is unit-testable without subprocess
# mocks.
CHECKOV_SEVERITY: Dict[str, IacSeverity] = {
    "CRITICAL": IacSeverity.CRITICAL,
    "HIGH": IacSeverity.HIGH,
    "MEDIUM": IacSeverity.MEDIUM,
    "LOW": IacSeverity.LOW,
    "UNKNOWN": IacSeverity.UNKNOWN,
    # checkov also emits MODERATE on some rules
    "MODERATE": IacSeverity.MEDIUM,
}

KUBE_SCORE_SEVERITY: Dict[str, IacSeverity] = {
    "CRITICAL": IacSeverity.CRITICAL,
    "HIGH": IacSeverity.HIGH,
    "MEDIUM": IacSeverity.MEDIUM,
    "LOW": IacSeverity.LOW,
    # kube-score grades 0-10; we map >=7 → HIGH, >=4 → MEDIUM
}

CONFTEST_SEVERITY: Dict[str, IacSeverity] = {
    "CRITICAL": IacSeverity.CRITICAL,
    "HIGH": IacSeverity.HIGH,
    "MEDIUM": IacSeverity.MEDIUM,
    "LOW": IacSeverity.LOW,
    "WARNING": IacSeverity.MEDIUM,
}

DOCKER_BENCH_SEVERITY: Dict[str, IacSeverity] = {
    "CRITICAL": IacSeverity.CRITICAL,
    "HIGH": IacSeverity.HIGH,
    "MEDIUM": IacSeverity.MEDIUM,
    "LOW": IacSeverity.LOW,
    "INFO": IacSeverity.LOW,
}


# IaC file extensions — per FORA-77 hard rules the scanner only
# reads the PR diff filtered to these. The .json extension is
# CloudFormation-only: see `is_cloudformation_json`.
IAC_FILE_EXTENSIONS = (
    ".tf",
    ".tfvars",
    ".yaml",
    ".yml",
    ".json",  # CloudFormation only
    ".hcl",   # Terraform variant
    ".tmpl",  # CFN/GCP deployment-manager
)

# Filename markers that always indicate an IaC file regardless of
# extension (e.g. Dockerfile, Kustomize).
IAC_FILENAME_MARKERS = (
    "Dockerfile",
    "docker-compose",
    "kustomization",
    "Chart.yaml",  # Helm
    "values.yaml",  # Helm values (note: not the only .yaml)
)


def is_iac_filename(path: str) -> bool:
    """Return True if `path` is a candidate IaC file by name.

    The scanner only reads the diff filtered to IaC-shaped files —
    this is FORA-77 hard isolation rule #1.
    """
    if not path:
        return False
    name = path.rsplit("/", 1)[-1]
    if name in IAC_FILENAME_MARKERS:
        return True
    lower = name.lower()
    for marker in IAC_FILENAME_MARKERS:
        if lower.startswith(marker.lower() + ".") or lower == marker.lower():
            return True
    for ext in IAC_FILE_EXTENSIONS:
        if name.endswith(ext):
            return True
    return False


def classify_iac_file(path: str, body: str = "") -> FileType:
    """Classify an IaC file by extension and content markers.

    `body` is the file content; we look for first-line markers
    that disambiguate the .yaml / .yml case (Kubernetes manifest
    vs. GitHub Actions workflow). `.json` is CloudFormation when
    the file contains the canonical CFN marker
    (`AWSTemplateFormatVersion` or a top-level `Resources` map
    with at least one AWS resource type). Empty `body` is treated
    as "trust the extension" — the scanner will pick the default
    scanner for that extension and the smoke test mocks the
    content for every fixture.
    """
    if not path:
        return FileType.UNKNOWN
    name = path.rsplit("/", 1)[-1].lower()
    if name.startswith("dockerfile") or "dockerfile" in name:
        return FileType.DOCKERFILE
    if name.endswith(".tf") or name.endswith(".tfvars") or name.endswith(".hcl"):
        return FileType.TERRAFORM
    if name.endswith(".tmpl"):
        return FileType.CLOUDFORMATION
    if name.endswith(".json"):
        # CloudFormation only — disambiguate by content markers.
        # Without a positive CFN marker we return UNKNOWN so the
        # scanner does not waste a run on a Node.js `package.json`
        # or other non-CFN JSON files. The orchestrator still counts
        # the file as "in the diff" but `iac_files` excludes it.
        if body:
            if "AWSTemplateFormatVersion" in body or "Resources" in body:
                return FileType.CLOUDFORMATION
            return FileType.UNKNOWN
        return FileType.UNKNOWN  # default — no positive marker
    if name.endswith(".yaml") or name.endswith(".yml"):
        # Kubernetes vs. GitHub Actions vs. Helm values
        if not body:
            return FileType.KUBERNETES  # default for .yaml in IaC
        stripped = body.lstrip()
        first = stripped.splitlines()[0] if stripped else ""
        if first.startswith("apiVersion:") or first.startswith("kind:"):
            return FileType.KUBERNETES
        if first.startswith("on:") and "jobs:" in body:
            return FileType.UNKNOWN  # GitHub Actions; not IaC
        if "helm" in name.lower() or "values" in name.lower():
            return FileType.KUBERNETES
        return FileType.KUBERNETES  # default
    return FileType.UNKNOWN


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class FileRef:
    """The file a finding is anchored to.

    The Security Agent only sees this — not the file content. The
    `path` and `line` are the deterministic pointers the orchestrator
    can pass back to Coding when looping on `block`.

    `line` may be 0 when the scanner reports a file-level finding
    (e.g. "no encryption configured for any bucket in this file").
    """

    path: str
    line: int = 0
    file_type: FileType = FileType.UNKNOWN

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["file_type"] = self.file_type.value
        return out


@dataclass
class IacFinding:
    """One IaC misconfiguration finding from a scanner.

    The scanner keeps the raw scanner payload in memory only; the
    serialised form (via `to_dict()`) drops everything except the
    public fields the orchestrator needs to plan a fix.

    `rule_id` is the scanner's rule/check id (e.g. checkov's
    `CKV_AWS_19`, kube-score's `container-security-context-readonlyrootfilesystem`,
    docker-bench's `4.1`). The `remediation` is a category-anchored
    hint — never the developer's full file content.
    """

    finding_id: str
    severity: IacSeverity
    file: FileRef
    rule_id: str = ""
    title: str = ""
    misconfiguration: str = ""
    remediation: str = ""
    scanner: ScannerKind = ScannerKind.CHECKOV
    # raw scanner payload (in-memory only)
    raw_payload: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["severity"] = self.severity.value
        out["file"] = self.file.to_dict()
        out["scanner"] = self.scanner.value
        # The raw scanner payload is dropped on serialisation.
        out.pop("raw_payload", None)
        return out


# ---------------------------------------------------------------------------
# Scan output (internal to the scanner)
# ---------------------------------------------------------------------------


@dataclass
class ScanFile:
    """One IaC file's worth of scan hits.

    `path` and `commit_sha` are enough to anchor a finding back to
    a PR. The scanner does NOT carry the file content — that is
    the Developer's scratch space; the IaC scanner must not read
    it beyond the line pointer (FORA-77 hard isolation rule #1).
    """

    path: str
    file_type: FileType = FileType.UNKNOWN
    commit_sha: str = ""
    findings: List[IacFinding] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["file_type"] = self.file_type.value
        out["findings"] = [f.to_dict() for f in self.findings]
        out["commit_sha"] = self.commit_sha
        return out


@dataclass
class ScanResult:
    """The scanner's raw output (pre-verdict).

    `scanner_version` is the tool version (checkov 3.x,
    kube-score 1.16.x, conftest 0.55.x, docker-bench 0.5.x);
    it is part of the audit evidence so the daily audit sample
    can pin the ruleset that produced each finding.
    """

    scanner: ScannerKind
    scanner_version: str
    file_type: FileType = FileType.UNKNOWN
    files: List[ScanFile] = field(default_factory=list)
    duration_ms: float = 0.0

    @property
    def findings(self) -> List[IacFinding]:
        out: List[IacFinding] = []
        for f in self.files:
            out.extend(f.findings)
        return out

    @property
    def finding_count(self) -> int:
        return len(self.findings)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scanner": self.scanner.value,
            "scanner_version": self.scanner_version,
            "file_type": self.file_type.value,
            "duration_ms": self.duration_ms,
            "file_count": len(self.files),
            "finding_count": self.finding_count,
            "files": [f.to_dict() for f in self.files],
        }


# ---------------------------------------------------------------------------
# Handoff contract — the v1.0.0 envelope
# ---------------------------------------------------------------------------


@dataclass
class HandoffInput:
    """The immutable handoff artefact the IaC scanner consumes.

    The orchestrator stamps this from the Coding Agent's CodeDiff
    (sub-goal 3.2) plus the PR diff. The IaC scanner MUST treat
    this as write-once: it never re-fetches the developer's prompt
    or scratch space; it never re-reads the diff beyond what
    `pr_diff_path` provides (filtered to IaC file extensions).
    """

    handoff_id: str
    run_id: str
    tenant_id: str
    pr_url: str
    pr_diff_path: str
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

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class HandoffOutput:
    """The IaC scanner's v1.0.0 handoff output.

    The verdict is derived from the findings list (verdict == PASS
    iff findings == []). The contract is:

      - `pass`     → orchestrator hands off to DevOps (6.1/6.2)
      - `block`    → orchestrator loops back to Coding (3.2)

    `evidence_audit_id` is the audit-log row that proves the
    scanner ran (run id, scanner version, finding count, decision,
    duration). Replaying the audit log proves the scanner never
    read the Developer's prompt or context (AC #5).

    `iac_not_present` is the short-circuit evidence flag (AC #3).
    When True, the scanner did NOT run checkov / kube-score /
    conftest / docker-bench — it short-circuited to `pass` because
    the diff had no IaC-shaped files. The `iac_files` list is
    empty; `file_types_scanned` is empty; `scanners_used` is
    empty (no scanner ran).

    `pr_comment_posted` is True iff the scanner successfully wrote
    the PR comment to GitHub via the GitHub MCP. On `pass`, no
    comment is posted (the scanner returns without writing) unless
    the orchestrator wants the one-liner.
    """

    schema_version: str = SCHEMA_VERSION
    handoff_id: str = ""
    run_id: str = ""
    tenant_id: str = ""
    scanner_run_id: str = ""  # the IaC scanner's own run id
    decision: Verdict = Verdict.PASS
    verdict: Verdict = Verdict.PASS  # alias, kept for spec parity
    findings: List[IacFinding] = field(default_factory=list)
    finding_count: int = 0
    severity_counts: Dict[str, int] = field(default_factory=dict)
    scanners_used: List[str] = field(default_factory=list)
    scanner_versions: Dict[str, str] = field(default_factory=dict)
    pr_comment_posted: bool = False
    evidence_audit_id: str = ""
    duration_ms: float = 0.0
    generated_at: str = ""
    # New for FORA-77
    iac_files: List[str] = field(default_factory=list)
    file_types_scanned: List[str] = field(default_factory=list)
    iac_not_present: bool = False
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
        return out


def validate_handoff_output(out: HandoffOutput) -> List[str]:
    """Validate the handoff output. Returns a list of errors; empty = valid.

    Enforces:

      - AC #3 (schema v1.0.0 conformance)
      - AC #4 (verdict invariant: PASS iff findings == [])
      - FORA-77 hard rule: HIGH or CRITICAL ⇒ BLOCK (no override)
      - AC #3 short-circuit invariant: iac_not_present=True implies
        decision=PASS, findings=[], scanners_used=[]
      - Audit replay invariant: `evidence_audit_id` set; on
        iac_not_present=False, `scanners_used` must be non-empty
        (at least one scanner ran)
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

    # AC #3 short-circuit invariant.
    if out.iac_not_present:
        if out.decision != Verdict.PASS:
            errors.append(
                "iac_not_present=True but decision is not 'pass' — "
                "the short-circuit must produce a pass"
            )
        if out.findings:
            errors.append(
                "iac_not_present=True but findings is non-empty — "
                "the short-circuit must produce zero findings"
            )
        if out.scanners_used:
            errors.append(
                f"iac_not_present=True but scanners_used is non-empty — "
                f"got {out.scanners_used!r}; the scanner must NOT have "
                "run when no IaC files are present (AC #3)"
            )
        if out.iac_files:
            errors.append(
                f"iac_not_present=True but iac_files is non-empty — "
                f"got {out.iac_files!r}"
            )

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

    # FORA-77 hard rule: HIGH or CRITICAL ⇒ BLOCK always.
    if out.decision == Verdict.PASS:
        for f in out.findings:
            if f.severity in (IacSeverity.HIGH, IacSeverity.CRITICAL):
                errors.append(
                    f"finding {f.finding_id!r} is HIGH/CRITICAL but "
                    "decision is 'pass' — FORA-77 hard rule violated"
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

    # Audit replay: evidence row must exist; scanners_used must be
    # non-empty whenever a scan actually ran.
    if not out.evidence_audit_id:
        errors.append("evidence_audit_id is required (audit replay)")
    if not out.iac_not_present and not out.scanners_used:
        errors.append(
            "scanners_used must be non-empty when iac_not_present=False "
            "(no scanner ran)"
        )

    # Every finding has a file ref with a path.
    for f in out.findings:
        if not f.file or not f.file.path:
            errors.append(
                f"finding {f.finding_id!r} missing file.path"
            )
        if not f.rule_id:
            errors.append(
                f"finding {f.finding_id!r} missing rule_id"
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
    return f"iacscan-{digest}"


def derive_artifact_id(handoff_id: str) -> str:
    """Stable artifact id derived from the handoff_id.

    Used as the `artifact_id` of the v1.0.0 handoff envelope so
    the orchestrator can refer to the persisted artefact by name
    without a separate mapping table.
    """
    digest = hashlib.sha1(handoff_id.encode("utf-8")).hexdigest()[:12]
    return f"iac-handoff-{digest}"


# Severity badge — used by the PR comment formatter.
SEVERITY_BADGES = {
    IacSeverity.CRITICAL: "🟥 CRITICAL",
    IacSeverity.HIGH: "🟧 HIGH",
    IacSeverity.MEDIUM: "🟨 MEDIUM",
    IacSeverity.LOW: "🟦 LOW",
    IacSeverity.UNKNOWN: "⬜ UNKNOWN",
}


# Scanner display names — used by the PR comment formatter.
SCANNER_DISPLAY = {
    ScannerKind.CHECKOV: "checkov",
    ScannerKind.KUBE_SCORE: "kube-score",
    ScannerKind.CONFTEST: "conftest",
    ScannerKind.DOCKER_BENCH: "docker-bench",
}


# Default remediation hint per file type. The IaC scanner writes
# only category-anchored guidance — never the developer's full
# file content.
DEFAULT_REMEDIATION: Dict[FileType, str] = {
    FileType.TERRAFORM: (
        "Update the Terraform resource to set the secure attribute "
        "(e.g. `acl = \"private\"`, `server_side_encryption_configuration`, "
        "`block_public_acls = true`) and re-run the scanner."
    ),
    FileType.CLOUDFORMATION: (
        "Update the CloudFormation resource to enable encryption / "
        "block public access and re-run the scanner."
    ),
    FileType.KUBERNETES: (
        "Add the missing `securityContext` field to the Pod / "
        "container spec (e.g. `readOnlyRootFilesystem: true`, "
        "`runAsNonRoot: true`, `allowPrivilegeEscalation: false`) "
        "and re-run the scanner."
    ),
    FileType.DOCKERFILE: (
        "Update the Dockerfile to harden the build (e.g. drop "
        "USER root, add HEALTHCHECK, pin FROM digest) and re-run "
        "the scanner."
    ),
    FileType.UNKNOWN: (
        "Update the IaC file to fix the misconfiguration per the "
        "scanner's remediation hint and re-run the scanner."
    ),
}
