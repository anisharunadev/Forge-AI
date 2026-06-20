"""
PR comment formatter for the Security Agent (FORA-74 AC #5).

The PR comment is the human-readable surface that lands on the
PR thread. The contract is:

  - PASS:    no comment is posted (the scanner returns without
             writing). Optionally the orchestrator may post a
             one-line "🔒 secret scan: pass" — we provide
             `comment_for_pass()` for that path.
  - BLOCK:   a sanitised comment is posted with one section per
             finding. The comment MUST NOT include the secret
             value — only finding id, file, line, category,
             severity, and a remediation hint.

The comment is built by `build_pr_comment()` (the renderer) and
post-verified by `assert_comment_has_no_secret()` (the
post-condition the smoke test asserts).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from .schemas import HandoffOutput, SecretCategory, SecretFinding, SecretSeverity


# Display names for categories — keep the secret-shape out of the
# user-visible string. (e.g. don't print "AKIA…" patterns in the
# heading — just "AWS access key").
CATEGORY_LABELS = {
    SecretCategory.AWS_ACCESS_KEY: "AWS access key",
    SecretCategory.AWS_SESSION_TOKEN: "AWS session token",
    SecretCategory.GITHUB_PAT: "GitHub personal access token",
    SecretCategory.ANTHROPIC_API_KEY: "Anthropic API key",
    SecretCategory.OPENAI_API_KEY: "OpenAI API key",
    SecretCategory.SLACK_TOKEN: "Slack token",
    SecretCategory.STRIPE_LIVE_KEY: "Stripe live key",
    SecretCategory.VAULT_SERVICE_TOKEN: "Vault service token",
    SecretCategory.PRIVATE_KEY_PEM: "PEM private key",
    SecretCategory.GENERIC_API_KEY: "generic API key",
    SecretCategory.GENERIC_PASSWORD: "generic password",
    SecretCategory.CONNECTION_STRING: "connection string",
    SecretCategory.DOTENV_VALUE: ".env value",
}

SEVERITY_BADGES = {
    SecretSeverity.CRITICAL: "🟥 CRITICAL",
    SecretSeverity.HIGH: "🟧 HIGH",
    SecretSeverity.MEDIUM: "🟨 MEDIUM",
    SecretSeverity.LOW: "🟦 LOW",
}


# Default remediation hint per category. The Security Agent writes
# only category-anchored guidance — never "rotate this specific
# key" (that would echo the secret). The remediation string MUST
# NOT include the secret value.
DEFAULT_REMEDIATION: dict = {
    SecretCategory.AWS_ACCESS_KEY: (
        "Revoke the IAM access key in the AWS console, then reference the "
        "secret via the FORA secrets MCP (`secret_ref`) and re-run the "
        "scanner."
    ),
    SecretCategory.AWS_SESSION_TOKEN: (
        "AWS session tokens are short-lived; if this is a stale token, "
        "rotate it. If a long-lived credential is required, use the FORA "
        "secrets MCP (`secret_ref`)."
    ),
    SecretCategory.GITHUB_PAT: (
        "Revoke the GitHub PAT in Settings → Developer settings → "
        "Personal access tokens. Reference secrets via the FORA secrets "
        "MCP (`secret_ref`)."
    ),
    SecretCategory.ANTHROPIC_API_KEY: (
        "Revoke the Anthropic API key in the Anthropic console. Reference "
        "secrets via the FORA secrets MCP (`secret_ref`)."
    ),
    SecretCategory.OPENAI_API_KEY: (
        "Revoke the OpenAI API key in the OpenAI console. Reference "
        "secrets via the FORA secrets MCP (`secret_ref`)."
    ),
    SecretCategory.SLACK_TOKEN: (
        "Rotate the Slack token in the Slack app dashboard. Reference "
        "secrets via the FORA secrets MCP (`secret_ref`)."
    ),
    SecretCategory.STRIPE_LIVE_KEY: (
        "Roll the Stripe live key in the Stripe dashboard. Reference "
        "secrets via the FORA secrets MCP (`secret_ref`)."
    ),
    SecretCategory.VAULT_SERVICE_TOKEN: (
        "Revoke the Vault token and re-issue via the secrets MCP."
    ),
    SecretCategory.PRIVATE_KEY_PEM: (
        "Remove the private key from the repository, rotate the keypair, "
        "and store the new key in AWS Secrets Manager. The previous key "
        "MUST be considered compromised."
    ),
    SecretCategory.GENERIC_API_KEY: (
        "Revoke the leaked credential and reference it via the FORA "
        "secrets MCP (`secret_ref`)."
    ),
    SecretCategory.GENERIC_PASSWORD: (
        "Rotate the password and reference it via the FORA secrets MCP "
        "(`secret_ref`)."
    ),
    SecretCategory.CONNECTION_STRING: (
        "Move the connection string to AWS Secrets Manager; reference "
        "via the FORA secrets MCP (`secret_ref`)."
    ),
    SecretCategory.DOTENV_VALUE: (
        "Remove the raw value from `.env*` files and reference via the "
        "FORA secrets MCP (`secret_ref`)."
    ),
}


# Patterns we use to detect a leak in the rendered comment. These
# are deliberately conservative: if any of these patterns matches
# the comment text, the post-condition fails. The list mirrors the
# rules in `.gitleaks.toml`; adding a new pattern requires also
# adding it to the smoke-test asserts.
LEAK_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bASIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[boprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\b(sk|rk)_live_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\b(hvs|hvb)\.[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"-----BEGIN ((RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY|CERTIFICATE)-----"),
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


def _finding_section(f: SecretFinding) -> str:
    label = CATEGORY_LABELS.get(f.category, f.category.value)
    badge = SEVERITY_BADGES.get(f.severity, f.severity.value)
    remediation = f.remediation or DEFAULT_REMEDIATION.get(
        f.category, "Rotate the credential and reference via `secret_ref`."
    )
    redacted = f.to_dict().get("redacted", "")
    lines = [
        f"### {badge} — {label}",
        "",
        f"- **Finding ID:** `{f.finding_id}`",
        f"- **Rule:** `{f.rule_id}` (`{f.scanner}`)",
        f"- **File:** `{f.file}` (line {f.line})",
        f"- **Redacted match:** `{redacted}`",
        "",
        f"**Remediation:** {remediation}",
        "",
    ]
    return "\n".join(lines)


def comment_for_block(out: HandoffOutput) -> PRComment:
    """Render the BLOCK PR comment for a handoff output.

    The body is built from the *serialised* findings (i.e. each
    finding is already redacted before this function sees it).
    The renderer itself does not touch `secret_value`.
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
        f"## 🔒 Secret scan: **BLOCK** — {out.finding_count} finding(s)"
    )
    parts.append("")
    parts.append(
        "Merge is blocked. The scanner found credentials in this PR. "
        "The values are redacted below; rotate each credential before "
        "re-running the scan."
    )
    parts.append("")
    parts.append(
        "**Severity breakdown:** "
        + ", ".join(
            f"{SEVERITY_BADGES[SecretSeverity(s)]}: {n}"
            for s, n in sorted(counts.items(), key=lambda kv: -kv[1])
        )
    )
    parts.append("")

    # Group findings by severity (CRITICAL first).
    by_sev: dict = {}
    for f in out.findings:
        by_sev.setdefault(f.severity, []).append(f)
    for sev in (
        SecretSeverity.CRITICAL,
        SecretSeverity.HIGH,
        SecretSeverity.MEDIUM,
        SecretSeverity.LOW,
    ):
        for f in by_sev.get(sev, []):
            parts.append(_finding_section(f))

    parts.append("---")
    parts.append(
        "*Posted by the FORA Security Agent (FORA-74, sub-goal 5.1). "
        "Audit row: `" + (out.evidence_audit_id or "pending") + "`.*"
    )

    summary = f"🔒 secret-scan: BLOCK ({out.finding_count} finding(s))"
    return PRComment(body="\n".join(parts), summary=summary, finding_count=out.finding_count)


def comment_for_pass(out: HandoffOutput) -> PRComment:
    """Render the one-line PASS comment (optional)."""
    if out.decision.value != "pass":
        raise ValueError(
            f"comment_for_pass called with decision={out.decision.value!r}; "
            "expected 'pass'"
        )
    body = (
        "## 🔒 Secret scan: **PASS**\n\n"
        "No secrets found in this PR. Merge may proceed (pending other gates)."
    )
    return PRComment(body=body, summary="🔒 secret-scan: PASS", finding_count=0)


def build_pr_comment(out: HandoffOutput) -> Optional[PRComment]:
    """Dispatch: BLOCK → block comment; PASS → pass comment; None → no comment."""
    if out.decision.value == "block":
        return comment_for_block(out)
    if out.decision.value == "pass":
        return None  # pass = no comment by default
    raise ValueError(f"unknown decision: {out.decision!r}")


# ---------------------------------------------------------------------------
# Post-condition: AC #5 (no secret value in the rendered comment)
# ---------------------------------------------------------------------------


def assert_comment_has_no_secret(comment: PRComment) -> None:
    """Raise `ValueError` if the rendered comment contains a secret-shaped
    string. Used by the smoke test (AC #5) and by the runtime before
    posting the comment to GitHub.

    The check is deliberately conservative: every `LEAK_PATTERNS`
    regex must NOT match the body or the summary.
    """
    haystack = comment.body + "\n" + comment.summary
    for pat in LEAK_PATTERNS:
        m = pat.search(haystack)
        if m:
            raise ValueError(
                f"PR comment leaks a secret-shaped string: "
                f"pattern {pat.pattern!r} matched {m.group(0)!r}"
            )
