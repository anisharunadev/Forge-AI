"""
PR comment formatter for the IaC Scanner (FORA-77).

The PR comment is the human-readable surface that lands on the
PR thread. The contract is:

  - PASS (no IaC files):     no comment is posted by default
                              (the scanner returns without writing).
                              The orchestrator may post the
                              `comment_for_pass()` one-liner if it
                              wants to surface the iac_not_present
                              evidence flag.
  - PASS (scanned, 0 findings): same — no comment by default.
  - BLOCK:    a sanitised comment is posted with one section per
              finding. The comment MUST NOT include developer-only
              context (the file content, the developer's plan); it
              carries only what a human reviewer needs to triage
              (file path, line, rule id, misconfiguration,
              remediation).

The comment is built by `build_pr_comment()` (the renderer) and
post-verified by `assert_comment_has_no_secret()` (which checks
for secret-shaped strings AND for known file-body leak patterns).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from .schemas import (
    DEFAULT_REMEDIATION,
    FileType,
    HandoffOutput,
    IacFinding,
    IacSeverity,
    SCANNER_DISPLAY,
    SEVERITY_BADGES,
)


# Patterns we use to detect a leak in the rendered comment.
# 1. Secret-shaped patterns (carry-over from FORA-74 / FORA-76).
# 2. IaC-file-body markers: anything that looks like a 200+ byte
#    contiguous Terraform / CloudFormation / Kubernetes snippet
#    would echo the Developer's scratch space.
LEAK_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bASIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bxox[boprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\b(sk|rk)_live_[A-Za-z0-9]{20,}\b"),
    # IaC-body leak guards — block-style declaration followed
    # by ~200 bytes is suspicious. We use a conservative length
    # to avoid false positives on normal prose.
    re.compile(r"\{[a-z_]+\s*=\s*[\"'][^\"']{80,}[\"']\s*,\s*[a-z_]+\s*=\s*[\"']"),
    re.compile(r"resource\s+\"[^\"]{20,}\"\s+\"[^\"]{20,}\"\s*\{"),
    re.compile(r"kind:\s*[A-Z][a-zA-Z]+\s*\n\s*metadata:\s*\n\s*name:"),
]


@dataclass
class PRComment:
    """The rendered PR comment.

    `body` is the Markdown text. `summary` is a one-line summary
    the orchestrator may pin to the PR title. Both must pass
    `assert_comment_has_no_secret()`.
    """

    body: str
    summary: str
    finding_count: int

    def to_dict(self) -> dict:
        return {"body": self.body, "summary": self.summary, "finding_count": self.finding_count}


def _finding_section(f: IacFinding) -> str:
    badge = SEVERITY_BADGES.get(f.severity, f.severity.value)
    scanner = SCANNER_DISPLAY.get(f.scanner, f.scanner.value)
    remediation = f.remediation or DEFAULT_REMEDIATION.get(
        f.file.file_type,
        DEFAULT_REMEDIATION[FileType.UNKNOWN],
    )
    location = f"{f.file.path}:{f.file.line}" if f.file.line else f.file.path
    file_type = f.file.file_type.value
    lines = [
        f"### {badge} — `{f.rule_id}`",
        "",
        f"- **Finding ID:** `{f.finding_id}`",
        f"- **Scanner:** `{scanner}`",
        f"- **Location:** `{location}` (`{file_type}`)",
    ]
    if f.title:
        lines.append(f"- **Title:** {f.title}")
    if f.misconfiguration:
        lines.append(f"- **Misconfiguration:** {f.misconfiguration}")
    lines.append("")
    lines.append(f"**Remediation:** {remediation}")
    lines.append("")
    return "\n".join(lines)


def comment_for_block(out: HandoffOutput) -> PRComment:
    """Render the BLOCK PR comment for a handoff output.

    The body is built from the *serialised* findings. The
    renderer itself does not touch the file body.
    """
    if out.decision.value != "block":
        raise ValueError(
            f"comment_for_block called with decision={out.decision.value!r}; "
            "expected 'block'"
        )
    if not out.findings:
        raise ValueError("comment_for_block called with zero findings")

    counts = out.severity_counts or {}
    parts: List[str] = []
    parts.append(
        f"## 🔒 IaC scan: **BLOCK** — {out.finding_count} finding(s)"
    )
    parts.append("")
    parts.append(
        "Merge is blocked. The scanner found Infrastructure-as-Code "
        "misconfigurations in the PR's added or updated files. "
        "Fix each finding per the remediation hint and re-run "
        "the scanner."
    )
    parts.append("")
    parts.append(
        "**Severity breakdown:** "
        + ", ".join(
            f"{SEVERITY_BADGES[IacSeverity(s)]}: {n}"
            for s, n in sorted(counts.items(), key=lambda kv: -kv[1])
        )
    )
    parts.append("")

    # Group findings by severity (CRITICAL first).
    by_sev: dict = {}
    for f in out.findings:
        by_sev.setdefault(f.severity, []).append(f)
    for sev in (
        IacSeverity.CRITICAL,
        IacSeverity.HIGH,
        IacSeverity.MEDIUM,
        IacSeverity.LOW,
        IacSeverity.UNKNOWN,
    ):
        for f in by_sev.get(sev, []):
            parts.append(_finding_section(f))

    parts.append("---")
    parts.append(
        "*Posted by the FORA IaC Scanner (FORA-77, sub-goal 5.3). "
        "Audit row: `" + (out.evidence_audit_id or "pending") + "`. "
        "Schema: `v1.0.0`.*"
    )

    summary = f"🔒 iac-scan: BLOCK ({out.finding_count} finding(s))"
    return PRComment(body="\n".join(parts), summary=summary, finding_count=out.finding_count)


def comment_for_pass(out: HandoffOutput) -> PRComment:
    """Render the one-line PASS comment (optional).

    Two PASS shapes:
      - iac_not_present=True: short-circuit evidence flag is surfaced
        so the reviewer can see WHY the scanner returned pass
        (no IaC files in the diff).
      - iac_not_present=False: scanners ran, found nothing.
    """
    if out.decision.value != "pass":
        raise ValueError(
            f"comment_for_pass called with decision={out.decision.value!r}; "
            "expected 'pass'"
        )
    if out.iac_not_present:
        body = (
            "## 🔒 IaC scan: **PASS** (no IaC files)\n\n"
            "No Infrastructure-as-Code files in this PR's diff. "
            "Scanner short-circuited without invoking checkov / "
            "kube-score / conftest / docker-bench. "
            f"`iac_files`: `{out.iac_files!r}`."
        )
        return PRComment(body=body, summary="🔒 iac-scan: PASS (no IaC)", finding_count=0)
    body = (
        "## 🔒 IaC scan: **PASS**\n\n"
        "No HIGH or CRITICAL Infrastructure-as-Code misconfigurations "
        "found in this PR. Merge may proceed (pending other gates)."
    )
    return PRComment(body=body, summary="🔒 iac-scan: PASS", finding_count=0)


def build_pr_comment(out: HandoffOutput) -> Optional[PRComment]:
    """Dispatch: BLOCK → block comment; PASS → no comment by default.

    The orchestrator can call `comment_for_pass(out)` directly if
    it wants the one-liner (e.g. to surface the iac_not_present
    evidence flag on app-only PRs).
    """
    if out.decision.value == "block":
        return comment_for_block(out)
    if out.decision.value == "pass":
        return None  # pass = no comment by default
    raise ValueError(f"unknown decision: {out.decision!r}")


# ---------------------------------------------------------------------------
# Post-condition: no secret value + no IaC body in the rendered comment
# ---------------------------------------------------------------------------


def assert_comment_has_no_secret(comment: PRComment) -> None:
    """Raise `ValueError` if the rendered comment contains a secret-shaped
    string or an IaC-body echo.

    Used by the smoke test (FORA-77 AC #5 analog) and by the runtime
    before posting the comment to GitHub. The check is deliberately
    conservative: every `LEAK_PATTERNS` regex must NOT match the
    body or the summary.
    """
    haystack = comment.body + "\n" + comment.summary
    for pat in LEAK_PATTERNS:
        m = pat.search(haystack)
        if m:
            raise ValueError(
                f"PR comment leaks a secret/IaC-shaped string: "
                f"pattern {pat.pattern!r} matched {m.group(0)[:64]!r}"
            )
