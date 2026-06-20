"""
Smoke test for the IaC Scanner (FORA-77, sub-goal 5.3).

End-to-end check that the v0 IaC Scanner:

  - returns `decision = block` on a PR that adds a Terraform file
    with an open S3 bucket and no encryption (AC #1)
  - returns `decision = pass` on a PR that only changes a
    Kubernetes manifest to add `securityContext.readOnlyRootFilesystem`
    (AC #2)
  - short-circuits to `decision = pass` with the `iacNotPresent`
    evidence flag when no IaC files are in the diff (AC #3)
  - emits a v1.0.0-conformant HandoffOutput (AC #4)
  - produces an audit-log row whose replay proves the scanner
    never read the Developer's prompt or context (AC #5)
  - covers all four file types: Terraform, CloudFormation,
    Kubernetes, Dockerfile
  - posts a PR comment that does NOT echo the developer's file
    content (FORA-77 hard isolation rule)

The smoke produces:

  - agents/iac_scanner/evidence/smoke_<UTC>/result.json — machine-readable result
  - agents/iac_scanner/evidence/smoke_<UTC>/handoff.json — the BLOCK handoff
  - agents/iac_scanner/evidence/smoke_<UTC>/pr_comment.md — the rendered comment
  - agents/iac_scanner/evidence/smoke_<UTC>/pass-handoff.json — the pass handoff (iac_not_present)
  - agents/iac_scanner/evidence/smoke_<UTC>/pass-comment.md — the pass comment

Run: `python -m agents.iac_scanner.smoke_test` from the repo root.
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

from agents.iac_scanner import (
    ALLOWED_TOOLS,
    Decision,
    FileRef,
    FileType,
    HandoffInput,
    HandoffOutput,
    IacFinding,
    IacScanner,
    IacScannerInputs,
    IacSeverity,
    IsolationError,
    PRComment,
    SCHEMA_VERSION,
    ScannerKind,
    SecurityAuditRecorder,
    ToolAllowList,
    Verdict,
    assert_comment_has_no_secret,
    assert_tool_allowed,
    classify_iac_file,
    comment_for_block,
    comment_for_pass,
    default_writers,
    derive_handoff_id,
    is_iac_filename,
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
    pr_number: int = 77,
    run_id: str = "run-77-smoke",
    tenant_id: str = "acme-corp",
    story_id: str = "story-FORA-77",
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


def _mock_checkov_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    def runner(path: str, *, timeout_s=60.0, file_type: FileType = FileType.TERRAFORM):
        return 1, fixture_json, ""
    return runner


def _empty_checkov_runner() -> Callable[..., Tuple[int, str, str]]:
    def runner(path: str, *, timeout_s=60.0, file_type: FileType = FileType.TERRAFORM):
        return 0, "[]", ""
    return runner


def _mock_kube_score_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    def runner(manifest_path: str, *, timeout_s=60.0):
        return 0, fixture_json, ""
    return runner


def _mock_docker_bench_runner(fixture_json: str) -> Callable[..., Tuple[int, str, str]]:
    def runner(dockerfile_path: str, *, timeout_s=60.0):
        return 0, fixture_json, ""
    return runner


# ---------------------------------------------------------------------------
# Test fixtures loaded once
# ---------------------------------------------------------------------------


BLOCK_TF_DIFF = _read_fixture("block-tf.diff")
BLOCK_TF_CHECKOV = _read_fixture("block-tf.checkov.json")
PASS_K8S_DIFF = _read_fixture("pass-k8s.diff")
PASS_K8S_KUBE_SCORE = _read_fixture("pass-k8s.kube-score.json")
APP_ONLY_DIFF = _read_fixture("app-only.diff")
CFN_BLOCK_DIFF = _read_fixture("cloudformation-block.diff")
CFN_BLOCK_CHECKOV = _read_fixture("cloudformation-block.checkov.json")
DOCKERFILE_BLOCK_DIFF = _read_fixture("dockerfile-block.diff")
DOCKERFILE_BLOCK_DOCKER_BENCH = _read_fixture("dockerfile-block.docker-bench.json")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    checks: List[Tuple[bool, str]] = []
    evidence = _evidence_dir()

    # Set the agent identity env vars so process-identity assertion
    # runs (production sets them; smoke sets them explicitly).
    os.environ.setdefault("FORA_AGENT_ID", "iac-scanner")
    os.environ.setdefault("FORA_RUN_ID", "run-77-smoke")
    os.environ.setdefault("FORA_TENANT_ID", "acme-corp")
    os.environ.setdefault("FORA_AGENT_ROLE", "appsec")

    allow_list = ToolAllowList()
    recorder = SecurityAuditRecorder(
        run_id="run-77-smoke",
        tenant_id="acme-corp",
        agent_id="iac-scanner",
        allow_list=allow_list,
    )
    scanner = IacScanner(allow_list=allow_list, check_process_identity=True)

    # =====================================================================
    # AC #1 — Terraform open S3 + no encryption → block with HIGH finding
    # =====================================================================
    block_diff_path = str(_fixture("block-tf.diff"))
    handoff_block = _make_handoff(
        pr_diff_path=block_diff_path,
        pr_number=77,
    )
    block_out = scanner.scan(IacScannerInputs(
        handoff=handoff_block,
        checkov_runner=_mock_checkov_runner(BLOCK_TF_CHECKOV),
        audit=recorder,
    ))
    h = block_out.handoff_output

    checks.append(_check(
        h.decision == Verdict.BLOCK,
        f"[AC#1.a] decision == 'block' on Terraform open-S3 PR — got {h.decision.value!r}",
    ))
    # At least one HIGH finding with a concrete remediation.
    high_findings = [f for f in h.findings if f.severity == IacSeverity.HIGH]
    checks.append(_check(
        len(high_findings) >= 1,
        f"[AC#1.b] at least one HIGH finding — got {len(high_findings)}",
    ))
    checks.append(_check(
        all(f.remediation for f in high_findings),
        f"[AC#1.c] every HIGH finding has a remediation — got "
        f"{[bool(f.remediation) for f in high_findings]!r}",
    ))
    # Concrete remediation: enable encryption, block public access.
    remediation_text = " ".join(f.remediation for f in high_findings).lower()
    checks.append(_check(
        "encryption" in remediation_text or "public access" in remediation_text
        or "acl" in remediation_text,
        f"[AC#1.d] HIGH finding remediation mentions encryption / public-access / acl — "
        f"got {remediation_text[:200]!r}",
    ))
    # Rule id is set.
    checks.append(_check(
        any(f.rule_id.startswith("CKV_") for f in high_findings),
        f"[AC#1.e] HIGH finding has a CKV_* rule id — got "
        f"{[f.rule_id for f in high_findings]!r}",
    ))
    # File path and line pointer present.
    checks.append(_check(
        all(f.file.path and f.file.line > 0 for f in high_findings),
        f"[AC#1.f] HIGH findings have file path + line — got "
        f"{[(f.file.path, f.file.line) for f in high_findings]!r}",
    ))
    # checkov ran (one entry per IaC file in the diff — main.tf
    # and variables.tf). The set of scanner kinds is {"checkov"};
    # we don't require an exact length because more files in the
    # diff means more checkov invocations.
    checks.append(_check(
        set(h.scanners_used) == {"checkov"},
        f"[AC#1.g] only checkov ran on Terraform diff — got {h.scanners_used!r}",
    ))
    # file_types_scanned is the routing decision.
    checks.append(_check(
        h.file_types_scanned == ["terraform"],
        f"[AC#1.h] file_types_scanned == ['terraform'] — got {h.file_types_scanned!r}",
    ))
    # iac_files lists the files the scanner routed to (main.tf +
    # variables.tf per the fixture). The OPEN-S3 file is the
    # canonical AC #1 file.
    checks.append(_check(
        "infra/main.tf" in h.iac_files,
        f"[AC#1.i] iac_files includes 'infra/main.tf' — got {h.iac_files!r}",
    ))
    checks.append(_check(
        all(f.file.path == "infra/main.tf" for f in high_findings),
        f"[AC#1.i2] every HIGH finding is anchored to infra/main.tf — got "
        f"{[f.file.path for f in high_findings]!r}",
    ))
    # PR comment was posted.
    checks.append(_check(
        h.pr_comment_posted is True,
        f"[AC#1.j] PR comment posted on BLOCK — got {h.pr_comment_posted!r}",
    ))
    # Evidence row was written.
    checks.append(_check(
        h.evidence_audit_id.startswith("evidence-"),
        f"[AC#1.k] evidence_audit_id is set — got {h.evidence_audit_id!r}",
    ))
    # iac_not_present is False (the scanner did run).
    checks.append(_check(
        h.iac_not_present is False,
        f"[AC#1.l] iac_not_present == False on a real IaC PR — got {h.iac_not_present!r}",
    ))

    # =====================================================================
    # AC #2 — K8s add readOnlyRootFilesystem → pass
    # =====================================================================
    pass_diff_path = str(_fixture("pass-k8s.diff"))
    handoff_pass = _make_handoff(
        pr_diff_path=pass_diff_path,
        pr_number=78,
        run_id="run-77-smoke-pass",
    )
    pass_out = scanner.scan(IacScannerInputs(
        handoff=handoff_pass,
        kube_score_runner=_mock_kube_score_runner(PASS_K8S_KUBE_SCORE),
        audit=recorder,
    ))
    hp = pass_out.handoff_output

    checks.append(_check(
        hp.decision == Verdict.PASS,
        f"[AC#2.a] decision == 'pass' on K8s readOnlyRootFilesystem PR — got {hp.decision.value!r}",
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
    checks.append(_check(
        hp.file_types_scanned == ["kubernetes"],
        f"[AC#2.f] file_types_scanned == ['kubernetes'] — got {hp.file_types_scanned!r}",
    ))
    checks.append(_check(
        hp.iac_files == ["k8s/deployment.yaml"],
        f"[AC#2.g] iac_files == ['k8s/deployment.yaml'] — got {hp.iac_files!r}",
    ))
    # kube-score ran (only scanner for the K8s route).
    checks.append(_check(
        hp.scanners_used == ["kube-score"],
        f"[AC#2.h] only kube-score ran on K8s diff — got {hp.scanners_used!r}",
    ))
    # iac_not_present is False.
    checks.append(_check(
        hp.iac_not_present is False,
        f"[AC#2.i] iac_not_present == False on a K8s PR — got {hp.iac_not_present!r}",
    ))

    # =====================================================================
    # AC #3 — No IaC files → pass + iacNotPresent evidence flag
    # =====================================================================
    app_diff_path = str(_fixture("app-only.diff"))
    handoff_short = _make_handoff(
        pr_diff_path=app_diff_path,
        pr_number=79,
        run_id="run-77-smoke-short",
    )
    short_out = scanner.scan(IacScannerInputs(
        handoff=handoff_short,
        # No runner injected — must NOT be called.
        checkov_runner=None,
        kube_score_runner=None,
        docker_bench_runner=None,
        audit=recorder,
    ))
    hs = short_out.handoff_output

    checks.append(_check(
        hs.decision == Verdict.PASS,
        f"[AC#3.a] decision == 'pass' on app-only PR — got {hs.decision.value!r}",
    ))
    checks.append(_check(
        hs.iac_not_present is True,
        f"[AC#3.b] iac_not_present == True on app-only PR — got {hs.iac_not_present!r}",
    ))
    checks.append(_check(
        hs.iac_files == [],
        f"[AC#3.c] iac_files is empty — got {hs.iac_files!r}",
    ))
    checks.append(_check(
        hs.file_types_scanned == [],
        f"[AC#3.d] file_types_scanned is empty — got {hs.file_types_scanned!r}",
    ))
    checks.append(_check(
        hs.scanners_used == [],
        f"[AC#3.e] scanners_used is empty (no scanner ran) — got {hs.scanners_used!r}",
    ))
    checks.append(_check(
        not hs.findings,
        f"[AC#3.f] findings is empty — got {len(hs.findings)} finding(s)",
    ))
    # The pass comment for the short-circuit explicitly surfaces the
    # iac_not_present evidence flag.
    pass_comment = comment_for_pass(hs)
    checks.append(_check(
        "iac_not_present" in pass_comment.body.lower() or "no iac" in pass_comment.body.lower(),
        f"[AC#3.g] pass comment surfaces iac_not_present evidence — got "
        f"{pass_comment.body[:200]!r}",
    ))
    checks.append(_check(
        pass_comment.finding_count == 0,
        f"[AC#3.h] pass comment finding_count == 0 — got {pass_comment.finding_count}",
    ))

    # =====================================================================
    # AC #4 — verdict object conforms to v1.0.0 schema
    # =====================================================================
    checks.append(_check(
        h.schema_version == SCHEMA_VERSION,
        f"[AC#4.a] schema_version == '1.0.0' — got {h.schema_version!r}",
    ))
    block_errors = validate_handoff_output(h)
    checks.append(_check(
        not block_errors,
        f"[AC#4.b] validate_handoff_output(block) is clean — got {block_errors!r}",
    ))
    pass_errors = validate_handoff_output(hp)
    checks.append(_check(
        not pass_errors,
        f"[AC#4.c] validate_handoff_output(pass) is clean — got {pass_errors!r}",
    ))
    short_errors = validate_handoff_output(hs)
    checks.append(_check(
        not short_errors,
        f"[AC#4.d] validate_handoff_output(short-circuit) is clean — got {short_errors!r}",
    ))
    # Build a malformed handoff: HIGH severity but decision=PASS
    # (violates FORA-77 hard rule) and assert validation catches it.
    malformed = HandoffOutput(
        schema_version="0.0.0",
        handoff_id="x",
        run_id="r",
        tenant_id="t",
        scanner_run_id="run-y",
        decision=Verdict.PASS,
        verdict=Verdict.PASS,
        findings=[IacFinding(
            finding_id="f1",
            severity=IacSeverity.HIGH,
            file=FileRef(path="main.tf", line=3, file_type=FileType.TERRAFORM),
            rule_id="CKV_AWS_19",
        )],
    )
    malformed_errors = validate_handoff_output(malformed)
    checks.append(_check(
        any("'pass'" in e and "findings" in e for e in malformed_errors),
        f"[AC#4.e] validator catches decision=PASS with findings — got {malformed_errors!r}",
    ))
    # HIGH finding with decision=PASS must trigger the FORA-77 hard rule.
    checks.append(_check(
        any("hard rule" in e for e in malformed_errors),
        f"[AC#4.f] validator catches HIGH/PASS FORA-77 violation — got {malformed_errors!r}",
    ))
    # iac_not_present=True with decision=BLOCK must trigger the short-circuit invariant.
    bad_short = HandoffOutput(
        schema_version=SCHEMA_VERSION, handoff_id="x", run_id="r", tenant_id="t",
        scanner_run_id="run-z", decision=Verdict.BLOCK, verdict=Verdict.BLOCK,
        iac_not_present=True,
    )
    bad_short_errors = validate_handoff_output(bad_short)
    checks.append(_check(
        any("iac_not_present" in e for e in bad_short_errors),
        f"[AC#4.g] validator catches iac_not_present=True with decision=BLOCK — "
        f"got {bad_short_errors!r}",
    ))
    # iac_not_present=True with non-empty scanners_used must trigger.
    bad_short2 = HandoffOutput(
        schema_version=SCHEMA_VERSION, handoff_id="x", run_id="r", tenant_id="t",
        scanner_run_id="run-z", decision=Verdict.PASS, verdict=Verdict.PASS,
        iac_not_present=True, scanners_used=["checkov"],
    )
    bad_short2_errors = validate_handoff_output(bad_short2)
    checks.append(_check(
        any("iac_not_present" in e for e in bad_short2_errors),
        f"[AC#4.h] validator catches iac_not_present=True with scanners_used — "
        f"got {bad_short2_errors!r}",
    ))

    # =====================================================================
    # AC #5 — audit log replay proves no Developer context access
    # =====================================================================
    audit_records = recorder.records
    checks.append(_check(
        len(audit_records) >= 4,
        f"[AC#5.a] audit recorder has >= 4 rows — got {len(audit_records)}",
    ))
    # Every recorded tool is on the 4-tool allow-list.
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
    # Tools in the audit log are a subset of the 4 allow-listed tools.
    seen_tools = sorted({r.tool for r in audit_records})
    checks.append(_check(
        set(seen_tools).issubset(set(ALLOWED_TOOLS)),
        f"[AC#5.d] all tools used are in ALLOWED_TOOLS — got {seen_tools!r}",
    ))
    # Audit covers all 4 stages.
    expected_stages = {
        "read_pr_diff", "write_scan_evidence",
        "write_handoff_artifact", "write_pr_comment",
    }
    checks.append(_check(
        expected_stages.issubset({r.tool for r in audit_records}),
        f"[AC#5.e] audit covers all 4 stages — got {sorted({r.tool for r in audit_records})}",
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
    # PR comment must NOT include the file content as a long string.
    # We pick a fixture marker that's specific to the developer's file.
    needle = "open-bucket"  # fixture-only marker
    checks.append(_check(
        needle not in block_comment.body,
        f"[comment.c] PR comment does NOT echo Terraform body marker {needle!r}",
    ))
    # PR comment must include the file path so the reviewer can act.
    checks.append(_check(
        "infra/main.tf" in block_comment.body,
        f"[comment.d] PR comment includes the file path 'infra/main.tf'",
    ))
    # PR comment must include the rule id.
    checks.append(_check(
        "CKV_" in block_comment.body,
        f"[comment.e] PR comment includes a CKV_* rule id",
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
    block_out_2 = scanner.scan(IacScannerInputs(
        handoff=handoff_block,
        checkov_runner=_mock_checkov_runner(BLOCK_TF_CHECKOV),
        audit=recorder,
    ))
    checks.append(_check(
        block_out_2.handoff_output.decision == h.decision
        and block_out_2.handoff_output.finding_count == h.finding_count,
        "[extra.b] second scan produces same decision + finding_count",
    ))
    # Writers are populated.
    writers = default_writers()
    # Severity counts match the actual finding distribution.
    actual_counts: Dict[str, int] = {}
    for f in h.findings:
        actual_counts[f.severity.value] = actual_counts.get(f.severity.value, 0) + 1
    checks.append(_check(
        h.severity_counts == actual_counts,
        f"[extra.c] severity_counts matches finding distribution — got "
        f"{h.severity_counts!r} vs {actual_counts!r}",
    ))

    # =====================================================================
    # Routing coverage — CloudFormation + Dockerfile scanners also work
    # =====================================================================
    # CloudFormation block.
    cfn_diff_path = str(_fixture("cloudformation-block.diff"))
    handoff_cfn = _make_handoff(
        pr_diff_path=cfn_diff_path,
        pr_number=80,
        run_id="run-77-smoke-cfn",
    )
    cfn_out = scanner.scan(IacScannerInputs(
        handoff=handoff_cfn,
        checkov_runner=_mock_checkov_runner(CFN_BLOCK_CHECKOV),
        audit=recorder,
    ))
    hc = cfn_out.handoff_output
    checks.append(_check(
        hc.decision == Verdict.BLOCK,
        f"[routing.a] CloudFormation open-S3 → block — got {hc.decision.value!r}",
    ))
    checks.append(_check(
        hc.file_types_scanned == ["cloudformation"],
        f"[routing.b] CloudFormation file_types_scanned — got {hc.file_types_scanned!r}",
    ))
    checks.append(_check(
        any(f.rule_id.startswith("CKV_") for f in hc.findings),
        f"[routing.c] CloudFormation finding has a CKV_* rule id — got "
        f"{[f.rule_id for f in hc.findings]!r}",
    ))

    # Dockerfile block.
    dockerfile_diff_path = str(_fixture("dockerfile-block.diff"))
    handoff_docker = _make_handoff(
        pr_diff_path=dockerfile_diff_path,
        pr_number=81,
        run_id="run-77-smoke-docker",
    )
    docker_out = scanner.scan(IacScannerInputs(
        handoff=handoff_docker,
        docker_bench_runner=_mock_docker_bench_runner(DOCKERFILE_BLOCK_DOCKER_BENCH),
        audit=recorder,
    ))
    hd = docker_out.handoff_output
    checks.append(_check(
        hd.decision == Verdict.BLOCK,
        f"[routing.d] Dockerfile USER root → block — got {hd.decision.value!r}",
    ))
    checks.append(_check(
        hd.file_types_scanned == ["dockerfile"],
        f"[routing.e] Dockerfile file_types_scanned — got {hd.file_types_scanned!r}",
    ))
    checks.append(_check(
        hd.scanners_used == ["docker-bench"],
        f"[routing.f] Dockerfile scanners_used — got {hd.scanners_used!r}",
    ))

    # =====================================================================
    # is_iac_filename / classify_iac_file sanity (FORA-77 hard rule)
    # =====================================================================
    checks.append(_check(
        is_iac_filename("main.tf") and is_iac_filename("k8s/dep.yaml")
        and is_iac_filename("Dockerfile") and is_iac_filename("cfn/stack.json"),
        "[ext.a] is_iac_filename matches all FORA-77 extensions",
    ))
    checks.append(_check(
        not is_iac_filename("README.md") and not is_iac_filename("foo.txt"),
        "[ext.b] is_iac_filename rejects non-IaC files",
    ))
    checks.append(_check(
        classify_iac_file("main.tf") == FileType.TERRAFORM,
        f"[ext.c] classify_iac_file(.tf) == TERRAFORM — got {classify_iac_file('main.tf')!r}",
    ))
    checks.append(_check(
        classify_iac_file(
            "k8s/dep.yaml",
            "apiVersion: v1\nkind: Pod\n"
        ) == FileType.KUBERNETES,
        "[ext.d] classify_iac_file(.yaml w/ apiVersion) == KUBERNETES",
    ))
    checks.append(_check(
        classify_iac_file("Dockerfile") == FileType.DOCKERFILE,
        f"[ext.e] classify_iac_file(Dockerfile) == DOCKERFILE",
    ))
    checks.append(_check(
        classify_iac_file(
            "cfn/stack.json",
            '{"AWSTemplateFormatVersion":"2010-09-09","Resources":{}}'
        ) == FileType.CLOUDFORMATION,
        "[ext.f] classify_iac_file(.json w/ AWSTemplateFormatVersion) == CLOUDFORMATION",
    ))

    # =====================================================================
    # Write evidence artefacts
    # =====================================================================
    (evidence / "handoff.json").write_text(
        json.dumps(h.to_dict(), indent=2), encoding="utf-8"
    )
    (evidence / "pass-handoff.json").write_text(
        json.dumps(hp.to_dict(), indent=2), encoding="utf-8"
    )
    (evidence / "short-handoff.json").write_text(
        json.dumps(hs.to_dict(), indent=2), encoding="utf-8"
    )
    (evidence / "pr_comment.md").write_text(block_comment.body, encoding="utf-8")
    (evidence / "pass-comment.md").write_text(pass_comment.body, encoding="utf-8")
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
    sys.stdout.write(f"# FORA-77 IaC Scanner smoke — {passed}/{total} checks\n")
    for ok, msg in checks:
        sys.stdout.write(f"  {'ok  ' if ok else 'FAIL'} {msg}\n")
    sys.stdout.write(f"\nEvidence written to: {evidence}\n")

    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
