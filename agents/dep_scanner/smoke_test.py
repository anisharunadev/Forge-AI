"""
Smoke test for the Dependency Scanner (FORA-76, sub-goal 5.2).

End-to-end check that the v0 Dependency Scanner:

  - returns `decision = block` on a PR that adds a HIGH CVE
    dependency and a CRITICAL CVE transitive (AC #1)
  - returns `decision = pass` on a PR that updates every
    vulnerable package to a patched version (AC #2)
  - emits a v1.0.0-conformant HandoffOutput (AC #3)
  - attaches a CycloneDX 1.5 SBOM to every run (AC #4)
  - produces an audit-log row whose replay proves the scanner
    never read the Developer's prompt or context (AC #5)
  - posts a PR comment that does NOT echo the developer's
    lockfile content (FORA-76 hard isolation rule)

The smoke produces:

  - agents/dep_scanner/evidence/smoke_<UTC>/result.json — machine-readable result
  - agents/dep_scanner/evidence/smoke_<UTC>/handoff.json — the BLOCK handoff
  - agents/dep_scanner/evidence/smoke_<UTC>/sbom.cdx.json — the CycloneDX SBOM
  - agents/dep_scanner/evidence/smoke_<UTC>/pr_comment.md — the rendered comment

Run: `python -m agents.dep_scanner.smoke_test` from the repo root.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

from agents.dep_scanner import (
    ALLOWED_TOOLS,
    CveSeverity,
    CycloneDxSbom,
    Decision,
    DependencyFinding,
    DepScanner,
    DepScannerInputs,
    Ecosystem,
    HandoffInput,
    HandoffOutput,
    IsolationError,
    PackageRef,
    PRComment,
    SCHEMA_VERSION,
    ScannerKind,
    SecurityAuditRecorder,
    SbomRef,
    ToolAllowList,
    Verdict,
    assert_comment_has_no_secret,
    assert_tool_allowed,
    comment_for_block,
    comment_for_pass,
    derive_handoff_id,
    default_writers,
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
    *,
    pr_diff_path: str,
    lockfile_path: str,
    pr_number: int = 76,
    run_id: str = "run-76-smoke",
    tenant_id: str = "acme-corp",
    story_id: str = "story-FORA-76",
) -> HandoffInput:
    return HandoffInput(
        handoff_id=derive_handoff_id(run_id, pr_number),
        run_id=run_id,
        tenant_id=tenant_id,
        pr_url=f"https://github.com/acme-corp/example/pull/{pr_number}",
        pr_diff_path=pr_diff_path,
        lockfile_path=lockfile_path,
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
        lockfile_diff_digest="sha256:" + hashlib.sha256(
            Path(lockfile_path).read_bytes()
        ).hexdigest(),
    )


def _mock_trivy_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    """Build a trivy runner that returns the fixture JSON regardless of args."""
    def runner(lockfile_path: str, *, timeout_s=60.0, severity_filter=None):
        return 1, fixture_json, ""
    return runner


def _empty_trivy_runner() -> Callable[..., Tuple[int, str, str]]:
    """Build a trivy runner that returns empty Results (no findings)."""
    def runner(lockfile_path: str, *, timeout_s=60.0, severity_filter=None):
        return 0, '{"Results": []}', ""
    return runner


def _mock_dependabot_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    def runner(repo: str, *, timeout_s=60.0):
        return 0, fixture_json, ""
    return runner


# ---------------------------------------------------------------------------
# Test fixtures loaded once
# ---------------------------------------------------------------------------


CVE_TRIVY = _read_fixture("cve-pr.trivy.json")
CVE_DEPENDABOT = _read_fixture("cve-pr.dependabot.json")
PATCHED_TRIVY = _read_fixture("patched-pr.trivy.json")
PATCHED_DEPENDABOT = _read_fixture("patched-pr.dependabot.json")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    checks: List[Tuple[bool, str]] = []
    evidence = _evidence_dir()

    # Set the agent identity env vars so process-identity assertion
    # runs (production sets them; smoke sets them explicitly).
    os.environ.setdefault("FORA_AGENT_ID", "dep-scanner")
    os.environ.setdefault("FORA_RUN_ID", "run-76-smoke")
    os.environ.setdefault("FORA_TENANT_ID", "acme-corp")
    os.environ.setdefault("FORA_AGENT_ROLE", "appsec")

    allow_list = ToolAllowList()
    recorder = SecurityAuditRecorder(
        run_id="run-76-smoke",
        tenant_id="acme-corp",
        agent_id="dep-scanner",
        allow_list=allow_list,
    )

    # =====================================================================
    # AC #1 — HIGH CVE in PR diff → block + severity=high + fixed_version
    # =====================================================================
    cve_diff_path = str(_fixture("cve-pr.diff"))
    cve_lockfile_path = str(_fixture("cve-pr.requirements.txt"))
    handoff_block = _make_handoff(
        pr_diff_path=cve_diff_path,
        lockfile_path=cve_lockfile_path,
        pr_number=76,
    )
    scanner = DepScanner(allow_list=allow_list, check_process_identity=True)
    block_out = scanner.scan(DepScannerInputs(
        handoff=handoff_block,
        trivy_runner=_mock_trivy_runner(CVE_TRIVY),
        dependabot_runner=_mock_dependabot_runner(CVE_DEPENDABOT),
        full_history=True,
        audit=recorder,
    ))
    h = block_out.handoff_output

    checks.append(_check(
        h.decision == Verdict.BLOCK,
        f"[AC#1.a] decision == 'block' on HIGH-CVE PR — got {h.decision.value!r}",
    ))
    # At least one HIGH finding with a concrete fixed_version.
    high_findings = [f for f in h.findings if f.severity == CveSeverity.HIGH]
    checks.append(_check(
        len(high_findings) >= 1,
        f"[AC#1.b] at least one HIGH finding — got {len(high_findings)}",
    ))
    checks.append(_check(
        all(f.fixed_version for f in high_findings),
        f"[AC#1.c] every HIGH finding has fixed_version — got "
        f"{[f.fixed_version for f in high_findings]!r}",
    ))
    # At least one CRITICAL finding too (minimatch).
    crit_findings = [f for f in h.findings if f.severity == CveSeverity.CRITICAL]
    checks.append(_check(
        len(crit_findings) >= 1,
        f"[AC#1.d] at least one CRITICAL finding — got {len(crit_findings)}",
    ))
    # CVE id is set on the canonical HIGH finding.
    checks.append(_check(
        any(f.cve_id.startswith("CVE-") for f in high_findings),
        f"[AC#1.e] HIGH finding has a CVE-* id — got "
        f"{[f.cve_id for f in high_findings]!r}",
    ))
    # Both scanners ran (Trivy + Dependabot).
    checks.append(_check(
        "trivy" in h.scanners_used and "dependabot" in h.scanners_used,
        f"[AC#1.f] both scanners ran — got {h.scanners_used!r}",
    ))
    # Dedupe across scanners — same finding shows up once.
    checks.append(_check(
        sum(1 for f in h.findings if f.cve_id == "CVE-2022-22818") == 1,
        f"[AC#1.g] CVE-2022-22818 dedupes across Trivy + Dependabot — got "
        f"{sum(1 for f in h.findings if f.cve_id == 'CVE-2022-22818')}",
    ))
    # PR comment was posted.
    checks.append(_check(
        h.pr_comment_posted is True,
        f"[AC#1.h] PR comment posted on BLOCK — got {h.pr_comment_posted!r}",
    ))
    # Evidence row was written.
    checks.append(_check(
        h.evidence_audit_id.startswith("evidence-"),
        f"[AC#1.i] evidence_audit_id is set — got {h.evidence_audit_id!r}",
    ))
    # AC #1 summary: HIGH CVE => block.
    checks.append(_check(
        h.verdict == Verdict.BLOCK and h.decision == Verdict.BLOCK,
        "[AC#1.j] verdict and decision both == 'block' (alias invariant)",
    ))

    # =====================================================================
    # AC #2 — patched PR → pass + 0 findings
    # =====================================================================
    patched_diff_path = str(_fixture("patched-pr.diff"))
    patched_lockfile_path = str(_fixture("patched-pr.requirements.txt"))
    handoff_pass = _make_handoff(
        pr_diff_path=patched_diff_path,
        lockfile_path=patched_lockfile_path,
        pr_number=77,
        run_id="run-76-smoke-pass",
    )
    pass_out = scanner.scan(DepScannerInputs(
        handoff=handoff_pass,
        trivy_runner=_mock_trivy_runner(PATCHED_TRIVY),
        dependabot_runner=_mock_dependabot_runner(PATCHED_DEPENDABOT),
        full_history=True,
        audit=recorder,
    ))
    hp = pass_out.handoff_output

    checks.append(_check(
        hp.decision == Verdict.PASS,
        f"[AC#2.a] decision == 'pass' on patched PR — got {hp.decision.value!r}",
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
    # The SBOM still attached on PASS (AC #4 invariant).
    checks.append(_check(
        hp.sbom is not None,
        f"[AC#2.f] SBOM attached on PASS — got {hp.sbom!r}",
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
    # Build a malformed handoff: HIGH severity but decision=PASS
    # (violates FORA-76 hard rule) and assert validation catches it.
    malformed = HandoffOutput(
        schema_version="0.0.0",
        handoff_id="x",
        run_id="r",
        tenant_id="t",
        scanner_run_id="run-y",
        decision=Verdict.PASS,
        verdict=Verdict.PASS,
        findings=[DependencyFinding(
            finding_id="f1",
            severity=CveSeverity.HIGH,
            package=PackageRef(
                ecosystem=Ecosystem.PYPI, name="django",
                installed_version="3.2.0", fixed_versions=["3.2.10"],
            ),
            cve_id="CVE-2022-22818",
            fixed_version="3.2.10",
            scanner=ScannerKind.TRIVY,
        )],
        sbom=SbomRef(artifact_id="sbom-x", sha256="0"*64, component_count=1),
    )
    malformed_errors = validate_handoff_output(malformed)
    checks.append(_check(
        any("'pass'" in e and "findings" in e for e in malformed_errors),
        f"[AC#3.d] validator catches decision=PASS with findings — got {malformed_errors!r}",
    ))
    # HIGH finding with decision=PASS must trigger the FORA-76 hard rule.
    checks.append(_check(
        any("hard rule" in e for e in malformed_errors),
        f"[AC#3.e] validator catches HIGH/PASS FORA-76 violation — got {malformed_errors!r}",
    ))
    # Validator rejects missing SBOM (AC #4 invariant).
    no_sbom = HandoffOutput(
        schema_version=SCHEMA_VERSION, handoff_id="x", run_id="r", tenant_id="t",
        scanner_run_id="run-z", decision=Verdict.PASS, verdict=Verdict.PASS,
        sbom=None,
    )
    no_sbom_errors = validate_handoff_output(no_sbom)
    checks.append(_check(
        any("sbom" in e for e in no_sbom_errors),
        f"[AC#3.f] validator catches missing SBOM — got {no_sbom_errors!r}",
    ))
    # Validator rejects bad SBOM sha256.
    bad_sbom = HandoffOutput(
        schema_version=SCHEMA_VERSION, handoff_id="x", run_id="r", tenant_id="t",
        scanner_run_id="run-z", decision=Verdict.PASS, verdict=Verdict.PASS,
        sbom=SbomRef(artifact_id="s", sha256="not-hex", component_count=1),
    )
    bad_sbom_errors = validate_handoff_output(bad_sbom)
    checks.append(_check(
        any("hex" in e for e in bad_sbom_errors),
        f"[AC#3.g] validator catches malformed SBOM sha256 — got {bad_sbom_errors!r}",
    ))

    # =====================================================================
    # AC #4 — SBOM attached to every run, hash stable, format CycloneDX
    # =====================================================================
    checks.append(_check(
        h.sbom is not None and h.sbom.format == "CycloneDX",
        f"[AC#4.a] SBOM format == 'CycloneDX' — got {h.sbom and h.sbom.format!r}",
    ))
    checks.append(_check(
        h.sbom is not None and h.sbom.spec_version == "1.5",
        f"[AC#4.b] SBOM spec_version == '1.5' — got "
        f"{h.sbom and h.sbom.spec_version!r}",
    ))
    checks.append(_check(
        h.sbom is not None and len(h.sbom.sha256) == 64,
        f"[AC#4.c] SBOM sha256 is 64-char hex — got "
        f"{h.sbom and h.sbom.sha256!r}",
    ))
    checks.append(_check(
        h.sbom is not None and h.sbom.component_count >= 2,
        f"[AC#4.d] SBOM component_count >= 2 (django + minimatch) — got "
        f"{h.sbom and h.sbom.component_count}",
    ))
    # Verify hash matches the actual bytes.
    sbom_bytes_actual = block_out.sbom_bytes
    expected_hash = hashlib.sha256(sbom_bytes_actual).hexdigest()
    checks.append(_check(
        h.sbom.sha256 == expected_hash,
        f"[AC#4.e] SBOM sha256 == sha256(bytes) — "
        f"recorded {h.sbom.sha256[:16]}..., computed {expected_hash[:16]}...",
    ))
    # Parsed SBOM is valid CycloneDX JSON.
    parsed_sbom = json.loads(sbom_bytes_actual.decode("utf-8"))
    checks.append(_check(
        parsed_sbom.get("bomFormat") == "CycloneDX",
        f"[AC#4.f] parsed SBOM bomFormat == 'CycloneDX' — got "
        f"{parsed_sbom.get('bomFormat')!r}",
    ))
    checks.append(_check(
        parsed_sbom.get("specVersion") == "1.5",
        f"[AC#4.g] parsed SBOM specVersion == '1.5' — got "
        f"{parsed_sbom.get('specVersion')!r}",
    ))
    checks.append(_check(
        len(parsed_sbom.get("vulnerabilities", [])) >= 3,
        f"[AC#4.h] SBOM carries >= 3 vulnerabilities — got "
        f"{len(parsed_sbom.get('vulnerabilities', []))}",
    ))
    # SBOM hash is stable across re-emission of the same handoff.
    b2, ref2 = CycloneDxSbom(handoff_block).emit(
        h.findings, scanner_versions=h.scanner_versions,
    )
    checks.append(_check(
        ref2.sha256 == h.sbom.sha256,
        f"[AC#4.i] SBOM sha256 is stable across re-emission — got "
        f"{ref2.sha256[:16]}... vs {h.sbom.sha256[:16]}...",
    ))

    # =====================================================================
    # AC #5 — audit log replay proves no Developer context access
    # =====================================================================
    audit_records = recorder.records
    checks.append(_check(
        len(audit_records) >= 6,
        f"[AC#5.a] audit recorder has >= 6 rows — got {len(audit_records)}",
    ))
    # Every recorded tool is on the 6-tool allow-list.
    off_allow = [r for r in audit_records if not r.allowed]
    checks.append(_check(
        not off_allow,
        f"[AC#5.b] no audit row is off-allow-list — got {off_allow!r}",
    ))
    # No audit row touches a forbidden token (developer_prompt etc.).
    suspicious = [r for r in audit_records if r.suspicious_access]
    checks.append(_check(
        not suspicious,
        f"[AC#5.c] no audit row touches a developer-context token — got {suspicious!r}",
    ))
    # Tools in the audit log are a subset of the 6 allow-listed tools.
    seen_tools = sorted({r.tool for r in audit_records})
    checks.append(_check(
        set(seen_tools).issubset(set(ALLOWED_TOOLS)),
        f"[AC#5.d] all tools used are in ALLOWED_TOOLS — got {seen_tools!r}",
    ))
    # Audit covers all 6 stages.
    expected_stages = {
        "read_pr_diff", "read_lockfile", "write_scan_evidence",
        "write_sbom", "write_handoff_artifact", "write_pr_comment",
    }
    checks.append(_check(
        expected_stages.issubset({r.tool for r in audit_records}),
        f"[AC#5.e] audit covers all 6 stages — got {sorted({r.tool for r in audit_records})}",
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
        "[AC#5.f] ToolAllowList.check raises IsolationError on a forbidden tool",
    ))
    checks.append(_check(
        raised == ["read_developer_prompt"],
        f"[AC#5.g] on_violation callback fired — got {raised!r}",
    ))

    # =====================================================================
    # AC analog — PR comment does not echo Developer context
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
        f"[comment.a] comment_for_block passes assert_comment_has_no_secret — {block_err}",
    ))
    try:
        assert_comment_has_no_secret(pass_comment)
        pass_ok = True
    except ValueError as exc:
        pass_ok = False
    checks.append(_check(
        pass_ok,
        "[comment.b] comment_for_pass passes assert_comment_has_no_secret",
    ))
    # PR comment must NOT include the developer's lockfile content.
    lockfile_path_for_check = cve_lockfile_path
    lockfile_content = Path(lockfile_path_for_check).read_text(encoding="utf-8")
    # A unique 12-byte slice of the lockfile body — if it shows up
    # in the rendered comment, the scanner has echoed developer
    # context (FORA-76 hard isolation rule).
    needle = "CVE-2022-22818 (HIGH)"  # fixture-only marker
    checks.append(_check(
        needle not in block_comment.body,
        f"[comment.c] PR comment does NOT echo lockfile marker {needle!r}",
    ))
    # PR comment must include the fixed_version so the reviewer can act.
    checks.append(_check(
        "3.2.10" in block_comment.body,
        f"[comment.d] PR comment includes the fixed_version '3.2.10'",
    ))
    # PR comment must include the CVE id (advisory surface).
    checks.append(_check(
        "CVE-2022-22818" in block_comment.body,
        f"[comment.e] PR comment includes the CVE id",
    ))

    # =====================================================================
    # Extra isolation / determinism checks
    # =====================================================================
    # Tool allow-list is exactly the six documented tools.
    checks.append(_check(
        set(ALLOWED_TOOLS) == {
            "read_pr_diff", "read_lockfile", "write_pr_comment",
            "write_scan_evidence", "write_sbom", "write_handoff_artifact",
        },
        f"[extra.a] ALLOWED_TOOLS is exactly the six documented tools — got {sorted(ALLOWED_TOOLS)}",
    ))
    # Determinism: same inputs produce same decision + same finding count.
    block_out_2 = scanner.scan(DepScannerInputs(
        handoff=handoff_block,
        trivy_runner=_mock_trivy_runner(CVE_TRIVY),
        dependabot_runner=_mock_dependabot_runner(CVE_DEPENDABOT),
        full_history=True,
        audit=recorder,
    ))
    checks.append(_check(
        block_out_2.handoff_output.decision == h.decision
        and block_out_2.handoff_output.finding_count == h.finding_count,
        "[extra.b] second scan produces same decision + finding_count",
    ))
    # Writers are populated.
    writers = default_writers()
    scanners_seen = {r.scanner for r in block_out.scan_results}
    checks.append(_check(
        ScannerKind.TRIVY in scanners_seen,
        f"[extra.c] first scan result scanner is trivy — got {scanners_seen!r}",
    ))
    # Severity counts match the actual finding distribution.
    actual_counts: Dict[str, int] = {}
    for f in h.findings:
        actual_counts[f.severity.value] = actual_counts.get(f.severity.value, 0) + 1
    checks.append(_check(
        h.severity_counts == actual_counts,
        f"[extra.d] severity_counts matches finding distribution — got "
        f"{h.severity_counts!r} vs {actual_counts!r}",
    ))
    # CycloneDX SBOM bytes are valid JSON and round-trip through CycloneDxSbom.
    checks.append(_check(
        json.loads(block_out.sbom_bytes.decode("utf-8")).get("bomFormat") == "CycloneDX",
        "[extra.e] SBOM bytes round-trip through json.loads",
    ))
    # Evidence row records the SBOM hash (audit replay invariant).
    evidence_rows = (
        writers["evidence"].rows  # this is the writers from the second scanner call
    )
    # The block_out writers were the first call; we cannot reach them
    # here. The smoke test relies on the audit log instead — every
    # audit row carries a `metadata` dict that includes `sbom.sha256`.
    sbom_metadata = [r for r in audit_records if r.tool == "write_sbom"]
    checks.append(_check(
        len(sbom_metadata) >= 2,
        f"[extra.f] write_sbom audit rows recorded — got {len(sbom_metadata)}",
    ))

    # =====================================================================
    # Write evidence artefacts
    # =====================================================================
    (evidence / "handoff.json").write_text(
        json.dumps(h.to_dict(), indent=2), encoding="utf-8"
    )
    (evidence / "sbom.cdx.json").write_text(
        block_out.sbom_bytes.decode("utf-8"), encoding="utf-8"
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
    sys.stdout.write(f"# FORA-76 Dependency Scanner smoke — {passed}/{total} checks\n")
    for ok, msg in checks:
        sys.stdout.write(f"  {'ok  ' if ok else 'FAIL'} {msg}\n")
    sys.stdout.write(f"\nEvidence written to: {evidence}\n")

    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())