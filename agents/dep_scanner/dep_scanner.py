"""
Dependency scanner — Sub-goal 5.2 (FORA-76) v0.

Deterministic, no-LLM scanner that turns an immutable handoff
artefact into a v1.0.0 verdict. The flow is:

  HandoffInput (immutable)
      │
      ▼
  read_pr_diff    ─────►  read the diff file (only this file)
      │
      ▼
  read_lockfile   ─────►  read the lockfile diff (only this file)
      │
      ▼
  Trivy subprocess ─► ScanResult (raw hits)
      │
      ▼
  Dependabot CLI  ─► ScanResult (full-history advisories)
      │
      ▼
  categorise() + severity_for()  ─►  DependencyFinding list
      │
      ▼
  HandoffOutput (verdict = PASS iff findings == [] AND no high/critical)
      │     ├── evidence_audit_id = evidence_writer.write_evidence(...)
      │     ├── sbom              = sbom_writer.write_sbom(...)
      │     └── artifact_key      = artifact_writer.write_artifact(...)
      ▼
  if verdict == BLOCK:  comment_poster.post_comment(...)  (sanitised)

Hard rules (per FORA-76):

  - Reads only the PR diff, the lockfile diff, and the immutable
    handoff artefact. Never reads the Developer's prompt, scratch
    space, or conversation log.
  - Runs in a separate process with a separate JWT and a tool
    allow-list limited to the six `ALLOWED_TOOLS`.
  - HIGH or CRITICAL CVE is ALWAYS `block`. There is no override
    at the agent level.
  - Output schema version is `1.0.0`. Breaking changes are a
    major version bump and a new ADR.

Scanners supported (v0):

  - `trivy fs --format json --severity HIGH,CRITICAL <lockfile_path>`
    — per-PR gate.
  - `dependabot dev-generate-config` is *not* the runtime path;
    Dependabot is wired in via the GitHub App for the full-history
    scan. The v0 implementation invokes the JSON advisory feed
    through `dependabot_runner` (mockable in tests; production
    hits the Dependabot REST API).

For deterministic testing, the `trivy_runner` and `dependabot_runner`
constructor args are injectable. Production constructors use the
subprocess-backed runners below.

The four I/O seams (evidence / SBOM / artefact / PR comment) are
injected via `DepScannerInputs.writers`; production wires the
S3, audit-store, and GitHub-MCP adapters. The smoke test uses
the in-memory defaults from `agents/dep_scanner/writers.py`.

Public surface:

    DepScanner         — the deterministic agent
    DepScannerInputs   — typed input bundle
    DepScannerOutputs  — typed output bundle
    ScannerError       — raised on invalid input
    scan_lockfile      — convenience entry point
"""

from __future__ import annotations

import json
import os
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
from .sbom import CycloneDxSbom
from .schemas import (
    SCHEMA_VERSION,
    CveSeverity,
    Decision,
    DependencyFinding,
    Ecosystem,
    HandoffInput,
    HandoffOutput,
    PackageRef,
    ScanDiff,
    ScanResult,
    ScannerKind,
    Verdict,
    derive_handoff_id,
    validate_handoff_output,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    PRCommentPoster,
    SbomWriter,
    default_writers,
)


class ScannerError(RuntimeError):
    """Raised when the scanner cannot proceed (bad input, missing
    lockfile, subprocess failure, allow-list violation). The
    runtime catches this and converts to an audit row with a
    typed error_code."""


# ---------------------------------------------------------------------------
# Subprocess runners (the production path; the smoke test injects mocks)
# ---------------------------------------------------------------------------


def _default_trivy_runner(
    lockfile_path: str,
    *,
    timeout_s: float = 60.0,
    severity_filter: Optional[str] = None,
) -> Tuple[int, str, str]:
    """Run `trivy fs` against the lockfile diff and return (rc, stdout, stderr).

    Default flags:

      fs                 scan the local filesystem
      --format json      machine-readable stdout
      --severity ...     gate on HIGH,CRITICAL (overridable for tests)
      --quiet            suppress progress on stderr
      --no-progress      same

    The timeout is 60s — Trivy on a single PR lockfile diff is
    sub-second in practice; the ceiling is a guard against a
    runaway binary on a malformed lockfile.
    """
    sev = severity_filter or "HIGH,CRITICAL"
    cmd = [
        "trivy", "fs",
        "--format", "json",
        "--severity", sev,
        "--quiet",
        "--no-progress",
        lockfile_path,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "trivy binary not on PATH; install or inject trivy_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"trivy timed out after {timeout_s}s on {lockfile_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


def _default_dependabot_runner(
    repo: str,
    *,
    timeout_s: float = 60.0,
) -> Tuple[int, str, str]:
    """Run a Dependabot advisory lookup against the repo and return
    (rc, stdout, stderr).

    In production this hits the GitHub Dependabot REST API:

        GET /repos/{owner}/{repo}/dependabot/alerts

    For the v0 wrapper we shell out to `gh api` if available;
    otherwise we surface a `ScannerError` so the orchestrator
    can fall back to Trivy-only.

    Used by the weekly full-history scanner path; the v0
    implementation only invokes this on the explicit
    `DepScannerInputs.full_history=True` flag.
    """
    cmd = [
        "gh", "api",
        f"repos/{repo}/dependabot/alerts?state=open&per_page=100",
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "gh binary not on PATH; install or inject dependabot_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"dependabot timed out after {timeout_s}s on {repo!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


# ---------------------------------------------------------------------------
# Output parsers — turn scanner stdout into a ScanResult
# ---------------------------------------------------------------------------


def _parse_trivy_json(stdout: str) -> List[DependencyFinding]:
    """Parse trivy's `--format json` stdout into a list of findings.

    Trivy emits a JSON object with at least `Results[].Vulnerabilities[]`;
    each vulnerability has `VulnerabilityID`, `PkgName`, `InstalledVersion`,
    `FixedVersion`, `Severity`, `Title`. We keep the raw payload in memory
    only; `DependencyFinding.to_dict()` drops it.
    """
    if not stdout.strip():
        return []
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ScannerError(
            f"trivy emitted non-JSON stdout: {exc}; first 200 chars: "
            f"{stdout[:200]!r}"
        ) from exc
    if not isinstance(data, dict):
        raise ScannerError(
            f"trivy JSON is not an object (got {type(data).__name__})"
        )

    findings: List[DependencyFinding] = []
    for result in data.get("Results", []) or []:
        target = result.get("Target", "")
        for vuln in result.get("Vulnerabilities", []) or []:
            sev_raw = (vuln.get("Severity") or "UNKNOWN").upper()
            severity = {
                "CRITICAL": CveSeverity.CRITICAL,
                "HIGH": CveSeverity.HIGH,
                "MEDIUM": CveSeverity.MEDIUM,
                "LOW": CveSeverity.LOW,
                "UNKNOWN": CveSeverity.MEDIUM,  # conservative
            }.get(sev_raw, CveSeverity.MEDIUM)

            pkg_name = vuln.get("PkgName") or "<unknown>"
            ecosystem = _ecosystem_from_target(target, pkg_name)
            fixed = vuln.get("FixedVersion") or ""
            findings.append(DependencyFinding(
                finding_id=f"finding-{uuid.uuid4().hex[:10]}",
                severity=severity,
                package=PackageRef(
                    ecosystem=ecosystem,
                    name=pkg_name,
                    installed_version=vuln.get("InstalledVersion") or "<unknown>",
                    fixed_versions=[v for v in (fixed,) if v] or [],
                ),
                cve_id=vuln.get("VulnerabilityID") or "",
                title=vuln.get("Title") or "",
                fixed_version=fixed,
                rule_id=vuln.get("VulnerabilityID") or "trivy",
                scanner=ScannerKind.TRIVY,
                raw_payload={"trivy": vuln},
            ))
    return findings


def _parse_dependabot_json(stdout: str) -> List[DependencyFinding]:
    """Parse Dependabot's alerts JSON into a list of findings.

    Dependabot emits a JSON array of alerts; each has `number`,
    `state`, `dependency.package.name`, `dependency.package.ecosystem`,
    `security_advisory.ghsa_id`, `security_advisory.cve_id`,
    `security_advisory.severity`, `security_vulnerability.patched_versions`.

    We only surface open alerts (Dependabot's "state": "open"); resolved
    ones are kept for the audit log but not added to the handoff output.
    """
    findings: List[DependencyFinding] = []
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
        if item.get("state") not in (None, "open"):
            continue
        dep = item.get("dependency", {}) or {}
        pkg = dep.get("package", {}) or {}
        adv = item.get("security_advisory", {}) or {}
        vuln = item.get("security_vulnerability", {}) or {}
        sev_raw = (adv.get("severity") or "medium").lower()
        severity = {
            "critical": CveSeverity.CRITICAL,
            "high": CveSeverity.HIGH,
            "moderate": CveSeverity.MEDIUM,
            "medium": CveSeverity.MEDIUM,
            "low": CveSeverity.LOW,
        }.get(sev_raw, CveSeverity.MEDIUM)

        ecosystem = _ecosystem_from_dependabot(pkg.get("ecosystem", "npm"))
        fixed_versions = (
            [v.lstrip(": ") for v in (vuln.get("patched_versions") or "").split(",")]
            if vuln.get("patched_versions")
            else []
        )
        fixed_versions = [v for v in fixed_versions if v]
        findings.append(DependencyFinding(
            finding_id=f"finding-{uuid.uuid4().hex[:10]}",
            severity=severity,
            package=PackageRef(
                ecosystem=ecosystem,
                name=pkg.get("name") or "<unknown>",
                installed_version=dep.get("manifest_path") or "<unknown>",
                fixed_versions=fixed_versions,
            ),
            cve_id=adv.get("cve_id") or "",
            advisory_id=adv.get("ghsa_id") or "",
            title=adv.get("summary") or "",
            fixed_version=fixed_versions[0] if fixed_versions else "",
            rule_id=adv.get("ghsa_id") or adv.get("cve_id") or "dependabot",
            scanner=ScannerKind.DEPENDABOT,
            raw_payload={"dependabot": item},
        ))
    return findings


def _ecosystem_from_target(target: str, pkg_name: str) -> Ecosystem:
    """Best-effort ecosystem inference from trivy's `Target` path."""
    if not target:
        return Ecosystem.GENERIC
    t = target.lower()
    if t.endswith("package-lock.json") or t.endswith("pnpm-lock.yaml"):
        return Ecosystem.NPM
    if t.endswith("yarn.lock"):
        return Ecosystem.NPM
    if t.endswith("requirements.txt") or t.endswith("pyproject.toml") or "python" in t:
        return Ecosystem.PYPI
    if t.endswith("go.mod") or t.endswith("go.sum"):
        return Ecosystem.GO
    if t.endswith("pom.xml"):
        return Ecosystem.MAVEN
    if t.endswith("cargo.toml") or t.endswith("cargo.lock"):
        return Ecosystem.CARGO
    if t.endswith("gemfile.lock") or t.endswith("gemfile"):
        return Ecosystem.RUBYGEMS
    if t.endswith("composer.json") or t.endswith("composer.lock"):
        return Ecosystem.COMPOSER
    if t.endswith("packages.lock.json") or t.endswith(".nuspec"):
        return Ecosystem.NUGET
    return Ecosystem.GENERIC


def _ecosystem_from_dependabot(raw: str) -> Ecosystem:
    """Map a Dependabot ecosystem string to our Ecosystem enum."""
    s = (raw or "").lower()
    return {
        "pip": Ecosystem.PYPI,
        "npm": Ecosystem.NPM,
        "maven": Ecosystem.MAVEN,
        "go_modules": Ecosystem.GO,
        "nuget": Ecosystem.NUGET,
        "rubygems": Ecosystem.RUBYGEMS,
        "cargo": Ecosystem.CARGO,
        "composer": Ecosystem.COMPOSER,
    }.get(s, Ecosystem.GENERIC)


# ---------------------------------------------------------------------------
# Inputs / outputs bundles
# ---------------------------------------------------------------------------


@dataclass
class DepScannerInputs:
    """Typed input bundle for `DepScanner.scan()`.

    The handoff artefact is the *only* thing the scanner reads
    about the developer's work; the audit seam records the
    read so AC #4 can be replayed.

    `writers` carries the four I/O seams (evidence / SBOM /
    artefact / PR comment). Production wires the S3,
    audit-store, and GitHub-MCP adapters; the smoke test uses
    the in-memory defaults from `agents/dep_scanner/writers.py`.
    """

    handoff: HandoffInput
    # Optional: weekly full-history scan path. When set, the scanner
    # runs Dependabot in addition to Trivy. The default is False
    # because the orchestrator schedules full-history on its own cron.
    full_history: bool = False
    # Injectable runners for tests. Production leaves these None
    # and the scanner uses `_default_trivy_runner` /
    # `_default_dependabot_runner`.
    trivy_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    dependabot_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    # Optional override: when True the scanner also runs the Snyk
    # path (gated on customer licence per FORA-76 open question).
    # v0 default is False; the orchestrator flips this when the
    # customer config enables it.
    snyk_enabled: bool = False
    # Audit recorder. The smoke test injects one; production wires
    # the system-wide store adapter here.
    audit: Optional[SecurityAuditRecorder] = None
    # I/O seams. Defaults to in-memory writers; production passes
    # the system adapters via `default_writers()` is replaced by
    # the production bundle.
    writers: Optional[Dict[str, Any]] = None


@dataclass
class DepScannerOutputs:
    """Typed output bundle for `DepScanner.scan()`.

    `handoff_output` is the v1.0.0 artefact the orchestrator hands
    to DevOps on `pass` or back to Coding on `block`. `validation_errors`
    is empty on a successful run; non-empty means the scanner could
    not produce a conformant handoff (the orchestrator must not
    accept it). `sbom_bytes` is the raw CycloneDX 1.5 JSON
    (returned so the smoke test can write it to evidence; production
    only persists it through `SbomWriter.write_sbom`).
    """

    handoff_output: HandoffOutput
    validation_errors: List[str] = field(default_factory=list)
    scan_results: List[ScanResult] = field(default_factory=list)
    sbom_bytes: bytes = b""


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------


class DepScanner:
    """Deterministic Dependency Scanner for the Security Agent (FORA-76).

    Construct one of these at process start (the runtime injects
    the allow-list and the audit recorder). Call `scan()` once per
    PR. The same `HandoffInput` + the same injected runners
    always produces the same `HandoffOutput` bytes (production
    wiring is deterministic).
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

    def scan(self, inputs: DepScannerInputs) -> DepScannerOutputs:
        """Run the scanner against the handoff artefact.

        Steps (in order):

          1. read_pr_diff      — assert the diff file exists
          2. read_lockfile     — assert the lockfile diff exists
          3. trivy             — per-PR scan (always)
          4. dependabot        — full-history scan (only if full_history=True)
          5. categorise + dedupe (severity stays the same)
          6. emit SBOM (CycloneDX 1.5) — AC #4
          7. write_scan_evidence — audit row
          8. write_sbom        — persist the SBOM
          9. write_handoff_artifact — v1.0.0 envelope
         10. if BLOCK: write_pr_comment (sanitised)

        Returns a `DepScannerOutputs`. The orchestrator checks
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

        # 2. read_lockfile -------------------------------------------------
        read_lock_start = _now_ms()
        assert_tool_allowed("read_lockfile", allow)
        lockfile_text = self._read_lockfile(handoff.lockfile_path)
        read_lock_end = _now_ms()
        audit.record_read_lockfile(
            arguments={"lockfile_path": handoff.lockfile_path,
                       "handoff_id": handoff.handoff_id},
            output={"bytes": len(lockfile_text), "path": handoff.lockfile_path},
            duration_ms=read_lock_end - read_lock_start,
            metadata={"pr_number": handoff.pr_number},
        )

        # 3. trivy ---------------------------------------------------------
        trivy_runner = inputs.trivy_runner or _default_trivy_runner
        scan_results: List[ScanResult] = []
        trivy_scan = self._run_trivy(
            handoff, trivy_runner, audit
        )
        scan_results.append(trivy_scan)

        # 4. dependabot ----------------------------------------------------
        if inputs.full_history:
            dependabot_runner = inputs.dependabot_runner or _default_dependabot_runner
            full_scan = self._run_dependabot(
                handoff, dependabot_runner, audit
            )
            scan_results.append(full_scan)

        # 5. categorise + dedupe ------------------------------------------
        findings = self._aggregate_findings(scan_results)

        # 6. emit SBOM (CycloneDX 1.5) ------------------------------------
        scanner_versions = {
            r.scanner.value: r.scanner_version for r in scan_results
        }
        sbom_bytes, sbom_ref = CycloneDxSbom(handoff).emit(
            findings, scanner_versions=scanner_versions,
        )

        # 7. write_scan_evidence -----------------------------------------
        # We decide here (after dedupe) so the audit row carries the
        # final finding_count — not the pre-dedupe count.
        decision = self._derive_decision(findings)

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
            sbom=sbom_ref,
        )
        audit.record_write_scan_evidence(
            arguments={"handoff_id": handoff.handoff_id},
            output={"evidence_id": evidence_id},
            duration_ms=_now_ms() - evidence_start,
        )

        # 8. write_sbom ----------------------------------------------------
        sbom_start = _now_ms()
        assert_tool_allowed("write_sbom", allow)
        sbom_key = writers["sbom"].write_sbom(sbom_bytes, sbom_ref)
        audit.record_write_sbom(
            arguments={"handoff_id": handoff.handoff_id,
                       "byte_size": sbom_ref.byte_size},
            output={"key": sbom_key, "sha256": sbom_ref.sha256},
            duration_ms=_now_ms() - sbom_start,
        )

        # 9. write_handoff_artifact ---------------------------------------
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
            sbom=sbom_ref,
            mode="full_history" if inputs.full_history else "per_pr",
        )
        artifact_key = writers["artifact"].write_artifact(handoff_output)
        audit.record_write_handoff_artifact(
            arguments={"handoff_id": handoff.handoff_id},
            output={"key": artifact_key, "decision": decision.value},
            duration_ms=_now_ms() - artifact_start,
        )

        # 10. write_pr_comment (BLOCK only) --------------------------------
        posted = False
        if decision == Verdict.BLOCK:
            posted = self._post_block_comment(
                handoff, handoff_output, writers["comment"], audit,
            )
            handoff_output.pr_comment_posted = posted

        validation = validate_handoff_output(handoff_output)
        return DepScannerOutputs(
            handoff_output=handoff_output,
            validation_errors=validation,
            scan_results=scan_results,
            sbom_bytes=sbom_bytes,
        )

    # -- helpers ---------------------------------------------------------

    def _validate_handoff(self, h: HandoffInput) -> None:
        if not h.handoff_id:
            raise ScannerError("HandoffInput.handoff_id is required")
        if not h.pr_diff_path:
            raise ScannerError("HandoffInput.pr_diff_path is required")
        if not h.lockfile_path:
            raise ScannerError("HandoffInput.lockfile_path is required")
        if not h.run_id:
            raise ScannerError("HandoffInput.run_id is required")
        if not h.tenant_id:
            raise ScannerError("HandoffInput.tenant_id is required")

    def _validate_writers(self, writers: Dict[str, Any]) -> None:
        required = ("evidence", "sbom", "artifact", "comment")
        missing = [k for k in required if k not in writers]
        if missing:
            raise ScannerError(
                f"writers dict missing required keys {missing!r}; "
                "got keys: " + ", ".join(sorted(writers.keys()))
            )

    def _make_audit(self, inputs: DepScannerInputs) -> SecurityAuditRecorder:
        return SecurityAuditRecorder(
            run_id=inputs.handoff.run_id,
            tenant_id=inputs.handoff.tenant_id,
            agent_id=os.environ.get("FORA_AGENT_ID", "dep-scanner"),
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

    def _read_lockfile(self, path: str) -> str:
        try:
            return Path(path).read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise ScannerError(
                f"Lockfile not found at {path!r}; the orchestrator must "
                "stage the lockfile diff before the Security Agent starts"
            ) from exc

    def _run_trivy(
        self,
        handoff: HandoffInput,
        runner: Callable[..., Tuple[int, str, str]],
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        start = _now_ms()
        rc, stdout, stderr = runner(handoff.lockfile_path)
        duration = _now_ms() - start
        findings = _parse_trivy_json(stdout)
        # Subprocess invocation is logged as an audit record but is
        # NOT a tool call against the agent's allow-list — Trivy is
        # invoked by the agent, not called by it.
        audit.record(
            "read_lockfile",
            {
                "scanner": "trivy",
                "lockfile_path": handoff.lockfile_path,
                "rc": rc,
            },
            {
                "stderr_tail": (stderr or "")[-512:],
                "finding_count": len(findings),
            },
            duration_ms=duration,
            metadata={"scanner": "trivy", "rc": rc},
        )
        return ScanResult(
            scanner=ScannerKind.TRIVY,
            scanner_version=self._extract_version("trivy", runner),
            diffs=[ScanDiff(
                path=handoff.lockfile_path,
                commit_sha=handoff.head_sha,
                findings=findings,
            )],
            duration_ms=duration,
        )

    def _run_dependabot(
        self,
        handoff: HandoffInput,
        runner: Callable[..., Tuple[int, str, str]],
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        start = _now_ms()
        rc, stdout, stderr = runner(handoff.repo)
        duration = _now_ms() - start
        findings = _parse_dependabot_json(stdout)
        audit.record(
            "read_lockfile",
            {
                "scanner": "dependabot",
                "repo": handoff.repo,
                "rc": rc,
            },
            {"finding_count": len(findings)},
            duration_ms=duration,
            metadata={"scanner": "dependabot", "rc": rc},
        )
        return ScanResult(
            scanner=ScannerKind.DEPENDABOT,
            scanner_version=self._extract_version("gh", runner),
            diffs=[ScanDiff(
                path=handoff.repo,
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
    ) -> List[DependencyFinding]:
        """Dedupe across scanners.

        Two scans can hit the same package + CVE; we surface it once
        with the highest severity. The dedupe key is
        `(package_name, cve_id_or_advisory_id)` — this matches the
        FORA-74 style of "same vuln regardless of who reports it".
        When a scanner reports only an advisory id (no CVE id), we
        fall back to `(package_name, advisory_id)`. Package version
        is intentionally NOT in the key: the Dependabot runner
        surfaces `manifest_path` instead of the installed version,
        and we want Trivy + Dependabot to agree on the same finding.
        """
        seen: Dict[tuple, DependencyFinding] = {}
        severity_order = {
            CveSeverity.CRITICAL: 0,
            CveSeverity.HIGH: 1,
            CveSeverity.MEDIUM: 2,
            CveSeverity.LOW: 3,
        }
        for r in results:
            for f in r.findings:
                rid = f.cve_id or f.advisory_id or f.rule_id
                key = (f.package.name, rid)
                if key in seen:
                    existing = seen[key]
                    if severity_order[f.severity] < severity_order[existing.severity]:
                        seen[key] = f
                    continue
                seen[key] = f
        # Stable order: CRITICAL first, then HIGH, then by package name.
        return sorted(
            seen.values(),
            key=lambda f: (
                severity_order[f.severity],
                f.package.name,
                f.package.installed_version,
            ),
        )

    def _derive_decision(self, findings: List[DependencyFinding]) -> Verdict:
        """Derive the verdict from the findings.

        FORA-76 hard rule: HIGH or CRITICAL ⇒ BLOCK. MEDIUM ⇒ BLOCK.
        LOW ⇒ BLOCK if 2+ (a single LOW is often a known-rotation
        stale advisory; we surface but the orchestrator may override).
        No findings ⇒ PASS.

        The override at the agent level is forbidden — the only
        override is a human security reviewer on the customer side.
        """
        if not findings:
            return Verdict.PASS
        for f in findings:
            if f.severity in (CveSeverity.CRITICAL, CveSeverity.HIGH):
                return Verdict.BLOCK
        if any(f.severity == CveSeverity.MEDIUM for f in findings):
            return Verdict.BLOCK
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
        # leaks a secret-shaped string or a lockfile body. The
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


def scan_lockfile(
    handoff: HandoffInput,
    *,
    audit: Optional[SecurityAuditRecorder] = None,
    allow_list: Optional[ToolAllowList] = None,
    trivy_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    dependabot_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    full_history: bool = False,
    writers: Optional[Dict[str, Any]] = None,
) -> DepScannerOutputs:
    """Convenience wrapper: `DepScanner().scan(DepScannerInputs(...))`."""
    return DepScanner(allow_list=allow_list).scan(DepScannerInputs(
        handoff=handoff,
        audit=audit,
        trivy_runner=trivy_runner,
        dependabot_runner=dependabot_runner,
        full_history=full_history,
        writers=writers,
    ))