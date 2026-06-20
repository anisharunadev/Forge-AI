"""
PR comment formatter for the Dependency Scanner (FORA-76).

The PR comment is the human-readable surface that lands on the
PR thread. The contract is:

  - PASS:    no comment is posted (the scanner returns without
             writing). Optionally the orchestrator may post a
             one-line "🔒 dep scan: pass" — we provide
             `comment_for_pass()` for that path.
  - BLOCK:   a sanitised comment is posted with one section per
             finding. The comment MUST NOT include developer-only
             context (the file content, the lockfile content, the
             developer's plan); it carries only what a human
             reviewer needs to triage.

The comment is built by `build_pr_comment()` (the renderer) and
post-verified by `assert_comment_has_no_secret()` (which we
re-use for dep-scanner: it checks for secret-shaped strings
AND for known lockfile-body leak patterns).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from .schemas import (
    CveSeverity,
    DependencyFinding,
    Ecosystem,
    HandoffOutput,
    PackageRef,
)


# Display names for ecosystems — keep the package-format out of
# the user-visible string.
ECOSYSTEM_LABELS = {
    Ecosystem.PYPI: "PyPI",
    Ecosystem.NPM: "npm",
    Ecosystem.MAVEN: "Maven",
    Ecosystem.GO: "Go",
    Ecosystem.NUGET: "NuGet",
    Ecosystem.RUBYGEMS: "RubyGems",
    Ecosystem.CARGO: "Cargo",
    Ecosystem.COMPOSER: "Composer",
    Ecosystem.GENERIC: "generic",
}

SEVERITY_BADGES = {
    CveSeverity.CRITICAL: "🟥 CRITICAL",
    CveSeverity.HIGH: "🟧 HIGH",
    CveSeverity.MEDIUM: "🟨 MEDIUM",
    CveSeverity.LOW: "🟦 LOW",
}


# Default remediation hint per ecosystem. The dep scanner writes
# only category-anchored guidance — never "rotate this specific
# key" (that would echo the secret). The remediation string MUST
# NOT include the lockfile content.
DEFAULT_REMEDIATION: dict = {
    Ecosystem.PYPI: (
        "Upgrade with `pip install <pkg>==<fixed_version>` and re-run "
        "the scanner. Pin in `requirements.txt` / `pyproject.toml`."
    ),
    Ecosystem.NPM: (
        "Upgrade with `npm install <pkg>@<fixed_version>` and re-run "
        "the scanner. Pin in `package.json`."
    ),
    Ecosystem.MAVEN: (
        "Update the `<version>` in `pom.xml` and re-run the scanner."
    ),
    Ecosystem.GO: (
        "Run `go get <pkg>@<fixed_version>` and re-run the scanner."
    ),
    Ecosystem.NUGET: (
        "Run `dotnet add package <pkg> --version <fixed_version>` and "
        "re-run the scanner."
    ),
    Ecosystem.RUBYGEMS: (
        "Update the Gemfile.lock entry for `<pkg>` to `<fixed_version>` "
        "and re-run the scanner."
    ),
    Ecosystem.CARGO: (
        "Update `Cargo.toml` and run `cargo update -p <pkg>` and "
        "re-run the scanner."
    ),
    Ecosystem.COMPOSER: (
        "Run `composer require <pkg>:<fixed_version>` and re-run "
        "the scanner."
    ),
    Ecosystem.GENERIC: (
        "Upgrade the package to a fixed version and re-run the scanner."
    ),
}


# Patterns we use to detect a leak in the rendered comment.
# 1. Secret-shaped patterns (carry-over from FORA-74): the
#    developer may have added a dep that pulls in a credential
#    bundle; we don't want to echo those.
# 2. Lockfile-body markers: anything that looks like a 200+ byte
#    contiguous lockfile snippet would echo the Developer's
#    scratch space.
LEAK_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bASIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bxox[boprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\b(sk|rk)_live_[A-Za-z0-9]{20,}\b"),
    # Lockfile-body leak guard — block-style declaration followed
    # by ~200 bytes is suspicious. We use a conservative length
    # to avoid false positives on normal prose.
    re.compile(r"\{[a-z_]+\s*=\s*[\"'][^\"']{80,}[\"']\s*,\s*[a-z_]+\s*=\s*[\"']"),
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


def _finding_section(f: DependencyFinding) -> str:
    label = ECOSYSTEM_LABELS.get(f.package.ecosystem, f.package.ecosystem.value)
    badge = SEVERITY_BADGES.get(f.severity, f.severity.value)
    remediation = f.remediation or DEFAULT_REMEDIATION.get(
        f.package.ecosystem,
        DEFAULT_REMEDIATION[Ecosystem.GENERIC],
    )
    rid = f.cve_id or f.advisory_id or f.finding_id
    lines = [
        f"### {badge} — {rid}",
        "",
        f"- **Finding ID:** `{f.finding_id}`",
        f"- **Scanner:** `{f.scanner.value}`",
        f"- **Package:** `{f.package.name}` (`{label}`) — installed `{f.package.installed_version}`",
    ]
    if f.fixed_version or f.package.fixed_versions:
        fv = f.fixed_version or f.package.fixed_versions[0]
        lines.append(f"- **Fixed in:** `{fv}`")
    if f.title:
        lines.append(f"- **Title:** {f.title}")
    lines.append("")
    lines.append(f"**Remediation:** {remediation}")
    lines.append("")
    return "\n".join(lines)


def comment_for_block(out: HandoffOutput) -> PRComment:
    """Render the BLOCK PR comment for a handoff output.

    The body is built from the *serialised* findings. The
    renderer itself does not touch the lockfile content.
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
        f"## 🔒 Dependency scan: **BLOCK** — {out.finding_count} finding(s)"
    )
    parts.append("")
    parts.append(
        "Merge is blocked. The scanner found CVEs in the PR's "
        "added or updated dependencies. Upgrade each package to "
        "the fixed version (or later) and re-run the scanner."
    )
    parts.append("")
    parts.append(
        "**Severity breakdown:** "
        + ", ".join(
            f"{SEVERITY_BADGES[CveSeverity(s)]}: {n}"
            for s, n in sorted(counts.items(), key=lambda kv: -kv[1])
        )
    )
    parts.append("")

    # Group findings by severity (CRITICAL first).
    by_sev: dict = {}
    for f in out.findings:
        by_sev.setdefault(f.severity, []).append(f)
    for sev in (
        CveSeverity.CRITICAL,
        CveSeverity.HIGH,
        CveSeverity.MEDIUM,
        CveSeverity.LOW,
    ):
        for f in by_sev.get(sev, []):
            parts.append(_finding_section(f))

    parts.append("---")
    parts.append(
        "*Posted by the FORA Dependency Scanner (FORA-76, sub-goal 5.2). "
        "Audit row: `" + (out.evidence_audit_id or "pending") + "`. "
        "CycloneDX SBOM: `" + (out.sbom.artifact_id if out.sbom else "pending") + "`.*"
    )

    summary = f"🔒 dep-scan: BLOCK ({out.finding_count} finding(s))"
    return PRComment(body="\n".join(parts), summary=summary, finding_count=out.finding_count)


def comment_for_pass(out: HandoffOutput) -> PRComment:
    """Render the one-line PASS comment (optional)."""
    if out.decision.value != "pass":
        raise ValueError(
            f"comment_for_pass called with decision={out.decision.value!r}; "
            "expected 'pass'"
        )
    body = (
        "## 🔒 Dependency scan: **PASS**\n\n"
        "No HIGH or CRITICAL CVEs found in this PR's added or "
        "updated dependencies. Merge may proceed (pending other gates)."
    )
    return PRComment(body=body, summary="🔒 dep-scan: PASS", finding_count=0)


def build_pr_comment(out: HandoffOutput) -> Optional[PRComment]:
    """Dispatch: BLOCK → block comment; PASS → pass comment; None → no comment."""
    if out.decision.value == "block":
        return comment_for_block(out)
    if out.decision.value == "pass":
        return None  # pass = no comment by default
    raise ValueError(f"unknown decision: {out.decision!r}")


# ---------------------------------------------------------------------------
# Post-condition: no secret value + no lockfile body in the rendered comment
# ---------------------------------------------------------------------------


def assert_comment_has_no_secret(comment: PRComment) -> None:
    """Raise `ValueError` if the rendered comment contains a secret-shaped
    string or a lockfile-body echo.

    Used by the smoke test (FORA-76 AC #5 analog) and by the runtime
    before posting the comment to GitHub. The check is deliberately
    conservative: every `LEAK_PATTERNS` regex must NOT match the
    body or the summary.
    """
    haystack = comment.body + "\n" + comment.summary
    for pat in LEAK_PATTERNS:
        m = pat.search(haystack)
        if m:
            raise ValueError(
                f"PR comment leaks a secret/lockfile-shaped string: "
                f"pattern {pat.pattern!r} matched {m.group(0)[:64]!r}"
            )