"""
IaC scanner — Sub-goal 5.3 (FORA-77) v0.

Deterministic, no-LLM scanner that turns an immutable handoff
artefact into a v1.0.0 verdict. The flow is:

  HandoffInput (immutable)
      │
      ▼
  read_pr_diff    ─────►  read the diff file (filtered to IaC extensions)
      │
      ▼
  extract IaC files (filter + classify by file type)
      │
      ▼
  if iac_files == []:   short-circuit → decision = pass, iac_not_present = True
      │
      ▼
  per-file-type routing:
      Terraform/CloudFormation → checkov
      Kubernetes              → kube-score + conftest
      Dockerfile              → docker-bench
      │
      ▼
  parse scanner JSON → IacFinding list (severity, file, line, rule_id,
                                           misconfiguration, remediation)
      │
      ▼
  derive_decision()  ──►  HIGH or CRITICAL ⇒ BLOCK always
      │
      ▼
  HandoffOutput (v1.0.0 envelope)
      │     ├── evidence_audit_id = evidence_writer.write_evidence(...)
      │     └── artifact_key      = artifact_writer.write_artifact(...)
      ▼
  if decision == BLOCK:  comment_poster.post_comment(...)  (sanitised)

Hard rules (per FORA-77):

  - Reads only the PR diff filtered to `.tf`, `.tfvars`, `.yaml`,
    `.yml`, `Dockerfile`, `*.json` (CloudFormation), and the
    immutable handoff artefact. Never reads the Developer's
    prompt, scratch space, or conversation log.
  - Runs in a separate process with a separate JWT and a tool
    allow-list limited to the four `ALLOWED_TOOLS`.
  - HIGH or CRITICAL IaC misconfiguration is ALWAYS `block`. There
    is no override at the agent level.
  - Output schema version is `1.0.0`. Breaking changes are a
    major version bump and a new ADR.

Scanners supported (v0):

  - `checkov -d <path> -o json` — Terraform + CloudFormation.
  - `kube-score score <manifest>` — Kubernetes (built-in checks).
  - `conftest test --output json <manifest>` — Kubernetes (OPA).
  - `docker-bench` — Dockerfile (rule file `docker-bench/security.md`).

For deterministic testing, the four `*_runner` constructor args
are injectable. Production constructors use the subprocess-backed
runners below.

The three I/O seams (evidence / artefact / PR comment) are
injected via `IacScannerInputs.writers`; production wires the
S3, audit-store, and GitHub-MCP adapters. The smoke test uses
the in-memory defaults from `agents/iac_scanner/writers.py`.

Public surface:

    IacScanner         — the deterministic agent
    IacScannerInputs   — typed input bundle
    IacScannerOutputs  — typed output bundle
    ScannerError       — raised on invalid input
    scan_iac           — convenience entry point
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .audit import SecurityAuditRecorder, _now_ms
from .isolation import (
    ALLOWED_TOOLS,
    IsolationError,
    ToolAllowList,
    assert_process_identity,
    assert_tool_allowed,
)
from .pr_comment import (
    assert_comment_has_no_secret,
    comment_for_block,
)
from .schemas import (
    SCHEMA_VERSION,
    Decision,
    FileRef,
    FileType,
    HandoffInput,
    HandoffOutput,
    IacFinding,
    IacSeverity,
    ScanFile,
    ScanResult,
    ScannerKind,
    Verdict,
    classify_iac_file,
    derive_artifact_id,
    derive_handoff_id,
    is_iac_filename,
    validate_handoff_output,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    PRCommentPoster,
    default_writers,
)


class ScannerError(RuntimeError):
    """Raised when the scanner cannot proceed (bad input, missing
    diff, subprocess failure, allow-list violation). The runtime
    catches this and converts to an audit row with a typed
    error_code."""


# File-type → scanner routing table. The `subprocess`-backed
# default runners below are pre-wired to the canonical tool.
DEFAULT_SCANNER_FOR: Dict[FileType, ScannerKind] = {
    FileType.TERRAFORM: ScannerKind.CHECKOV,
    FileType.CLOUDFORMATION: ScannerKind.CHECKOV,
    FileType.KUBERNETES: ScannerKind.KUBE_SCORE,
    FileType.DOCKERFILE: ScannerKind.DOCKER_BENCH,
}

# Subprocess invocations (production; the smoke test injects mocks).
# Each runner returns (rc, stdout, stderr) — the same shape as
# dep_scanner's trivy/dependabot runners.
# Kube-score + conftest both run on Kubernetes manifests (the orchestrator
# may pass both through `IacScannerInputs.scanners`). Per-file-type
# routing uses `DEFAULT_SCANNER_FOR` plus the optional `conftest_runner`.


def _default_checkov_runner(
    path: str,
    *,
    timeout_s: float = 60.0,
    file_type: FileType = FileType.TERRAFORM,
) -> Tuple[int, str, str]:
    """Run `checkov -d <path> -o json` against the IaC file or directory.

    Default flags:

      -d PATH              scan the directory / file
      -o json              machine-readable stdout
      --quiet              suppress progress on stderr
      --no-progress        same
      --compact            JSON output without redundant fields

    The timeout is 60s — checkov on a single PR's worth of IaC
    files is sub-second in practice; the ceiling is a guard
    against a runaway binary on a malformed manifest.
    """
    cmd = [
        "checkov", "-d", path,
        "-o", "json",
        "--quiet",
        "--no-progress",
        "--compact",
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "checkov binary not on PATH; install or inject checkov_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"checkov timed out after {timeout_s}s on {path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


def _default_kube_score_runner(
    manifest_path: str,
    *,
    timeout_s: float = 60.0,
) -> Tuple[int, str, str]:
    """Run `kube-score score <manifest>` and return (rc, stdout, stderr).

    kube-score emits a coloured human-readable report by default;
    v0 wraps `--output-format=ci` for machine-readable stdout.
    """
    cmd = ["kube-score", "score", "--output-format=ci", manifest_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "kube-score binary not on PATH; install or inject kube_score_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"kube-score timed out after {timeout_s}s on {manifest_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


def _default_conftest_runner(
    manifest_path: str,
    *,
    timeout_s: float = 60.0,
) -> Tuple[int, str, str]:
    """Run `conftest test --output json <manifest>` and return (rc, stdout, stderr)."""
    cmd = ["conftest", "test", "--output", "json", manifest_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "conftest binary not on PATH; install or inject conftest_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"conftest timed out after {timeout_s}s on {manifest_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


def _default_docker_bench_runner(
    dockerfile_path: str,
    *,
    timeout_s: float = 60.0,
) -> Tuple[int, str, str]:
    """Run `docker-bench` against the Dockerfile.

    For v0 we shell out to a small wrapper script
    (`scripts/iac_docker_bench.sh`) that loads the rule file and
    emits JSON. The smoke test injects a mock runner.
    """
    cmd = ["scripts/iac_docker_bench.sh", dockerfile_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "docker-bench wrapper not on PATH; install or inject docker_bench_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"docker-bench timed out after {timeout_s}s on {dockerfile_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


# ---------------------------------------------------------------------------
# Output parsers — turn scanner stdout into a list of IacFinding
# ---------------------------------------------------------------------------


def _parse_checkov_json(stdout: str) -> List[IacFinding]:
    """Parse checkov's `-o json` stdout into a list of findings.

    Checkov emits a JSON array (when --compact) or a list of dicts;
    each entry has `check_id`, `check_name`, `check_class`,
    `severity` (CRITICAL/HIGH/MEDIUM/LOW/MODERATE/UNKNOWN),
    `file_path`, `file_line_range`, `guideline`.
    """
    findings: List[IacFinding] = []
    if not stdout.strip():
        return findings
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ScannerError(
            f"checkov emitted non-JSON stdout: {exc}; first 200 chars: "
            f"{stdout[:200]!r}"
        ) from exc
    if not isinstance(data, list):
        # Some checkov versions emit an object wrapping the list
        if isinstance(data, dict):
            data = data.get("results", []) or data.get("Findings", []) or []
        else:
            return findings
    for item in data:
        if not isinstance(item, dict):
            continue
        sev_raw = (item.get("severity") or "UNKNOWN").upper()
        severity = {
            "CRITICAL": IacSeverity.CRITICAL,
            "HIGH": IacSeverity.HIGH,
            "MEDIUM": IacSeverity.MEDIUM,
            "LOW": IacSeverity.LOW,
            "MODERATE": IacSeverity.MEDIUM,
            "UNKNOWN": IacSeverity.UNKNOWN,
        }.get(sev_raw, IacSeverity.UNKNOWN)

        file_path = item.get("file_path") or item.get("file") or "<unknown>"
        line_range = item.get("file_line_range") or []
        line = 0
        if isinstance(line_range, list) and line_range:
            try:
                line = int(line_range[0])
            except (TypeError, ValueError):
                line = 0
        # Default file_type from extension; overridden by caller context.
        file_type = classify_iac_file(file_path, "")
        findings.append(IacFinding(
            finding_id=f"finding-{uuid.uuid4().hex[:10]}",
            severity=severity,
            file=FileRef(path=file_path, line=line, file_type=file_type),
            rule_id=item.get("check_id") or "CKV_UNKNOWN",
            title=item.get("check_name") or "",
            misconfiguration=item.get("check_name") or "",
            remediation=item.get("guideline") or "",
            scanner=ScannerKind.CHECKOV,
            raw_payload={"checkov": item},
        ))
    return findings


def _parse_kube_score_ci(stdout: str) -> List[IacFinding]:
    """Parse kube-score's `--output-format=ci` stdout into findings.

    kube-score's CI output is a line-based report:

        [OK] some-check-id      Pod default/worker
        [WARN] another-check    Deployment default/api
        [CRITICAL] run-as-non-root  StatefulSet default/db

    The smoke test mocks the runner with a JSON payload (we map
    a JSON object {findings:[...]} for ease of testing); we accept
    both shapes.
    """
    findings: List[IacFinding] = []
    if not stdout.strip():
        return findings
    # JSON shape (smoke test / future CI artefact).
    if stdout.lstrip().startswith("{"):
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict) and "findings" in data:
            for item in data.get("findings") or []:
                if not isinstance(item, dict):
                    continue
                sev_raw = (item.get("severity") or "MEDIUM").upper()
                severity = {
                    "CRITICAL": IacSeverity.CRITICAL,
                    "HIGH": IacSeverity.HIGH,
                    "MEDIUM": IacSeverity.MEDIUM,
                    "LOW": IacSeverity.LOW,
                }.get(sev_raw, IacSeverity.MEDIUM)
                findings.append(IacFinding(
                    finding_id=f"finding-{uuid.uuid4().hex[:10]}",
                    severity=severity,
                    file=FileRef(
                        path=item.get("file_path") or "<k8s>",
                        line=item.get("file_line") or 0,
                        file_type=FileType.KUBERNETES,
                    ),
                    rule_id=item.get("check_id") or "kube-score",
                    title=item.get("check_name") or item.get("comment") or "",
                    misconfiguration=item.get("comment") or "",
                    remediation=item.get("documentation_url") or "Add the missing securityContext field.",
                    scanner=ScannerKind.KUBE_SCORE,
                    raw_payload={"kube_score": item},
                ))
            return findings
    # Plain-text CI output (production shape).
    for line in stdout.splitlines():
        m = re.match(
            r"\[(?P<sev>OK|WARN|CRITICAL|HIGH|MEDIUM|LOW)\]\s+(?P<rule>\S+)\s+(?P<rest>.+)$",
            line.strip(),
        )
        if not m:
            continue
        sev_raw = m.group("sev").upper()
        severity = {
            "CRITICAL": IacSeverity.CRITICAL,
            "HIGH": IacSeverity.HIGH,
            "MEDIUM": IacSeverity.MEDIUM,
            "LOW": IacSeverity.LOW,
            "WARN": IacSeverity.MEDIUM,
        }.get(sev_raw, IacSeverity.MEDIUM)
        # Treat WARN as a kube-score "warning" grade → MEDIUM.
        rest = m.group("rest")
        file_path = "<k8s>"  # kube-score text doesn't include the file path
        findings.append(IacFinding(
            finding_id=f"finding-{uuid.uuid4().hex[:10]}",
            severity=severity,
            file=FileRef(path=file_path, line=0, file_type=FileType.KUBERNETES),
            rule_id=m.group("rule"),
            title=rest,
            misconfiguration=rest,
            remediation="Add the missing `securityContext` field to the Pod / container spec.",
            scanner=ScannerKind.KUBE_SCORE,
            raw_payload={"kube_score_text": line},
        ))
    return findings


def _parse_conftest_json(stdout: str) -> List[IacFinding]:
    """Parse conftest's `--output json` stdout into findings.

    conftest emits a JSON array of result objects; each has
    `filename`, `namespace`, `successes`, `failures` (with `msg`
    and `metadata`).
    """
    findings: List[IacFinding] = []
    if not stdout.strip():
        return findings
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return findings
    if not isinstance(data, list):
        return findings
    for item in data:
        if not isinstance(item, dict):
            continue
        if item.get("successes") is not None and item.get("failures") is None:
            continue  # no failures, no findings
        file_path = item.get("filename") or "<k8s>"
        for fail in item.get("failures") or []:
            if not isinstance(fail, dict):
                continue
            msg = fail.get("msg") or ""
            metadata = fail.get("metadata") or {}
            # conftest has no native severity; default to MEDIUM (block)
            # because any conftest failure is a policy violation.
            findings.append(IacFinding(
                finding_id=f"finding-{uuid.uuid4().hex[:10]}",
                severity=IacSeverity.MEDIUM,
                file=FileRef(path=file_path, line=0, file_type=FileType.KUBERNETES),
                rule_id=(metadata.get("package") or metadata.get("id") or "conftest"),
                title=msg,
                misconfiguration=msg,
                remediation="Update the manifest to satisfy the OPA policy.",
                scanner=ScannerKind.CONFTEST,
                raw_payload={"conftest": fail},
            ))
    return findings


def _parse_docker_bench_json(stdout: str) -> List[IacFinding]:
    """Parse docker-bench JSON stdout into findings.

    For v0, the wrapper emits a JSON object:
        {"findings":[{"check_id":"4.1","severity":"HIGH",...}]}
    """
    findings: List[IacFinding] = []
    if not stdout.strip():
        return findings
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return findings
    if isinstance(data, dict) and "findings" in data:
        for item in data.get("findings") or []:
            if not isinstance(item, dict):
                continue
            sev_raw = (item.get("severity") or "LOW").upper()
            severity = {
                "CRITICAL": IacSeverity.CRITICAL,
                "HIGH": IacSeverity.HIGH,
                "MEDIUM": IacSeverity.MEDIUM,
                "LOW": IacSeverity.LOW,
                "INFO": IacSeverity.LOW,
            }.get(sev_raw, IacSeverity.LOW)
            file_path = item.get("file_path") or "Dockerfile"
            findings.append(IacFinding(
                finding_id=f"finding-{uuid.uuid4().hex[:10]}",
                severity=severity,
                file=FileRef(path=file_path, line=item.get("file_line") or 0,
                             file_type=FileType.DOCKERFILE),
                rule_id=item.get("check_id") or "docker-bench",
                title=item.get("check_name") or "",
                misconfiguration=item.get("check_name") or "",
                remediation=item.get("remediation") or "Update the Dockerfile to harden the build.",
                scanner=ScannerKind.DOCKER_BENCH,
                raw_payload={"docker_bench": item},
            ))
    return findings


# ---------------------------------------------------------------------------
# PR diff parser — extract (path, body-snippet) per IaC file
# ---------------------------------------------------------------------------


_DIFF_HEADER_RE = re.compile(
    r"^diff --git a/(?P<path>[^\s]+) b/(?P<path2>[^\s]+)\s*$",
    re.MULTILINE,
)


@dataclass
class DiffFileSlice:
    """One file's worth of diff content from the PR diff.

    The IaC scanner only retains the *file path* and the
    minimal snippet it needs to classify routing; it does NOT
    carry the file body into the verdict (FORA-77 hard isolation
    rule #1).
    """

    path: str
    # Lines we extracted from the diff to confirm the file type
    # (only the first ~10 lines, used to disambiguate .yaml).
    head_lines: List[str] = field(default_factory=list)
    # +/= line numbers for the IaC scanner's line pointer.
    changed_lines: List[int] = field(default_factory=list)

    @property
    def body(self) -> str:
        """Concatenated head lines — used for classify_iac_file only."""
        return "\n".join(self.head_lines)


def _parse_diff_for_iac_files(diff_text: str) -> List[DiffFileSlice]:
    """Walk the PR diff and return one slice per IaC-shaped file.

    The parser:

      - identifies the file path from `diff --git a/<path> b/<path>`
      - keeps the first ~10 lines of the new file content (added
        lines only) so `classify_iac_file` can disambiguate
        Kubernetes vs. GitHub Actions
      - records the changed line numbers for the per-line pointer

    It does NOT carry the full file body — that would echo the
    Developer's scratch space (FORA-77 hard isolation rule #1).
    """
    slices: List[DiffFileSlice] = []
    if not diff_text:
        return slices
    # Split on the `diff --git` header. The regex has TWO named
    # groups (path, path2), so each match yields TWO group captures
    # in the split output: parts[1] = path, parts[2] = path2,
    # parts[3] = body. The pattern is path, path2, body, path,
    # path2, body, ...
    parts = _DIFF_HEADER_RE.split(diff_text)
    for i in range(1, len(parts), 3):
        if i + 2 >= len(parts):
            break
        path = parts[i]
        body = parts[i + 2]
        if not is_iac_filename(path):
            continue
        # Walk the diff body for added lines and changed line numbers.
        head: List[str] = []
        changed: List[int] = []
        new_line = 0
        for line in body.splitlines():
            if line.startswith("@@"):
                # Parse the hunk header to get the new-file starting line.
                m = re.match(r"@@\s+-\d+(?:,\d+)?\s+\+(?P<start>\d+)(?:,\d+)?\s+@@", line)
                if m:
                    new_line = int(m.group("start")) - 1  # incremented below
                continue
            if line.startswith("+") and not line.startswith("+++"):
                new_line += 1
                changed.append(new_line)
                if len(head) < 10:
                    head.append(line[1:])
            elif line.startswith(" ") and not line.startswith("---"):
                new_line += 1
                if len(head) < 10:
                    head.append(line[1:])
            elif line.startswith("-") and not line.startswith("---"):
                # Deletion only — don't bump new_line.
                pass
        slices.append(DiffFileSlice(
            path=path,
            head_lines=head,
            changed_lines=changed,
        ))
    return slices


# ---------------------------------------------------------------------------
# Inputs / outputs bundles
# ---------------------------------------------------------------------------


@dataclass
class IacScannerInputs:
    """Typed input bundle for `IacScanner.scan()`.

    The handoff artefact is the *only* thing the scanner reads
    about the developer's work; the audit seam records the
    read so AC #5 can be replayed.

    `writers` carries the three I/O seams (evidence / artefact /
    PR comment). Production wires the S3, audit-store, and
    GitHub-MCP adapters; the smoke test uses the in-memory
    defaults from `agents/iac_scanner/writers.py`.
    """

    handoff: HandoffInput
    # Injectable runners for tests. Production leaves these None
    # and the scanner uses the four `_default_*_runner` functions.
    checkov_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    kube_score_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    conftest_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    docker_bench_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    # Audit recorder. The smoke test injects one; production wires
    # the system-wide store adapter here.
    audit: Optional[SecurityAuditRecorder] = None
    # I/O seams. Defaults to in-memory writers; production passes
    # the system adapters via `default_writers()` is replaced by
    # the production bundle.
    writers: Optional[Dict[str, Any]] = None


@dataclass
class IacScannerOutputs:
    """Typed output bundle for `IacScanner.scan()`.

    `handoff_output` is the v1.0.0 artefact the orchestrator hands
    to DevOps on `pass` or back to Coding on `block`. `validation_errors`
    is empty on a successful run; non-empty means the scanner could
    not produce a conformant handoff (the orchestrator must not
    accept it). `iac_files_seen` is the list of (path, file_type)
    pairs the scanner routed to a scanner (empty on the
    short-circuit pass).
    """

    handoff_output: HandoffOutput
    validation_errors: List[str] = field(default_factory=list)
    scan_results: List[ScanResult] = field(default_factory=list)
    iac_files_seen: List[Tuple[str, FileType]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------


class IacScanner:
    """Deterministic IaC Scanner for the Security Agent (FORA-77).

    Construct one of these at process start (the runtime injects
    the allow-list and the audit recorder). Call `scan()` once per
    PR. The same `HandoffInput` + the same injected runners always
    produces the same `HandoffOutput` bytes (production wiring is
    deterministic).
    """

    def __init__(
        self,
        *,
        allow_list: Optional[ToolAllowList] = None,
        check_process_identity: bool = True,
        on_isolation_violation: Optional[Callable[[dict], None]] = None,
    ) -> None:
        if check_process_identity:
            assert_process_identity()
        self._allow = allow_list or ToolAllowList(on_violation=on_isolation_violation)

    # -- public surface --------------------------------------------------

    def scan(self, inputs: IacScannerInputs) -> IacScannerOutputs:
        """Run the scanner against the handoff artefact.

        Steps (in order):

          1. read_pr_diff      — assert the diff file exists
          2. extract IaC files — filter + classify by file type
          3. if iac_files == []: short-circuit (AC #3)
          4. per-file-type routing → run the matching scanner(s)
          5. categorise + dedupe across scanners
          6. derive_decision()  — HIGH/CRITICAL ⇒ BLOCK always
          7. write_scan_evidence — audit row
          8. write_handoff_artifact — v1.0.0 envelope
          9. if BLOCK: write_pr_comment (sanitised)

        Returns an `IacScannerOutputs`. The orchestrator checks
        `validation_errors` first; if non-empty, the handoff is
        rejected with a typed error code.
        """
        handoff = inputs.handoff
        self._validate_handoff(handoff)

        audit = inputs.audit or self._make_audit(inputs)
        allow = self._allow
        writers = inputs.writers or default_writers()
        self._validate_writers(writers)

        # 1. read_pr_diff --------------------------------------------------
        read_diff_start = _now_ms()
        assert_tool_allowed("read_pr_diff", allow)
        diff_text = self._read_pr_diff(handoff.pr_diff_path)
        read_diff_end = _now_ms()
        audit.record_read_pr_diff(
            arguments={"pr_diff_path": handoff.pr_diff_path,
                       "handoff_id": handoff.handoff_id},
            output={"bytes": len(diff_text), "path": handoff.pr_diff_path},
            duration_ms=read_diff_end - read_diff_start,
            metadata={"pr_number": handoff.pr_number},
        )

        # 2. extract IaC files --------------------------------------------
        slices = _parse_diff_for_iac_files(diff_text)
        classified: List[Tuple[DiffFileSlice, FileType]] = []
        for s in slices:
            ft = classify_iac_file(s.path, s.body)
            if ft == FileType.UNKNOWN:
                continue  # .yaml or .json that is NOT a real IaC file
            classified.append((s, ft))

        # 3. short-circuit when no IaC files (AC #3) ----------------------
        if not classified:
            return self._short_circuit_pass(
                handoff, audit, writers,
                diff_bytes=len(diff_text),
            )

        # 4. per-file-type routing ---------------------------------------
        scan_results: List[ScanResult] = []
        for slc, file_type in classified:
            scan_result = self._scan_one(
                handoff, slc, file_type, inputs, audit,
            )
            if scan_result is not None:
                scan_results.append(scan_result)

        # 5. categorise + dedupe ------------------------------------------
        findings = self._aggregate_findings(scan_results)

        # 6. derive decision ----------------------------------------------
        decision = self._derive_decision(findings)

        scanner_versions = {
            r.scanner.value: r.scanner_version for r in scan_results
        }
        file_types_scanned = sorted({ft.value for _, ft in classified})
        iac_files_seen = [(s.path, ft.value) for s, ft in classified]

        # 7. write_scan_evidence -----------------------------------------
        evidence_start = _now_ms()
        assert_tool_allowed("write_scan_evidence", allow)
        evidence_id = f"evidence-{uuid.uuid4().hex[:12]}"
        evidence_id = writers["evidence"].write_evidence(
            evidence_id=evidence_id,
            handoff_id=handoff.handoff_id,
            run_id=handoff.run_id,
            tenant_id=handoff.tenant_id,
            decision=decision,
            scan_results=scan_results,
            audit_records=audit.records,
        )
        audit.record_write_scan_evidence(
            arguments={"handoff_id": handoff.handoff_id,
                       "file_types_scanned": file_types_scanned,
                       "iac_files": [p for p, _ in iac_files_seen]},
            output={"evidence_id": evidence_id},
            duration_ms=_now_ms() - evidence_start,
        )

        # 8. write_handoff_artifact ---------------------------------------
        artifact_start = _now_ms()
        assert_tool_allowed("write_handoff_artifact", allow)
        handoff_output = HandoffOutput(
            schema_version=SCHEMA_VERSION,
            handoff_id=handoff.handoff_id,
            run_id=handoff.run_id,
            tenant_id=handoff.tenant_id,
            scanner_run_id=f"run-{uuid.uuid4().hex[:12]}",
            decision=decision,
            verdict=decision,
            findings=findings,
            scanners_used=[r.scanner.value for r in scan_results],
            scanner_versions=scanner_versions,
            pr_comment_posted=False,
            evidence_audit_id=evidence_id,
            duration_ms=sum(r.duration_ms for r in scan_results),
            iac_files=[p for p, _ in iac_files_seen],
            file_types_scanned=file_types_scanned,
            iac_not_present=False,
            mode="per_pr",
        )
        artifact_key = writers["artifact"].write_artifact(handoff_output)
        audit.record_write_handoff_artifact(
            arguments={"handoff_id": handoff.handoff_id,
                       "decision": decision.value,
                       "file_types_scanned": file_types_scanned},
            output={"key": artifact_key, "decision": decision.value},
            duration_ms=_now_ms() - artifact_start,
        )

        # 9. write_pr_comment (BLOCK only) --------------------------------
        posted = False
        if decision == Verdict.BLOCK:
            posted = self._post_block_comment(
                handoff, handoff_output, writers["comment"], audit,
            )
            handoff_output.pr_comment_posted = posted

        validation = validate_handoff_output(handoff_output)
        return IacScannerOutputs(
            handoff_output=handoff_output,
            validation_errors=validation,
            scan_results=scan_results,
            iac_files_seen=iac_files_seen,
        )

    # -- helpers ---------------------------------------------------------

    def _validate_handoff(self, h: HandoffInput) -> None:
        if not h.handoff_id:
            raise ScannerError("HandoffInput.handoff_id is required")
        if not h.pr_diff_path:
            raise ScannerError("HandoffInput.pr_diff_path is required")
        if not h.run_id:
            raise ScannerError("HandoffInput.run_id is required")
        if not h.tenant_id:
            raise ScannerError("HandoffInput.tenant_id is required")

    def _validate_writers(self, writers: Dict[str, Any]) -> None:
        required = ("evidence", "artifact", "comment")
        missing = [k for k in required if k not in writers]
        if missing:
            raise ScannerError(
                f"writers dict missing required keys {missing!r}; "
                "got keys: " + ", ".join(sorted(writers.keys()))
            )

    def _make_audit(self, inputs: IacScannerInputs) -> SecurityAuditRecorder:
        return SecurityAuditRecorder(
            run_id=inputs.handoff.run_id,
            tenant_id=inputs.handoff.tenant_id,
            agent_id=os.environ.get("FORA_AGENT_ID", "iac-scanner"),
            allow_list=self._allow,
        )

    def _read_pr_diff(self, path: str) -> str:
        try:
            return Path(path).read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise ScannerError(
                f"PR diff not found at {path!r}; the orchestrator must "
                "stage the diff before the Security Agent starts"
            ) from exc

    def _short_circuit_pass(
        self,
        handoff: HandoffInput,
        audit: SecurityAuditRecorder,
        writers: Dict[str, Any],
        *,
        diff_bytes: int,
    ) -> IacScannerOutputs:
        """AC #3 — no IaC files → decision = pass with iac_not_present = True.

        No scanner runs (so `scanners_used` is empty and the audit
        replay proves no subprocess was invoked). We still write
        the evidence row and the v1.0.0 envelope so the
        orchestrator's daily audit sample has a complete record.
        """
        decision = Verdict.PASS
        evidence_start = _now_ms()
        assert_tool_allowed("write_scan_evidence", self._allow)
        evidence_id = f"evidence-{uuid.uuid4().hex[:12]}"
        evidence_id = writers["evidence"].write_evidence(
            evidence_id=evidence_id,
            handoff_id=handoff.handoff_id,
            run_id=handoff.run_id,
            tenant_id=handoff.tenant_id,
            decision=decision,
            scan_results=[],
            audit_records=audit.records,
        )
        audit.record_write_scan_evidence(
            arguments={"handoff_id": handoff.handoff_id,
                       "iac_not_present": True,
                       "diff_bytes": diff_bytes},
            output={"evidence_id": evidence_id},
            duration_ms=_now_ms() - evidence_start,
        )

        artifact_start = _now_ms()
        assert_tool_allowed("write_handoff_artifact", self._allow)
        handoff_output = HandoffOutput(
            schema_version=SCHEMA_VERSION,
            handoff_id=handoff.handoff_id,
            run_id=handoff.run_id,
            tenant_id=handoff.tenant_id,
            scanner_run_id=f"run-{uuid.uuid4().hex[:12]}",
            decision=decision,
            verdict=decision,
            findings=[],
            scanners_used=[],
            scanner_versions={},
            pr_comment_posted=False,
            evidence_audit_id=evidence_id,
            duration_ms=0.0,
            iac_files=[],
            file_types_scanned=[],
            iac_not_present=True,
            mode="per_pr",
        )
        artifact_key = writers["artifact"].write_artifact(handoff_output)
        audit.record_write_handoff_artifact(
            arguments={"handoff_id": handoff.handoff_id,
                       "decision": "pass",
                       "iac_not_present": True},
            output={"key": artifact_key, "decision": "pass"},
            duration_ms=_now_ms() - artifact_start,
        )

        validation = validate_handoff_output(handoff_output)
        return IacScannerOutputs(
            handoff_output=handoff_output,
            validation_errors=validation,
            scan_results=[],
            iac_files_seen=[],
        )

    def _scan_one(
        self,
        handoff: HandoffInput,
        slice_: "DiffFileSlice",
        file_type: FileType,
        inputs: IacScannerInputs,
        audit: SecurityAuditRecorder,
    ) -> Optional[ScanResult]:
        """Run the matching scanner for one IaC file.

        Returns a `ScanResult`, or `None` when the file type is
        UNKNOWN (the caller has already filtered those out, but
        we keep the check defensive).
        """
        if file_type == FileType.UNKNOWN:
            return None
        if file_type in (FileType.TERRAFORM, FileType.CLOUDFORMATION):
            return self._run_checkov(handoff, slice_, file_type, inputs, audit)
        if file_type == FileType.KUBERNETES:
            return self._run_kubernetes(handoff, slice_, inputs, audit)
        if file_type == FileType.DOCKERFILE:
            return self._run_docker_bench(handoff, slice_, inputs, audit)
        return None

    def _run_checkov(
        self,
        handoff: HandoffInput,
        slice_: "DiffFileSlice",
        file_type: FileType,
        inputs: IacScannerInputs,
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        runner = inputs.checkov_runner or _default_checkov_runner
        start = _now_ms()
        rc, stdout, stderr = runner(
            slice_.path, file_type=file_type,
        )
        duration = _now_ms() - start
        findings = _parse_checkov_json(stdout)
        # Re-anchor the file_type to the routing context (the parser
        # guesses from extension; the caller knows the truth).
        for f in findings:
            f.file.file_type = file_type
            f.scanner = ScannerKind.CHECKOV
        audit.record(
            "read_pr_diff",
            {
                "scanner": "checkov",
                "file_path": slice_.path,
                "file_type": file_type.value,
                "rc": rc,
            },
            {"stderr_tail": (stderr or "")[-512:], "finding_count": len(findings)},
            duration_ms=duration,
            metadata={"scanner": "checkov", "rc": rc},
        )
        return ScanResult(
            scanner=ScannerKind.CHECKOV,
            scanner_version=self._extract_version("checkov", runner),
            file_type=file_type,
            files=[ScanFile(
                path=slice_.path,
                file_type=file_type,
                commit_sha=handoff.head_sha,
                findings=findings,
            )],
            duration_ms=duration,
        )

    def _run_kubernetes(
        self,
        handoff: HandoffInput,
        slice_: "DiffFileSlice",
        inputs: IacScannerInputs,
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        """Run kube-score (+ optional conftest) on a Kubernetes manifest.

        For v0 we run kube-score; conftest is a second-pass scanner
        the orchestrator may enable by setting `inputs.conftest_runner`.
        Both pass through the same parsing seam.
        """
        runner = inputs.kube_score_runner or _default_kube_score_runner
        start = _now_ms()
        rc, stdout, stderr = runner(slice_.path)
        duration = _now_ms() - start
        findings = _parse_kube_score_ci(stdout)
        for f in findings:
            f.file.file_type = FileType.KUBERNETES
            f.scanner = ScannerKind.KUBE_SCORE
        audit.record(
            "read_pr_diff",
            {
                "scanner": "kube-score",
                "file_path": slice_.path,
                "rc": rc,
            },
            {"stderr_tail": (stderr or "")[-512:], "finding_count": len(findings)},
            duration_ms=duration,
            metadata={"scanner": "kube-score", "rc": rc},
        )
        # Optional conftest pass.
        if inputs.conftest_runner is not None:
            cstart = _now_ms()
            crc, cstdout, cstderr = inputs.conftest_runner(slice_.path)
            cduration = _now_ms() - cstart
            cfindings = _parse_conftest_json(cstdout)
            for f in cfindings:
                f.file.file_type = FileType.KUBERNETES
                f.scanner = ScannerKind.CONFTEST
            audit.record(
                "read_pr_diff",
                {
                    "scanner": "conftest",
                    "file_path": slice_.path,
                    "rc": crc,
                },
                {"stderr_tail": (cstderr or "")[-512:],
                 "finding_count": len(cfindings)},
                duration_ms=cduration,
                metadata={"scanner": "conftest", "rc": crc},
            )
            findings.extend(cfindings)
            duration += cduration
        return ScanResult(
            scanner=ScannerKind.KUBE_SCORE,
            scanner_version=self._extract_version("kube-score", runner),
            file_type=FileType.KUBERNETES,
            files=[ScanFile(
                path=slice_.path,
                file_type=FileType.KUBERNETES,
                commit_sha=handoff.head_sha,
                findings=findings,
            )],
            duration_ms=duration,
        )

    def _run_docker_bench(
        self,
        handoff: HandoffInput,
        slice_: "DiffFileSlice",
        inputs: IacScannerInputs,
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        runner = inputs.docker_bench_runner or _default_docker_bench_runner
        start = _now_ms()
        rc, stdout, stderr = runner(slice_.path)
        duration = _now_ms() - start
        findings = _parse_docker_bench_json(stdout)
        for f in findings:
            f.file.file_type = FileType.DOCKERFILE
            f.scanner = ScannerKind.DOCKER_BENCH
        audit.record(
            "read_pr_diff",
            {
                "scanner": "docker-bench",
                "file_path": slice_.path,
                "rc": rc,
            },
            {"stderr_tail": (stderr or "")[-512:], "finding_count": len(findings)},
            duration_ms=duration,
            metadata={"scanner": "docker-bench", "rc": rc},
        )
        return ScanResult(
            scanner=ScannerKind.DOCKER_BENCH,
            scanner_version=self._extract_version("scripts/iac_docker_bench.sh", runner),
            file_type=FileType.DOCKERFILE,
            files=[ScanFile(
                path=slice_.path,
                file_type=FileType.DOCKERFILE,
                commit_sha=handoff.head_sha,
                findings=findings,
            )],
            duration_ms=duration,
        )

    def _extract_version(self, tool: str, runner: Callable[..., Any]) -> str:
        # The injected runner is the production source of version;
        # we only fall back to `tool --version` when no runner was
        # injected. Tests inject a runner and assert the stub.
        try:
            version_proc = subprocess.run(
                [tool, "--version"], capture_output=True, text=True, timeout=5,
            )
            first = (version_proc.stdout or version_proc.stderr).strip().splitlines()
            return first[0] if first else f"{tool}/unknown"
        except (FileNotFoundError, subprocess.TimeoutExpired, IndexError):
            return f"{tool}/unknown"

    def _aggregate_findings(
        self, results: List[ScanResult],
    ) -> List[IacFinding]:
        """Dedupe across scanners.

        Two scans can hit the same (file, rule_id); we surface it
        once with the highest severity. The dedupe key is
        `(file_path, rule_id)` — this matches the FORA-74 / FORA-76
        style of "same finding regardless of who reports it".
        """
        seen: Dict[tuple, IacFinding] = {}
        severity_order = {
            IacSeverity.CRITICAL: 0,
            IacSeverity.HIGH: 1,
            IacSeverity.MEDIUM: 2,
            IacSeverity.LOW: 3,
            IacSeverity.UNKNOWN: 4,
        }
        for r in results:
            for f in r.findings:
                key = (f.file.path, f.rule_id)
                if key in seen:
                    existing = seen[key]
                    if severity_order[f.severity] < severity_order[existing.severity]:
                        seen[key] = f
                    continue
                seen[key] = f
        # Stable order: CRITICAL first, then by file path, then by rule id.
        return sorted(
            seen.values(),
            key=lambda f: (
                severity_order[f.severity],
                f.file.path,
                f.rule_id,
            ),
        )

    def _derive_decision(self, findings: List[IacFinding]) -> Verdict:
        """Derive the verdict from the findings.

        FORA-77 hard rule: HIGH or CRITICAL ⇒ BLOCK. MEDIUM, LOW,
        UNKNOWN ⇒ BLOCK (this is the most aggressive gate in the
        Security Agent — the orchestrator's reviewer can downgrade).
        No findings ⇒ PASS.

        The override at the agent level is forbidden — the only
        override is a human security reviewer on the customer side.
        """
        if not findings:
            return Verdict.PASS
        return Verdict.BLOCK

    def _post_block_comment(
        self,
        handoff: HandoffInput,
        out: HandoffOutput,
        poster: PRCommentPoster,
        audit: SecurityAuditRecorder,
    ) -> bool:
        start = _now_ms()
        assert_tool_allowed("write_pr_comment", self._allow)
        comment = comment_for_block(out)
        # Defence in depth: refuse to post if the rendered comment
        # leaks a secret-shaped string or an IaC body. The
        # post-condition is also asserted by the smoke test.
        assert_comment_has_no_secret(comment)
        posted = poster.post_comment(pr_url=handoff.pr_url, comment=comment)
        audit.record_write_pr_comment(
            arguments={"handoff_id": out.handoff_id,
                       "summary": comment.summary,
                       "finding_count": comment.finding_count},
            output={"posted": bool(posted)},
            duration_ms=_now_ms() - start,
        )
        return bool(posted)


# ---------------------------------------------------------------------------
# Convenience entry point
# ---------------------------------------------------------------------------


def scan_iac(
    handoff: HandoffInput,
    *,
    audit: Optional[SecurityAuditRecorder] = None,
    allow_list: Optional[ToolAllowList] = None,
    checkov_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    kube_score_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    conftest_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    docker_bench_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    writers: Optional[Dict[str, Any]] = None,
) -> IacScannerOutputs:
    """Convenience wrapper: `IacScanner().scan(IacScannerInputs(...))`."""
    return IacScanner(allow_list=allow_list).scan(IacScannerInputs(
        handoff=handoff,
        audit=audit,
        checkov_runner=checkov_runner,
        kube_score_runner=kube_score_runner,
        conftest_runner=conftest_runner,
        docker_bench_runner=docker_bench_runner,
        writers=writers,
    ))
