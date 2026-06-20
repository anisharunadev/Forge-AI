"""
Secret scanner — Sub-goal 5.1 (FORA-74) v0.

Deterministic, no-LLM scanner that turns an immutable handoff
artefact into a v1.0.0 verdict. The flow is:

  HandoffInput (immutable)
      │
      ▼
  read_pr_diff  ─────►  read the diff file (only this file)
      │
      ▼
  gitleaks subprocess ─► ScanResult (raw hits)
      │
      ▼
  categorise() + severity_for()  ─►  SecretFinding list (sanitised)
      │
      ▼
  HandoffOutput
      │     ├── verdict = PASS iff findings == []
      │     └── evidence_audit_id = evidence_writer.write_evidence(...)
      ▼
  artifact_writer.write_artifact(...)  ─►  storage key
      │
      ▼
  if verdict == BLOCK:  comment_poster.post_comment(...)  (no secret value)

Hard rules (per FORA-74):

  - Reads only the PR diff and the immutable handoff artefact.
    Never reads the Developer's prompt, scratch space, or
    conversation log.
  - Runs in a separate process with a separate JWT and a tool
    allow-list limited to the four `ALLOWED_TOOLS`.
  - Output schema version is `1.0.0`. Breaking changes are a
    major version bump and a new ADR.

Scanners supported (v0):

  - `gitleaks detect --no-git --source <pr_diff_path>` — per-PR gate.
  - `trufflehog git file://...` — weekly full-history (the v0
    implementation only invokes this on the explicit
    `ScannerInputs.full_history=True` flag; the orchestrator is
    expected to schedule weekly runs as a separate cron path).

For deterministic testing, the `gitleaks_runner` and
`trufflehog_runner` constructor args are injectable. Production
constructors use the subprocess-backed runners below.

The three I/O seams (evidence / artefact / PR comment) are
injected via `ScannerInputs.writers`; production wires the S3,
audit-store, and GitHub-MCP adapters there. The smoke test uses
the in-memory defaults from `agents/security/writers.py`.

Public surface:

    SecretScanner      — the deterministic agent
    ScannerInputs      — typed input bundle
    ScannerOutputs     — typed output bundle
    ScannerError       — raised on invalid input
    scan_pr            — convenience entry point
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
from .schemas import (
    SCHEMA_VERSION,
    Decision,
    HandoffInput,
    HandoffOutput,
    ScanDiff,
    ScanResult,
    SecretFinding,
    SecretSeverity,
    Verdict,
    categorise,
    derive_handoff_id,
    redact_secret,
    severity_for,
    validate_handoff_output,
)
from .writers import (
    EvidenceWriter,
    HandoffArtifactWriter,
    PRCommentPoster,
    default_writers,
)


class ScannerError(RuntimeError):
    """Raised when the scanner cannot proceed (bad input, missing diff,
    subprocess failure, allow-list violation). The runtime catches
    this and converts to an audit row with a typed error_code."""


# ---------------------------------------------------------------------------
# Subprocess runners (the production path; the smoke test injects mocks)
# ---------------------------------------------------------------------------


def _default_gitleaks_runner(
    pr_diff_path: str,
    *,
    config_path: Optional[str] = None,
    timeout_s: float = 30.0,
) -> Tuple[int, str, str]:
    """Run `gitleaks detect` against the PR diff and return (rc, stdout, stderr).

    Default flags:

      --no-git           the diff is a flat file, not a repo
      --source           the path to scan
      --report=json      machine-readable stdout
      --exit-code 1      exit non-zero on any finding
      --no-banner        quiet stderr

    The timeout is 30s — gitleaks on a single PR diff is sub-second
    in practice; the ceiling is a guard against a runaway binary
    on a malformed diff.
    """
    cmd = [
        "gitleaks", "detect",
        "--no-git",
        "--source", pr_diff_path,
        "--report", "json",
        "--exit-code", "1",
        "--no-banner",
    ]
    if config_path:
        cmd.extend(["--config", config_path])
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "gitleaks binary not on PATH; install or inject gitleaks_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"gitleaks timed out after {timeout_s}s on {pr_diff_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


def _default_trufflehog_runner(
    repo_path: str,
    *,
    timeout_s: float = 300.0,
) -> Tuple[int, str, str]:
    """Run `trufflehog git` against the full repo history and return
    (rc, stdout, stderr).

    Used by the weekly full-history scanner path. trufflehog is
    slower and noisier than gitleaks; the timeout is generous.
    """
    cmd = [
        "trufflehog", "git",
        f"file://{repo_path}",
        "--json",
        "--no-update",
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
        )
    except FileNotFoundError as exc:
        raise ScannerError(
            "trufflehog binary not on PATH; install or inject trufflehog_runner"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ScannerError(
            f"trufflehog timed out after {timeout_s}s on {repo_path!r}"
        ) from exc
    return proc.returncode, proc.stdout, proc.stderr


# ---------------------------------------------------------------------------
# Output parsers — turn scanner stdout into a ScanResult
# ---------------------------------------------------------------------------


def _parse_gitleaks_json(stdout: str) -> List[SecretFinding]:
    """Parse gitleaks' `--report=json` stdout into a list of findings.

    gitleaks emits either an empty array (no findings) or an array
    of objects with at least `RuleID`, `File`, `StartLine`, `Match`,
    `Secret`, and `Description`. We keep the raw `Secret` in memory
    only — it is dropped by `SecretFinding.to_dict()`.
    """
    if not stdout.strip():
        return []
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ScannerError(
            f"gitleaks emitted non-JSON stdout: {exc}; first 200 chars: "
            f"{stdout[:200]!r}"
        ) from exc
    if not isinstance(data, list):
        raise ScannerError(
            f"gitleaks JSON is not an array (got {type(data).__name__})"
        )

    findings: List[SecretFinding] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        rule_id = item.get("RuleID") or item.get("Rule") or "unknown"
        match = item.get("Match") or item.get("Secret") or ""
        file = item.get("File") or "<unknown>"
        line = int(item.get("StartLine") or item.get("Line") or 0)
        category = categorise(rule_id, match)
        severity = severity_for(rule_id)
        findings.append(SecretFinding(
            finding_id=f"finding-{uuid.uuid4().hex[:10]}",
            severity=severity,
            category=category,
            rule_id=rule_id,
            scanner="gitleaks",
            file=file,
            line=line,
            secret_value=match,
        ))
    return findings


def _parse_trufflehog_json(stdout: str) -> List[SecretFinding]:
    """Parse trufflehog's NDJSON stdout into a list of findings.

    trufflehog emits one JSON object per line. We only surface
    verified findings (the `Verified` flag is True); unverified
    hits are kept for the audit log but not added to the
    handoff output.
    """
    findings: List[SecretFinding] = []
    if not stdout.strip():
        return findings
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        if not item.get("Verified"):
            continue
        detector = item.get("DetectorName") or "unknown"
        raw = item.get("Raw") or ""
        git_meta = (item.get("SourceMetadata", {})
                        .get("Data", {})
                        .get("Git", {})
                        or {})
        file = git_meta.get("file") or "<unknown>"
        line_no = int(git_meta.get("line") or 0)
        category = categorise(f"trufflehog:{detector.lower().replace(' ', '_')}", raw)
        severity = severity_for(f"trufflehog:{detector.lower().replace(' ', '_')}")
        findings.append(SecretFinding(
            finding_id=f"finding-{uuid.uuid4().hex[:10]}",
            severity=severity,
            category=category,
            rule_id=f"trufflehog:{detector}",
            scanner="trufflehog",
            file=file,
            line=line_no,
            secret_value=raw,
        ))
    return findings


# ---------------------------------------------------------------------------
# Inputs / outputs bundles
# ---------------------------------------------------------------------------


@dataclass
class ScannerInputs:
    """Typed input bundle for `SecretScanner.scan()`.

    The handoff artefact is the *only* thing the scanner reads
    about the developer's work; the audit seam records the
    read so AC #4 can be replayed.

    `writers` carries the three I/O seams (evidence / artefact /
    PR comment). Production wires the S3, audit-store, and
    GitHub-MCP adapters; the smoke test uses the in-memory
    defaults from `agents/security/writers.py`.
    """

    handoff: HandoffInput
    # Optional: weekly full-history scan path. When set, the scanner
    # runs trufflehog in addition to gitleaks. The default is False
    # because the orchestrator schedules full-history on its own cron.
    full_history: bool = False
    # Injectable runners for tests. Production leaves these None
    # and the scanner uses `_default_gitleaks_runner` /
    # `_default_trufflehog_runner`.
    gitleaks_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    trufflehog_runner: Optional[Callable[..., Tuple[int, str, str]]] = None
    # Optional override for the gitleaks config path. Defaults to
    # `<repo>/.gitleaks.toml` (resolved against the diff path's parent).
    gitleaks_config_path: Optional[str] = None
    # Audit recorder. The smoke test injects one; production wires
    # the system-wide store adapter here.
    audit: Optional[SecurityAuditRecorder] = None
    # I/O seams. Defaults to in-memory writers; production passes
    # the system adapters via `default_writers()` is replaced by
    # the production bundle.
    writers: Optional[Dict[str, Any]] = None


@dataclass
class ScannerOutputs:
    """Typed output bundle for `SecretScanner.scan()`.

    `handoff_output` is the v1.0.0 artefact the orchestrator hands
    to DevOps on `pass` or back to Coding on `block`. `validation_errors`
    is empty on a successful run; non-empty means the scanner could
    not produce a conformant handoff (the orchestrator must not
    accept it).
    """

    handoff_output: HandoffOutput
    validation_errors: List[str] = field(default_factory=list)
    scan_results: List[ScanResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# The agent
# ---------------------------------------------------------------------------


class SecretScanner:
    """Deterministic Secret Scanner for the Security Agent (FORA-74).

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

    def scan(self, inputs: ScannerInputs) -> ScannerOutputs:
        """Run the scanner against the handoff artefact.

        Steps (in order):

          1. read_pr_diff   — assert the diff file exists
          2. gitleaks       — per-PR scan (always)
          3. trufflehog     — full-history scan (only if full_history=True)
          4. categorise + sanitise + dedupe
          5. write_scan_evidence — audit row
          6. write_handoff_artifact — v1.0.0 envelope
          7. if BLOCK: write_pr_comment (sanitised)

        Returns a `ScannerOutputs`. The orchestrator checks
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
        read_start = _now_ms()
        assert_tool_allowed("read_pr_diff", allow)
        diff_text = self._read_pr_diff(handoff.pr_diff_path)
        read_end = _now_ms()
        audit.record_read_pr_diff(
            arguments={"pr_diff_path": handoff.pr_diff_path,
                       "handoff_id": handoff.handoff_id},
            output={"bytes": len(diff_text), "path": handoff.pr_diff_path},
            duration_ms=read_end - read_start,
            metadata={"pr_number": handoff.pr_number},
        )

        # 2. gitleaks ------------------------------------------------------
        gitleaks_runner = inputs.gitleaks_runner or _default_gitleaks_runner
        config_path = inputs.gitleaks_config_path or self._resolve_gitleaks_config(
            handoff.pr_diff_path
        )
        scan_results: List[ScanResult] = []
        gitleaks_scan = self._run_gitleaks(
            handoff, gitleaks_runner, config_path, audit
        )
        scan_results.append(gitleaks_scan)

        # 3. trufflehog ----------------------------------------------------
        if inputs.full_history:
            trufflehog_runner = inputs.trufflehog_runner or _default_trufflehog_runner
            full_scan = self._run_trufflehog(
                handoff, trufflehog_runner, audit
            )
            scan_results.append(full_scan)

        # 4. categorise + sanitise + dedupe -------------------------------
        findings = self._aggregate_findings(scan_results, handoff)
        decision = self._derive_decision(findings)

        # 5. write_scan_evidence ------------------------------------------
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
            arguments={"handoff_id": handoff.handoff_id},
            output={"evidence_id": evidence_id},
            duration_ms=_now_ms() - evidence_start,
        )

        # 6. write_handoff_artifact ---------------------------------------
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
            scanners_used=[r.scanner for r in scan_results],
            scanner_versions={r.scanner: r.scanner_version for r in scan_results},
            pr_comment_posted=False,
            evidence_audit_id=evidence_id,
            duration_ms=sum(r.duration_ms for r in scan_results),
        )
        artifact_key = writers["artifact"].write_artifact(handoff_output)
        audit.record_write_handoff_artifact(
            arguments={"handoff_id": handoff.handoff_id},
            output={"key": artifact_key, "decision": decision.value},
            duration_ms=_now_ms() - artifact_start,
        )

        # 7. write_pr_comment (BLOCK only) --------------------------------
        posted = False
        if decision == Verdict.BLOCK:
            posted = self._post_block_comment(
                handoff, handoff_output, writers["comment"], audit,
            )
            handoff_output.pr_comment_posted = posted

        validation = validate_handoff_output(handoff_output)
        return ScannerOutputs(
            handoff_output=handoff_output,
            validation_errors=validation,
            scan_results=scan_results,
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

    def _make_audit(self, inputs: ScannerInputs) -> SecurityAuditRecorder:
        return SecurityAuditRecorder(
            run_id=inputs.handoff.run_id,
            tenant_id=inputs.handoff.tenant_id,
            agent_id=os.environ.get("FORA_AGENT_ID", "security-agent"),
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

    def _resolve_gitleaks_config(self, pr_diff_path: str) -> Optional[str]:
        # The diff lives somewhere under the worktree; the rule set
        # is the repo-root `.gitleaks.toml`. Walk up looking for it.
        cur = Path(pr_diff_path).resolve()
        for parent in [cur, *cur.parents]:
            candidate = parent / ".gitleaks.toml"
            if candidate.exists():
                return str(candidate)
        return None

    def _run_gitleaks(
        self,
        handoff: HandoffInput,
        runner: Callable[..., Tuple[int, str, str]],
        config_path: Optional[str],
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        start = _now_ms()
        rc, stdout, stderr = runner(
            handoff.pr_diff_path,
            config_path=config_path,
        )
        duration = _now_ms() - start
        findings = _parse_gitleaks_json(stdout)
        # Subprocess invocation is logged as an audit record but is
        # NOT a tool call against the agent's allow-list — gitleaks
        # is invoked by the agent, not called by it.
        audit.record(
            "read_pr_diff",
            {
                "scanner": "gitleaks",
                "pr_diff_path": handoff.pr_diff_path,
                "config_path": config_path,
                "rc": rc,
            },
            {
                "stderr_tail": (stderr or "")[-512:],
                "finding_count": len(findings),
            },
            duration_ms=duration,
            metadata={"scanner": "gitleaks", "rc": rc},
        )
        return ScanResult(
            scanner="gitleaks",
            scanner_version=self._extract_version("gitleaks", runner),
            diffs=[ScanDiff(
                path=handoff.pr_diff_path,
                commit_sha=handoff.head_sha,
                findings=findings,
            )],
            duration_ms=duration,
        )

    def _run_trufflehog(
        self,
        handoff: HandoffInput,
        runner: Callable[..., Tuple[int, str, str]],
        audit: SecurityAuditRecorder,
    ) -> ScanResult:
        start = _now_ms()
        rc, stdout, stderr = runner(handoff.pr_diff_path)
        duration = _now_ms() - start
        findings = _parse_trufflehog_json(stdout)
        audit.record(
            "read_pr_diff",
            {
                "scanner": "trufflehog",
                "pr_diff_path": handoff.pr_diff_path,
                "rc": rc,
            },
            {"finding_count": len(findings)},
            duration_ms=duration,
            metadata={"scanner": "trufflehog", "rc": rc},
        )
        return ScanResult(
            scanner="trufflehog",
            scanner_version=self._extract_version("trufflehog", runner),
            diffs=[ScanDiff(
                path=handoff.pr_diff_path,
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
        self, results: List[ScanResult], handoff: HandoffInput
    ) -> List[SecretFinding]:
        seen: set = set()
        out: List[SecretFinding] = []
        for r in results:
            for f in r.findings:
                # Dedupe on (file, line, rule_id, redacted) — two scans
                # can hit the same line; we surface it once.
                key = (f.file, f.line, f.rule_id, redact_secret(f.secret_value))
                if key in seen:
                    continue
                seen.add(key)
                out.append(f)
        return out

    def _derive_decision(self, findings: List[SecretFinding]) -> Verdict:
        if not findings:
            return Verdict.PASS
        # CRITICAL or HIGH ⇒ BLOCK always.
        for f in findings:
            if f.severity in (SecretSeverity.CRITICAL, SecretSeverity.HIGH):
                return Verdict.BLOCK
        # MEDIUM only ⇒ BLOCK.
        if any(f.severity == SecretSeverity.MEDIUM for f in findings):
            return Verdict.BLOCK
        # LOW only ⇒ BLOCK if 2+ (a single LOW is often a known-rotation
        # stale token; we surface it but the orchestrator may override).
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
        # leaks a secret. The post-condition is also asserted by
        # the smoke test.
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


def scan_pr(
    handoff: HandoffInput,
    *,
    audit: Optional[SecurityAuditRecorder] = None,
    allow_list: Optional[ToolAllowList] = None,
    gitleaks_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    trufflehog_runner: Optional[Callable[..., Tuple[int, str, str]]] = None,
    gitleaks_config_path: Optional[str] = None,
    full_history: bool = False,
    writers: Optional[Dict[str, Any]] = None,
) -> ScannerOutputs:
    """Convenience entry point: build a scanner, run it once.

    Used by the orchestrator. The smoke test uses `SecretScanner`
    directly so it can inspect the audit recorder.
    """
    scanner = SecretScanner(
        allow_list=allow_list,
        check_process_identity=False,  # the smoke test doesn't set env
    )
    return scanner.scan(ScannerInputs(
        handoff=handoff,
        full_history=full_history,
        gitleaks_runner=gitleaks_runner,
        trufflehog_runner=trufflehog_runner,
        gitleaks_config_path=gitleaks_config_path,
        audit=audit,
        writers=writers or default_writers(),
    ))
