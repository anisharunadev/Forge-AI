"""
Smoke test for the Security Agent (FORA-74, sub-goal 5.1).

End-to-end check that the v0 Secret Scanner:

  - returns `decision = block` on a PR with a deliberate AWS
    access key (AC #1)
  - returns `decision = pass` on a clean PR (AC #2)
  - emits a v1.0.0-conformant HandoffOutput (AC #3)
  - produces an audit-log row whose replay proves the scanner
    never read the Developer's prompt or context (AC #4)
  - posts a PR comment that contains the finding ids but NEVER
    the secret value (AC #5)

The smoke produces:

  - agents/security/evidence/smoke_<UTC>/result.json — machine-readable result
  - agents/security/evidence/smoke_<UTC>/handoff.json — the BLOCK handoff
  - agents/security/evidence/smoke_<UTC>/pr_comment.md — the rendered comment

Run: `python -m agents.security.smoke_test` from the repo root.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

from agents.security import (
    ALLOWED_TOOLS,
    Decision,
    HandoffInput,
    HandoffOutput,
    IsolationError,
    SCHEMA_VERSION,
    SecretCategory,
    SecretFinding,
    SecretScanner,
    SecretSeverity,
    ScannerInputs,
    SecurityAuditRecorder,
    ToolAllowList,
    Verdict,
    assert_comment_has_no_secret,
    assert_tool_allowed,
    comment_for_block,
    comment_for_pass,
    derive_handoff_id,
    validate_handoff_output,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _evidence_dir() -> Path:
    evidence = HERE / "evidence" / f"smoke_{_utc_stamp()}"
    evidence.mkdir(parents=True, exist_ok=True)
    return evidence


def _check(condition: bool, message: str) -> Tuple[bool, str]:
    return (condition, "OK  — " + message if condition else "FAIL — " + message)


def _fixture(name: str) -> Path:
    return HERE / "fixtures" / name


def _read_fixture(name: str) -> str:
    return _fixture(name).read_text(encoding="utf-8")


def _make_handoff(
    *, pr_diff_path: str, pr_number: int = 142, run_id: str = "run-74-smoke",
    tenant_id: str = "acme-corp", story_id: str = "story-FORA-74",
) -> HandoffInput:
    return HandoffInput(
        handoff_id=derive_handoff_id(run_id, pr_number),
        run_id=run_id,
        tenant_id=tenant_id,
        pr_url=f"https://github.com/acme-corp/example/pull/{pr_number}",
        pr_diff_path=pr_diff_path,
        pr_number=pr_number,
        repo="acme-corp/example",
        base_sha="abc1234",
        head_sha="def5678",
        author="alice",
        story_id=story_id,
        plan_id=f"plan-{story_id}",
        code_diff_digest="sha256:" + hashlib.sha256(
            Path(pr_diff_path).read_bytes()
        ).hexdigest(),
    )


def _mock_gitleaks_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    """Build a gitleaks runner that returns the fixture JSON regardless of args."""
    def runner(pr_diff_path: str, *, config_path=None, timeout_s=30.0):
        return 1, fixture_json, ""
    return runner


def _empty_gitleaks_runner() -> Callable[..., Tuple[int, str, str]]:
    """Build a gitleaks runner that returns empty stdout (no findings)."""
    def runner(pr_diff_path: str, *, config_path=None, timeout_s=30.0):
        return 0, "", ""
    return runner


def _mock_trufflehog_runner(fixture_ndjson: str) -> Callable[..., Tuple[int, str, str]]:
    def runner(repo_path: str, *, timeout_s=300.0):
        return 0, fixture_ndjson, ""
    return runner


# ---------------------------------------------------------------------------
# Test fixtures loaded once
# ---------------------------------------------------------------------------


SECRET_FIXTURE_JSON = _read_fixture("secret-pr.gitleaks.json")
TRUFFLEHOG_FIXTURE = _read_fixture("secret-pr.trufflehog.jsonl")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    checks: List[Tuple[bool, str]] = []
    evidence = _evidence_dir()

    # Set the agent identity env vars so process-identity assertion
    # runs (production sets them; smoke sets them explicitly).
    os.environ.setdefault("FORA_AGENT_ID", "secret-scanner")
    os.environ.setdefault("FORA_RUN_ID", "run-74-smoke")
    os.environ.setdefault("FORA_TENANT_ID", "acme-corp")
    os.environ.setdefault("FORA_AGENT_ROLE", "appsec")

    allow_list = ToolAllowList()
    recorder = SecurityAuditRecorder(
        run_id="run-74-smoke",
        tenant_id="acme-corp",
        agent_id="secret-scanner",
        allow_list=allow_list,
    )

    # =====================================================================
    # AC #1 — deliberate AWS access key in src/example.py → block + critical
    # =====================================================================
    secret_diff = str(_fixture("secret-pr.diff"))
    secret_diff_path = str(_fixture("secret-pr.diff"))
    handoff_block = _make_handoff(pr_diff_path=secret_diff_path, pr_number=142)
    scanner = SecretScanner(allow_list=allow_list, check_process_identity=True)
    block_out = scanner.scan(ScannerInputs(
        handoff=handoff_block,
        gitleaks_runner=_mock_gitleaks_runner(SECRET_FIXTURE_JSON),
        trufflehog_runner=_mock_trufflehog_runner(TRUFFLEHOG_FIXTURE),
        full_history=True,
        audit=recorder,
    ))
    h = block_out.handoff_output

    checks.append(_check(
        h.decision == Verdict.BLOCK,
        f"[AC#1.a] decision == 'block' on secret-bearing PR — got {h.decision.value!r}",
    ))
    checks.append(_check(
        any(
            f.category.value == "aws_access_key" and f.severity.value == "critical"
            for f in h.findings
        ),
        "[AC#1.b] at least one finding has category=aws_access_key AND severity=critical",
    ))
    checks.append(_check(
        h.finding_count >= 5,
        f"[AC#1.c] finding_count >= 5 (dedupe across scanners) — got {h.finding_count}",
    ))
    checks.append(_check(
        h.findings[0].file == "src/example.py",
        f"[AC#1.d] first finding is in src/example.py — got {h.findings[0].file!r}",
    ))
    checks.append(_check(
        h.scanner_run_id.startswith("run-"),
        f"[AC#1.e] scanner_run_id is set — got {h.scanner_run_id!r}",
    ))
    checks.append(_check(
        "gitleaks" in h.scanners_used and "trufflehog" in h.scanners_used,
        f"[AC#1.f] both scanners ran — got {h.scanners_used!r}",
    ))
    checks.append(_check(
        h.pr_comment_posted is True,
        f"[AC#1.g] PR comment was posted on BLOCK — got {h.pr_comment_posted!r}",
    ))
    checks.append(_check(
        h.evidence_audit_id.startswith("evidence-"),
        f"[AC#1.h] evidence_audit_id is set — got {h.evidence_audit_id!r}",
    ))

    # =====================================================================
    # AC #2 — clean PR → pass + 0 findings
    # =====================================================================
    clean_diff_path = str(_fixture("clean-pr.diff"))
    handoff_pass = _make_handoff(
        pr_diff_path=clean_diff_path, pr_number=143, run_id="run-74-smoke-clean",
    )
    pass_out = scanner.scan(ScannerInputs(
        handoff=handoff_pass,
        gitleaks_runner=_empty_gitleaks_runner(),
        trufflehog_runner=_mock_trufflehog_runner(""),
        full_history=True,
        audit=recorder,
    ))
    hp = pass_out.handoff_output

    checks.append(_check(
        hp.decision == Verdict.PASS,
        f"[AC#2.a] decision == 'pass' on clean PR — got {hp.decision.value!r}",
    ))
    checks.append(_check(
        hp.finding_count == 0,
        f"[AC#2.b] finding_count == 0 — got {hp.finding_count}",
    ))
    checks.append(_check(
        not hp.findings,
        f"[AC#2.c] findings list is empty — got {len(hp.findings)} finding(s)",
    ))
    checks.append(_check(
        hp.pr_comment_posted is False,
        f"[AC#2.d] PR comment NOT posted on PASS — got {hp.pr_comment_posted!r}",
    ))
    checks.append(_check(
        hp.severity_counts == {},
        f"[AC#2.e] severity_counts empty on PASS — got {hp.severity_counts!r}",
    ))

    # =====================================================================
    # AC #3 — verdict object conforms to v1.0.0 schema
    # =====================================================================
    checks.append(_check(
        h.schema_version == SCHEMA_VERSION,
        f"[AC#3.a] schema_version == '1.0.0' — got {h.schema_version!r}",
    ))
    block_errors = validate_handoff_output(h)
    checks.append(_check(
        not block_errors,
        f"[AC#3.b] validate_handoff_output(block) is clean — got {block_errors!r}",
    ))
    pass_errors = validate_handoff_output(hp)
    checks.append(_check(
        not pass_errors,
        f"[AC#3.c] validate_handoff_output(pass) is clean — got {pass_errors!r}",
    ))
    # Build a malformed handoff and assert validation catches it.
    malformed = HandoffOutput(
        schema_version="0.0.0",  # wrong version
        handoff_id="x",
        run_id="",
        tenant_id="acme",
        scanner_run_id="run-y",
        decision=Verdict.PASS,
        verdict=Verdict.PASS,
        findings=[SecretFinding(
            finding_id="f1",
            severity=SecretSeverity.CRITICAL,
            category=SecretCategory.AWS_ACCESS_KEY,
            rule_id="fora-aws-access-key",
            scanner="gitleaks",
            file="x.py",
            line=1,
        )],
    )
    malformed_errors = validate_handoff_output(malformed)
    checks.append(_check(
        len(malformed_errors) >= 2,
        f"[AC#3.d] validator rejects malformed handoff (version + run_id + decision/findings invariant) — got {malformed_errors!r}",
    ))
    # Inconsistent decision vs findings: PASS but findings non-empty.
    inconsistent = HandoffOutput(
        schema_version=SCHEMA_VERSION,
        handoff_id="x",
        run_id="r",
        tenant_id="t",
        scanner_run_id="run-z",
        decision=Verdict.PASS,
        verdict=Verdict.PASS,
        findings=[SecretFinding(
            finding_id="f1",
            severity=SecretSeverity.HIGH,
            category=SecretCategory.GITHUB_PAT,
            rule_id="fora-github-pat",
            scanner="gitleaks",
            file="x.py",
            line=1,
        )],
    )
    inconsistent_errors = validate_handoff_output(inconsistent)
    checks.append(_check(
        any("'pass'" in e and "findings" in e for e in inconsistent_errors),
        f"[AC#3.e] validator catches decision=PASS with findings — got {inconsistent_errors!r}",
    ))

    # =====================================================================
    # AC #4 — audit log replay proves no Developer context access
    # =====================================================================
    audit_records = recorder.records
    checks.append(_check(
        len(audit_records) >= 4,
        f"[AC#4.a] audit recorder has >= 4 rows — got {len(audit_records)}",
    ))
    # Every recorded tool is on the allow-list.
    off_allow = [r for r in audit_records if not r.allowed]
    checks.append(_check(
        not off_allow,
        f"[AC#4.b] no audit row is off-allow-list — got {off_allow!r}",
    ))
    # No audit row touches a forbidden token (developer_prompt etc.).
    suspicious = [r for r in audit_records if r.suspicious_access]
    checks.append(_check(
        not suspicious,
        f"[AC#4.c] no audit row touches a developer-context token — got {suspicious!r}",
    ))
    # Tools in the audit log are a subset of the 4 allow-listed tools.
    seen_tools = sorted({r.tool for r in audit_records})
    checks.append(_check(
        set(seen_tools).issubset(set(ALLOWED_TOOLS)),
        f"[AC#4.d] all tools used are in ALLOWED_TOOLS — got {seen_tools!r}",
    ))
    # Per-run the recorded tools cover the 4 stages.
    expected_stages = {"read_pr_diff", "write_scan_evidence",
                       "write_handoff_artifact", "write_pr_comment"}
    block_records = [
        r for r in audit_records
        if r.metadata.get("pr_number") in (None, 142)
        or r.tool == "read_pr_diff"
    ]
    seen_stages = {r.tool for r in audit_records}
    checks.append(_check(
        expected_stages.issubset(seen_stages),
        f"[AC#4.e] audit covers all 4 stages — got {sorted(seen_stages)}",
    ))
    # Allow-list enforcement: a forbidden tool raises IsolationError.
    raised: List[str] = []
    def _on_violation(v: Dict[str, Any]) -> None:
        raised.append(v.get("tool", "?"))
    test_list = ToolAllowList(on_violation=_on_violation)
    try:
        assert_tool_allowed("read_developer_prompt", test_list)
        raised_ok = False
    except IsolationError:
        raised_ok = True
    checks.append(_check(
        raised_ok,
        "[AC#4.f] ToolAllowList.check raises IsolationError on a forbidden tool",
    ))
    checks.append(_check(
        raised == ["read_developer_prompt"],
        f"[AC#4.g] on_violation callback fired — got {raised!r}",
    ))

    # =====================================================================
    # AC #5 — PR comment has no secret value
    # =====================================================================
    block_comment = comment_for_block(h)
    pass_comment = comment_for_pass(hp)
    # Direct render — must not raise.
    try:
        assert_comment_has_no_secret(block_comment)
        block_ok = True
        block_err = ""
    except ValueError as exc:
        block_ok = False
        block_err = str(exc)
    checks.append(_check(
        block_ok,
        f"[AC#5.a] comment_for_block passes assert_comment_has_no_secret — {block_err}",
    ))
    try:
        assert_comment_has_no_secret(pass_comment)
        pass_ok = True
    except ValueError as exc:
        pass_ok = False
    checks.append(_check(
        pass_ok,
        "[AC#5.b] comment_for_pass passes assert_comment_has_no_secret",
    ))
    # No finding's redacted representation equals its raw value (sanitisation
    # actually replaces the value).
    no_sanitise = [
        f for f in h.findings
        if f.to_dict().get("redacted", "") == f.secret_value
    ]
    checks.append(_check(
        not no_sanitise,
        f"[AC#5.c] no finding's redacted == secret_value — got {no_sanitise!r}",
    ))
    # Serialised HandoffOutput never carries secret_value.
    serialised = h.to_dict()
    leak_findings = []
    for f_dict in serialised["findings"]:
        if "secret_value" in f_dict and f_dict.get("secret_value"):
            leak_findings.append(f_dict.get("finding_id"))
    checks.append(_check(
        not leak_findings,
        f"[AC#5.d] HandoffOutput.to_dict() serialisation has no secret_value — leaks: {leak_findings!r}",
    ))
    # The body of the comment does not contain any secret-shaped string.
    for needle, label in [
        ("AKIAIOSFODNN7EXAMPLE", "AWS key"),
        ("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", "GitHub PAT"),
        ("sk_live_4eC39HqLyjWDarjtT1zdp7dc", "Stripe live key"),
        ("xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx", "Slack token"),
    ]:
        checks.append(_check(
            needle not in block_comment.body,
            f"[AC#5.e.{label}] PR comment body does NOT contain {needle!r}",
        ))

    # =====================================================================
    # Extra isolation / determinism checks
    # =====================================================================
    # Tool allow-list is exactly the four documented tools.
    checks.append(_check(
        set(ALLOWED_TOOLS) == {
            "read_pr_diff", "write_pr_comment",
            "write_scan_evidence", "write_handoff_artifact",
        },
        f"[extra.a] ALLOWED_TOOLS is exactly the four documented tools — got {sorted(ALLOWED_TOOLS)}",
    ))
    # Determinism: same inputs produce same decision + same finding count.
    block_out_2 = scanner.scan(ScannerInputs(
        handoff=handoff_block,
        gitleaks_runner=_mock_gitleaks_runner(SECRET_FIXTURE_JSON),
        trufflehog_runner=_mock_trufflehog_runner(TRUFFLEHOG_FIXTURE),
        full_history=True,
        audit=recorder,
    ))
    checks.append(_check(
        block_out_2.handoff_output.decision == h.decision
        and block_out_2.handoff_output.finding_count == h.finding_count,
        "[extra.b] second scan produces same decision + finding_count",
    ))
    # Writers are populated.
    checks.append(_check(
        block_out.scan_results[0].scanner == "gitleaks",
        f"[extra.c] first scan result scanner is gitleaks — got {block_out.scan_results[0].scanner!r}",
    ))

    # =====================================================================
    # Write evidence artefacts
    # =====================================================================
    (evidence / "handoff.json").write_text(
        json.dumps(h.to_dict(), indent=2), encoding="utf-8"
    )
    (evidence / "pr_comment.md").write_text(block_comment.body, encoding="utf-8")
    (evidence / "result.json").write_text(
        json.dumps({
            "schema_version": SCHEMA_VERSION,
            "summary": {
                "total": len(checks),
                "passed": sum(1 for c, _ in checks if c),
                "failed": sum(1 for c, _ in checks if not c),
            },
            "checks": [
                {"ok": ok, "message": msg}
                for ok, msg in checks
            ],
        }, indent=2),
        encoding="utf-8",
    )

    # =====================================================================
    # Print results
    # =====================================================================
    passed = sum(1 for c, _ in checks if c)
    total = len(checks)
    sys.stdout.write(f"# FORA-74 Security Agent smoke — {passed}/{total} checks\n")
    for ok, msg in checks:
        sys.stdout.write(f"  {'ok  ' if ok else 'FAIL'} {msg}\n")
    sys.stdout.write(f"\nEvidence written to: {evidence}\n")

    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
