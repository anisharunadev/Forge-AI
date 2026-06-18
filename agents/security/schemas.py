"""
Schemas for the Security Agent (FORA-74, Sub-goal 5.1).

Defines the v1.0.0 handoff output schema that:

  - Coding (3.2) hands a PlanOutput + CodeDiff digest to Security.
  - Security runs gitleaks + trufflehog and emits a HandoffOutput.
  - On `pass`, DevOps (6.1 / 6.2) consumes the artefact.
  - On `block`, the orchestrator loops back to Coding with the
    sanitised findings (no secret values).

A change here is a breaking change to the Security contract;
bump `SCHEMA_VERSION` and update the worked example in the ADR
together.
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

    PASS            — no findings; merge may proceed.
    BLOCK           — at least one finding; merge blocked.

    The verdict is a *machine-readable* signal; the PR comment is
    the human-readable form. They MUST agree: verdict == PASS iff
    findings == [].
    """

    PASS = "pass"
    BLOCK = "block"


# Alias for readability inside the handoff output ("decision" reads more
# naturally to a human reviewer than "verdict").
Decision = Verdict


class SecretSeverity(str, Enum):
    """How urgently a finding must be addressed.

    CRITICAL — must be fixed before merge. Forces `block`.
    HIGH     — must be fixed before merge. Forces `block`.
    MEDIUM   — should be fixed before merge. Forces `block`.
    LOW      — informational. Forces `block` if any MEDIUM+ also present,
               otherwise PASS (the historical full-history scanner emits
               LOW for already-rotated credentials; we surface, not block).

    The contract (per FORA-74 issue body and §3 of the Security
    Agent Design) is: CRITICAL or HIGH ⇒ BLOCK always. MEDIUM ⇒
    BLOCK. LOW ⇒ surface in PR comment, BLOCK only when at least
    one MEDIUM+ is also present in the same scan.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SecretCategory(str, Enum):
    """The category of secret the scanner matched.

    The category drives the routing + remediation hint in the PR
    comment. Names are stable; adding a new category is a minor
    version bump (new ADR + appendix entry), not a major bump.
    """

    AWS_ACCESS_KEY = "aws_access_key"
    AWS_SESSION_TOKEN = "aws_session_token"
    GITHUB_PAT = "github_pat"
    ANTHROPIC_API_KEY = "anthropic_api_key"
    OPENAI_API_KEY = "openai_api_key"
    SLACK_TOKEN = "slack_token"
    STRIPE_LIVE_KEY = "stripe_live_key"
    VAULT_SERVICE_TOKEN = "vault_service_token"
    PRIVATE_KEY_PEM = "private_key_pem"
    GENERIC_API_KEY = "generic_api_key"
    GENERIC_PASSWORD = "generic_password"
    CONNECTION_STRING = "connection_string"
    DOTENV_VALUE = "dotenv_value"


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


# A match is the raw secret-shaped string the scanner caught. We never
# persist or echo this back. We compute the fingerprint + the length
# + the first/last two characters (only when the secret is long enough
# to make that safe) and discard the rest.
_MIN_REDACT_LEN = 16  # below this we don't surface even first/last


def redact_secret(secret: str) -> str:
    """Produce a *non-reversible* representation of a secret for audit
    + PR-comment display.

    Rules (per FORA-74 AC #5 — "the PR comment does not include the
    secret value"):

      - secrets shorter than `_MIN_REDACT_LEN` characters collapse
        to a fixed-length token: `***` (so the *length class* is
        also hidden)
      - longer secrets surface a length, a 6-char hex prefix
        fingerprint (truncated SHA-256), and at most the first 2
        and last 2 characters
      - the raw `secret` argument is NEVER returned

    The fingerprint is short enough that two distinct secrets have
    a non-negligible collision risk (~1 in 2^24). That is acceptable
    here because the fingerprint is only used to deduplicate
    findings within one scan, not to identify a credential across
    scans.
    """
    if not secret:
        return "[empty]"
    if len(secret) < _MIN_REDACT_LEN:
        return "[redacted:len<%d]" % _MIN_REDACT_LEN

    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:6]
    head = secret[:2]
    tail = secret[-2:]
    return f"[redacted:fpr={digest}:len={len(secret)}:head={head}:tail={tail}]"


@dataclass
class SecretFinding:
    """One sanitised finding from a scanner.

    The `secret_value` field is the raw match. Callers MUST NOT
    serialize it (use `to_dict()` which drops the value and replaces
    it with the redacted representation). The dataclass keeps the
    raw value in memory only for the duration of the scan; it is
    never written to the audit log, the PR comment, or the
    handoff artefact.
    """

    finding_id: str
    severity: SecretSeverity
    category: SecretCategory
    rule_id: str  # the scanner rule, e.g. "fora-aws-access-key"
    scanner: str  # "gitleaks" | "trufflehog"
    file: str
    line: int
    # raw match (in-memory only)
    secret_value: str = ""
    remediation: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["severity"] = self.severity.value
        out["category"] = self.category.value
        # Replace the raw match with the redacted representation so
        # serialised findings never carry the secret value.
        out.pop("secret_value", None)
        out["redacted"] = redact_secret(self.secret_value)
        return out


# ---------------------------------------------------------------------------
# Scan output (internal to the scanner)
# ---------------------------------------------------------------------------


@dataclass
class ScanDiff:
    """One file's worth of scan hits.

    `commit_sha` and `path` are enough to anchor a finding back to
    a PR diff. The scanner does NOT carry the file content — that
    is the Developer's scratch space; the Security Agent must not
    read it (FORA-74 hard isolation rule #1).
    """

    path: str
    commit_sha: str = ""
    findings: List[SecretFinding] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["findings"] = [f.to_dict() for f in self.findings]
        return out


@dataclass
class ScanResult:
    """The scanner's raw output (pre-verdict).

    `scanner_version` is the tool version (gitleaks 8.x, trufflehog
    3.x); it is part of the audit evidence so the daily audit sample
    can pin the ruleset that produced each finding.
    """

    scanner: str  # "gitleaks" | "trufflehog"
    scanner_version: str
    diffs: List[ScanDiff] = field(default_factory=list)
    duration_ms: float = 0.0

    @property
    def findings(self) -> List[SecretFinding]:
        out: List[SecretFinding] = []
        for d in self.diffs:
            out.extend(d.findings)
        return out

    @property
    def finding_count(self) -> int:
        return len(self.findings)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scanner": self.scanner,
            "scanner_version": self.scanner_version,
            "duration_ms": self.duration_ms,
            "diff_count": len(self.diffs),
            "finding_count": self.finding_count,
            "diffs": [d.to_dict() for d in self.diffs],
        }


# ---------------------------------------------------------------------------
# Handoff contract — the v1.0.0 envelope
# ---------------------------------------------------------------------------


@dataclass
class HandoffInput:
    """The immutable handoff artefact the Security Agent consumes.

    The orchestrator stamps this from the Coding Agent's CodeDiff
    (sub-goal 3.2). The Security Agent MUST treat this as
    write-once: it never re-fetches the developer's prompt or
    scratch space; it never re-reads the file content beyond what
    `pr_diff_path` provides.

    `pr_diff_path` is a local path to a *redacted* diff (the
    file is committed by the orchestrator before the Security
    Agent process starts). The scanner runs `gitleaks detect
    --source <pr_diff_path>` against it; the scanner never reads
    the source repository tree.
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
    """The Security Agent's v1.0.0 handoff output.

    The verdict is derived from the findings list (verdict == PASS
    iff findings == []). The contract is:

      - `pass`     → orchestrator hands off to DevOps (6.1/6.2)
      - `block`    → orchestrator loops back to Coding (3.2)

    `evidence_audit_id` is the audit-log row that proves the
    scanner ran (run id, scanner version, finding count, decision,
    duration). Replaying the audit log proves the scanner never
    read the Developer's prompt or context (AC #4).

    `pr_comment_posted` is True iff the scanner successfully wrote
    the PR comment to GitHub via the GitHub MCP. On `pass`, no
    comment is posted (the scanner returns without writing).
    """

    schema_version: str = SCHEMA_VERSION
    handoff_id: str = ""
    run_id: str = ""
    tenant_id: str = ""
    scanner_run_id: str = ""  # the Security Agent's own run id
    decision: Verdict = Verdict.PASS
    verdict: Verdict = Verdict.PASS  # alias, kept for spec parity
    findings: List[SecretFinding] = field(default_factory=list)
    finding_count: int = 0
    severity_counts: Dict[str, int] = field(default_factory=dict)
    scanners_used: List[str] = field(default_factory=list)
    scanner_versions: Dict[str, str] = field(default_factory=dict)
    pr_comment_posted: bool = False
    evidence_audit_id: str = ""
    duration_ms: float = 0.0
    generated_at: str = ""

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

    AC #3 (schema v1.0.0 conformance) and AC #5 (no secret value in
    the serialised form) are enforced here. The orchestrator runs
    this before accepting the handoff; the smoke test runs it
    before declaring success.
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

    # AC #5: no secret value in the serialised form.
    serialised = out.to_dict()
    for f in serialised["findings"]:
        if "secret_value" in f and f["secret_value"]:
            errors.append(
                f"finding {f.get('finding_id')!r} serialises with non-empty "
                "secret_value — redaction leak"
            )
        if "redacted" not in f or not f["redacted"].startswith("[redacted:"):
            errors.append(
                f"finding {f.get('finding_id')!r} missing or malformed "
                "redacted field"
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
    return f"sec-{digest}"


# Categories that map cleanly from FORA gitleaks rule ids. We keep
# this here (not in the scanner) so the mapping is unit-testable
# without subprocess mocks.
GITLEAKS_RULE_TO_CATEGORY: Dict[str, SecretCategory] = {
    "fora-aws-access-key": SecretCategory.AWS_ACCESS_KEY,
    "fora-github-pat": SecretCategory.GITHUB_PAT,
    "fora-anthropic-api-key": SecretCategory.ANTHROPIC_API_KEY,
    "fora-openai-api-key": SecretCategory.OPENAI_API_KEY,
    "fora-slack-token": SecretCategory.SLACK_TOKEN,
    "fora-stripe-live-key": SecretCategory.STRIPE_LIVE_KEY,
    "fora-vault-service-token": SecretCategory.VAULT_SERVICE_TOKEN,
    "fora-private-key-header": SecretCategory.PRIVATE_KEY_PEM,
}

# AWS session tokens (ASIA...) are a separate category because they
# have a shorter TTL and require different remediation.
_ASIA_RE = re.compile(r"\bASIA[0-9A-Z]{16}\b")


def categorise(rule_id: str, match: str) -> SecretCategory:
    """Map a gitleaks rule id (and the raw match) to a SecretCategory."""
    if rule_id in GITLEAKS_RULE_TO_CATEGORY:
        cat = GITLEAKS_RULE_TO_CATEGORY[rule_id]
        if cat == SecretCategory.AWS_ACCESS_KEY and _ASIA_RE.search(match):
            return SecretCategory.AWS_SESSION_TOKEN
        return cat
    # Unknown rule → generic. Avoid leaking the rule id into the
    # category enum (categories are a stable surface).
    return SecretCategory.GENERIC_API_KEY


# Severity is rule-id-keyed when the FORA ruleset declares it
# explicitly, and otherwise falls back to a conservative default.
GITLEAKS_RULE_TO_SEVERITY: Dict[str, SecretSeverity] = {
    "fora-aws-access-key": SecretSeverity.CRITICAL,
    "fora-github-pat": SecretSeverity.CRITICAL,
    "fora-anthropic-api-key": SecretSeverity.CRITICAL,
    "fora-openai-api-key": SecretSeverity.CRITICAL,
    "fora-slack-token": SecretSeverity.HIGH,
    "fora-stripe-live-key": SecretSeverity.CRITICAL,
    "fora-vault-service-token": SecretSeverity.HIGH,
    "fora-private-key-header": SecretSeverity.CRITICAL,
}

_DEFAULT_SEVERITY = SecretSeverity.HIGH


def severity_for(rule_id: str) -> SecretSeverity:
    return GITLEAKS_RULE_TO_SEVERITY.get(rule_id, _DEFAULT_SEVERITY)
