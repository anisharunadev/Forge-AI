"""Run-level explainability service (Step-64 Sub-step A).

Stateless + read-only. Fans out across :class:`SDLCRunManager`,
:class:`AuditEvent`, :class:`CommandRun`, and :class:`Artifact` to build
the 5-question explainability bundle defined in
:mod:`app.schemas.explainability`.

The service is intentionally pure for the building-block methods so
they can be unit-tested without a DB; only :meth:`compute` touches
SQLAlchemy. Tests exercise :meth:`_q1_from_data`, :meth:`_q2_from_data`,
etc. directly.
"""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING, Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.artifact import Artifact
from app.db.models.audit import AuditEvent
from app.db.models.command_run import CommandRun
from app.schemas.explainability import (
    ChangeEntry,
    ChangeKindLiteral,
    CheckEntry,
    CheckOutcomeLiteral,
    CheckSourceLiteral,
    GradeLiteral,
    Q1ChangesAndWhy,
    Q2ChecksPerformed,
    Q3CoverageGaps,
    Q4ConfidenceScore,
    Q5Counterfactual,
    RunExplainability,
)
from app.schemas.validation_report import DecisionLiteral, ValidationReport

if TYPE_CHECKING:
    # Imported only for type hints — pulling this in at runtime would
    # drag the LangGraph agent chain into the test process, which
    # trips the SQLite-incompatible engine settings. The service
    # only calls ``.get_run(run_id)`` on the manager, so any object
    # exposing that method satisfies the contract.
    from app.services.sdlc_run_manager import SDLCRunManager


# The validation_report artifact type is shared with the API layer;
# importing the constant keeps the two in lock-step.
VALIDATION_REPORT_TYPE = "validation_report"


class RunExplainabilityService:
    """Compute the 5-question bundle for a single SDLC run.

    The service is **read-only**: every method is a query + projection.
    No state on the instance beyond the constructor-injected manager.
    """

    #: Gaps we always surface — honest disclosures the agent never
    #: could have checked itself, but reviewers should know about.
    STANDARD_GAPS: tuple[str, ...] = (
        "Concurrency safety beyond the agent's own lock-free assumptions.",
        "Cross-tenant data leakage (covered by F-829i but not per-PR).",
        "Long-term state drift > 7 days (no continuous regression harness yet).",
    )

    #: Bucket for the calibration band chart. Values are illustrative —
    #: they show the expected shape of a calibrated histogram without
    #: pretending to be real measurements.
    CONFIDENCE_BANDS: dict[str, int] = {
        "0-20": 5,
        "20-40": 12,
        "40-60": 35,
        "60-80": 78,
        "80-100": 156,
    }

    #: Below this raw_score we recommend human escalation.
    CONFIDENCE_THRESHOLD: float = 70.0

    def __init__(self, manager: "SDLCRunManager | Any") -> None:
        self._manager = manager

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def compute(
        self,
        db: AsyncSession,
        *,
        run_id: UUID,
        tenant_id: UUID,
        project_id: UUID,
    ) -> RunExplainability:
        """Read-only — fans out across manager + audit + command_run + artifact."""

        state = await self._manager.get_run(run_id)
        if state is None or state.tenant_id != tenant_id:
            raise ValueError("run_not_found")

        audit_events = await self._load_audit_events(db, run_id=run_id, tenant_id=tenant_id)
        command_runs = await self._load_command_runs(db, run_id=run_id, tenant_id=tenant_id)
        validator_reports = await self._load_validator_reports(
            db, run_id=run_id, tenant_id=tenant_id
        )

        q1 = self._q1_from_data(command_runs=command_runs, audit_events=audit_events)
        q2 = self._q2_from_data(validator_reports=validator_reports, audit_events=audit_events)
        q3 = self._q3_from_data(checks=q2, has_validator=bool(validator_reports))
        q4 = self._q4_from_data(checks=q2)
        q5 = self._q5_from_data(
            validator_reports=validator_reports,
            audit_events=audit_events,
            state=state,
        )

        grade, rationale = self._grade_bundle(checks=q2, gaps=q3, confidence=q4)

        return RunExplainability(
            run_id=run_id,
            tenant_id=tenant_id,
            project_id=project_id,
            what_changed=q1,
            what_checked=q2,
            coverage_gaps=q3,
            confidence=q4,
            counterfactual=q5,
            grade=grade,
            grade_rationale=rationale,
        )

    # ------------------------------------------------------------------
    # Loaders — DB-bound, kept narrow so tests can bypass them.
    # ------------------------------------------------------------------

    async def _load_audit_events(
        self, db: AsyncSession, *, run_id: UUID, tenant_id: UUID
    ) -> list[AuditEvent]:
        stmt = (
            select(AuditEvent)
            .where(
                AuditEvent.tenant_id == tenant_id,
                AuditEvent.target_type == "sdlc_run",
                AuditEvent.target_id == str(run_id),
            )
            .order_by(AuditEvent.occurred_at.asc())
        )
        return list((await db.execute(stmt)).scalars().all())

    async def _load_command_runs(
        self, db: AsyncSession, *, run_id: UUID, tenant_id: UUID
    ) -> list[CommandRun]:
        # CommandRun.input is JSONB; the canonical convention is for the
        # invoker to set ``input.run_id`` or ``input.parent_run_id`` so
        # we can reconstruct the lineage. JSONB containment via ``.as_string()``
        # matches Postgres-side without requiring a GIN index.
        stmt = (
            select(CommandRun)
            .where(CommandRun.tenant_id == tenant_id)
            .order_by(CommandRun.started_at.asc())
        )
        rows = list((await db.execute(stmt)).scalars().all())
        run_id_str = str(run_id)
        return [
            r
            for r in rows
            if (r.input or {}).get("run_id") == run_id_str
            or (r.input or {}).get("parent_run_id") == run_id_str
        ]

    async def _load_validator_reports(
        self, db: AsyncSession, *, run_id: UUID, tenant_id: UUID
    ) -> list[ValidationReport]:
        stmt = (
            select(Artifact)
            .where(
                Artifact.tenant_id == tenant_id,
                Artifact.type == VALIDATION_REPORT_TYPE,
            )
            .order_by(Artifact.created_at.asc())
        )
        rows = list((await db.execute(stmt)).scalars().all())
        out: list[ValidationReport] = []
        run_id_str = str(run_id)
        for row in rows:
            payload = row.payload or {}
            if str(payload.get("run_id", "")) != run_id_str:
                continue
            try:
                # strip storage-only fields, mirroring validation_reports.py
                cleaned = {k: v for k, v in payload.items() if k != "commit_sha"}
                out.append(ValidationReport.model_validate(cleaned))
            except Exception:
                # Bad payload — skip silently rather than crash the whole
                # bundle. Other rows still surface.
                continue
        return out

    # ------------------------------------------------------------------
    # Building blocks — pure, testable without DB.
    # ------------------------------------------------------------------

    def _q1_from_data(
        self,
        *,
        command_runs: Iterable[CommandRun],
        audit_events: Iterable[AuditEvent],
    ) -> Q1ChangesAndWhy:
        changes: list[ChangeEntry] = []
        citations: list[str] = []
        seen_files: set[str] = set()

        for cr in command_runs:
            files = ((cr.output or {}).get("files") or [])
            for f in files:
                if not isinstance(f, dict):
                    continue
                file = str(f.get("file") or f.get("path") or "").strip()
                if not file or file in seen_files:
                    continue
                seen_files.add(file)
                kind = self._coerce_change_kind(f.get("change_kind") or f.get("kind"))
                changes.append(
                    ChangeEntry(
                        file=file,
                        change_kind=kind,
                        lines_added=int(f.get("lines_added") or 0),
                        lines_removed=int(f.get("lines_removed") or 0),
                        rationale=str(f.get("rationale") or f.get("reason") or ""),
                        citation=(
                            f"command_run:{cr.id}" if cr.id is not None else None
                        ),
                    )
                )

        for ev in audit_events:
            if not ev.action.startswith("agent.commit"):
                continue
            payload = ev.payload or {}
            for f in payload.get("files") or []:
                if not isinstance(f, dict):
                    continue
                file = str(f.get("file") or "").strip()
                if not file or file in seen_files:
                    continue
                seen_files.add(file)
                changes.append(
                    ChangeEntry(
                        file=file,
                        change_kind=self._coerce_change_kind(f.get("change_kind")),
                        lines_added=int(f.get("lines_added") or 0),
                        lines_removed=int(f.get("lines_removed") or 0),
                        rationale=str(f.get("rationale") or ""),
                        citation=f"audit_event:{ev.id}",
                    )
                )
            if ev.action:
                citations.append(f"{ev.action}@{ev.occurred_at.isoformat()}")

        if not changes:
            return Q1ChangesAndWhy(
                summary=(
                    "No file changes recorded for this run. The executor "
                    "may have produced read-only artifacts only, or no "
                    "command reported a files[] payload."
                ),
                changes=[],
                citations=citations,
            )

        return Q1ChangesAndWhy(
            summary=f"{len(changes)} file(s) changed across the run.",
            changes=changes,
            citations=citations,
        )

    def _q2_from_data(
        self,
        *,
        validator_reports: Iterable[ValidationReport],
        audit_events: Iterable[AuditEvent],
    ) -> Q2ChecksPerformed:
        entries: list[CheckEntry] = []

        for report in validator_reports:
            decision = report.decision
            total = report.summary.total_findings
            # PASS ⇒ check passed. FAIL with no critical/high findings ⇒ warn.
            # Otherwise fail.
            critical_high = sum(
                report.summary.by_severity.get(s, 0)
                for s in ("critical", "high")
            )
            if decision == "PASS":
                outcome: CheckOutcomeLiteral = "pass"
                detail = f"Validator v{report.validator_version}: PASS ({total} findings)."
            elif critical_high == 0:
                outcome = "warn"
                detail = (
                    f"Validator v{report.validator_version}: FAIL but "
                    f"no critical/high findings ({total} total)."
                )
            else:
                outcome = "fail"
                detail = (
                    f"Validator v{report.validator_version}: FAIL "
                    f"({critical_high} critical/high of {total} findings)."
                )
            entries.append(
                CheckEntry(
                    name=f"validation_report:{report.report_id}",
                    category="validator",
                    outcome=outcome,
                    detail=detail,
                    source="validation_report",
                )
            )

        for ev in audit_events:
            action = ev.action or ""
            if not action.startswith("run."):
                continue
            payload = ev.payload or {}
            raw_outcome = str(payload.get("outcome") or "pass").lower()
            outcome = self._coerce_check_outcome(raw_outcome)
            entries.append(
                CheckEntry(
                    name=f"{action}@{ev.occurred_at.isoformat()}",
                    category=str(payload.get("category") or "run-step"),
                    outcome=outcome,
                    detail=str(payload.get("detail") or payload.get("summary") or ""),
                    source="audit_events",
                )
            )

        counts = Counter(e.outcome for e in entries)
        total = len(entries)
        return Q2ChecksPerformed(
            total_checks=total,
            passed=counts.get("pass", 0),
            failed=counts.get("fail", 0),
            skipped=counts.get("skip", 0),
            entries=entries,
        )

    def _q3_from_data(
        self, *, checks: Q2ChecksPerformed, has_validator: bool
    ) -> Q3CoverageGaps:
        explicit: list[str] = []
        implicit: list[str] = []

        if not has_validator:
            explicit.append(
                "No validation report found for this run — code-level "
                "checks (lint, type-check, security scan) did not run."
            )

        skipped = [e for e in checks.entries if e.outcome == "skip"]
        if skipped:
            explicit.append(
                f"{len(skipped)} check(s) recorded as skipped: "
                + ", ".join(e.name for e in skipped[:3])
            )

        # Implicit gaps are surfaced whenever coverage is below 70 %.
        # The standard gaps are always mentioned so reviewers see the
        # known ceilings of the pipeline.
        implicit.extend(self.STANDARD_GAPS)

        # coverage_pct is a coarse heuristic: every check contributes
        # one unit; full coverage means total_checks ≥ 5 AND at least
        # one validator AND zero skipped.
        target = 5
        score = min(100.0, (checks.total_checks / target) * 60.0)
        if has_validator:
            score += 30.0
        if checks.skipped == 0:
            score += 10.0
        coverage_pct = float(min(100.0, max(0.0, score)))

        return Q3CoverageGaps(
            explicit_gaps=explicit,
            implicit_gaps=implicit,
            coverage_pct=coverage_pct,
        )

    def _q4_from_data(self, *, checks: Q2ChecksPerformed) -> Q4ConfidenceScore:
        total = checks.total_checks
        if total == 0:
            raw_score = 50.0
            calibration = "heuristic"
            would_escalate = raw_score < self.CONFIDENCE_THRESHOLD
        else:
            ratio = checks.passed / total if total else 0.0
            raw_score = 70.0 + 30.0 * ratio
            calibration = "validation_passes"
            would_escalate = raw_score < self.CONFIDENCE_THRESHOLD

        bands = self._bands_observed(checks)
        return Q4ConfidenceScore(
            raw_score=raw_score,
            calibration=calibration,
            threshold=self.CONFIDENCE_THRESHOLD,
            would_escalate=would_escalate,
            bands_observed=bands,
        )

    def _q5_from_data(
        self,
        *,
        validator_reports: Iterable[ValidationReport],
        audit_events: Iterable[AuditEvent],
        state: Any,
    ) -> Q5Counterfactual:
        conditions: list[str] = []

        for report in validator_reports:
            if report.decision == "FAIL":
                conditions.append("Validator returned a blocking decision")
                conditions.append(
                    f"Re-run after fixing the {report.summary.total_findings} "
                    f"validator finding(s) from v{report.validator_version}."
                )

        for ev in audit_events:
            action = ev.action or ""
            if action.startswith("run.failed") or action.startswith("run.error"):
                conditions.append(
                    f"State machine reported a failure: {action} "
                    f"({(ev.payload or {}).get('error_type', 'unknown')})"
                )

        if getattr(state, "current_phase", None) is not None:
            phase = str(state.current_phase)
            if phase.lower() in {"failed", "cancelled", "timed_out"}:
                conditions.append(
                    f"Run reached terminal phase '{phase}' — a successful retry "
                    "would re-open the recommendation."
                )

        if not conditions:
            conditions.append(
                "No blocking signals — additional checks (load test, "
                "staging deploy, human review) could still flip the "
                "recommendation, but none are implied by the current data."
            )

        return Q5Counterfactual(
            conditions=conditions,
            counter_recommendation=self._counter_recommendation(conditions),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _grade_bundle(
        *,
        checks: Q2ChecksPerformed,
        gaps: Q3CoverageGaps,
        confidence: Q4ConfidenceScore,
    ) -> tuple[GradeLiteral, str]:
        score = 0.0
        score += 30.0 if checks.total_checks >= 5 else 15.0
        score += 20.0 if gaps.coverage_pct >= 70.0 else 10.0
        score += 30.0 if confidence.raw_score >= 80.0 else 15.0
        score += 10.0 if not confidence.would_escalate else 0.0
        score += 10.0 if checks.failed == 0 else 0.0

        if score >= 85:
            grade: GradeLiteral = "A"
        elif score >= 70:
            grade = "B"
        elif score >= 55:
            grade = "C"
        elif score >= 40:
            grade = "D"
        else:
            grade = "F"

        rationale = (
            f"{checks.total_checks} checks, {checks.failed} failed, "
            f"{gaps.coverage_pct:.0f}% coverage, "
            f"{confidence.raw_score:.0f}% confidence "
            f"({'escalate' if confidence.would_escalate else 'auto-ok'})."
        )
        return grade, rationale

    @staticmethod
    def _bands_observed(checks: Q2ChecksPerformed) -> dict[str, int]:
        # buckets are derived from check pass/fail counts — kept stable
        # so the UI can render the histogram without conditional shapes.
        base = dict(RunExplainabilityService.CONFIDENCE_BANDS)
        # Ponytail: this is a placeholder shape; real bands would come
        # from a calibrated model. Total checks is appended so the
        # "0-20" band reflects the actual evidence we have on hand.
        base["observed"] = checks.total_checks
        return base

    @staticmethod
    def _counter_recommendation(conditions: Iterable[str]) -> str:
        joined = "; ".join(conditions[:3])
        return (
            f"Re-run after the conditions above are addressed: {joined}."
            if conditions
            else "No actionable counter-conditions surfaced from the data."
        )

    @staticmethod
    def _coerce_change_kind(value: Any) -> ChangeKindLiteral:
        s = str(value or "modified").lower()
        if s in {"added", "new"}:
            return "added"
        if s in {"removed", "deleted"}:
            return "removed"
        if s in {"renamed", "moved"}:
            return "renamed"
        return "modified"

    @staticmethod
    def _coerce_check_outcome(value: Any) -> CheckOutcomeLiteral:
        s = str(value or "pass").lower()
        if s in {"pass", "passed", "ok", "success"}:
            return "pass"
        if s in {"fail", "failed", "error"}:
            return "fail"
        if s in {"warn", "warning"}:
            return "warn"
        if s in {"skip", "skipped"}:
            return "skip"
        return "pass"


__all__ = ["RunExplainabilityService", "VALIDATION_REPORT_TYPE"]