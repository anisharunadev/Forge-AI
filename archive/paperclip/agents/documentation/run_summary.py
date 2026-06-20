"""Run-summary generator (FORA-362 / MVP-6.a).

Produces the terminal artefact of a Forge AI run: a single Markdown
document (`forge/docs/run_summary.md`) that tells a board-level reader
what was shipped, with audit-grade links to every prior stage artefact.

This generator **extends** the canonical Documentation Agent spec
(`forge/docs/prompt.md`, FORA-347) — it does not replace it. All hard
constraints from the parent spec apply: determinism, source
attribution, idempotency, cost ceiling, approval routing, and the
freshness timestamp + source SHA stamp on the artifact.

## Role in the pipeline

```
PRD → Architect → Dev → QA → Security → DevOps → [Docs / run_summary]   ← you are here
                                                 │
                                                 ▼
                                  run_summary.md (this generator)
                                                 │
                                  ┌──────────────┼──────────────┐
                                  ▼              ▼              ▼
                          workspace repo    Jira comment    Console panel
                          forge/docs/      (FORA-275        ("Run complete"
                          run_summary.md    envelope)        via §5 event)
```

The run ends at this stage. There is no downstream stage. The
artefact is the run's final state.

## Capabilities

1. **Run-summary generator** (`run_summary`) — produces one Markdown
   document that:
   - Names the source (one-line prompt or upstream Jira ticket).
   - Lists every prior stage's artefact with a stable link.
   - Carries a one-paragraph "What was shipped" summary derived from
     the prior stage artefacts (does not invent claims — quotes /
     paraphrases the most recent summary line from each prior stage
     artefact).
   - Carries `freshness_timestamp` + `source_run_sha` on the artefact.
   - Is idempotent: same `source_run_sha` + same stage artefact set →
     byte-identical output.

## Hard constraints (inherited + new)

Inherited from the parent doc-agent spec (one-way doors):

1. **Determinism.** Same `source_runSha` + same stage artefact set →
   same output bytes.
2. **Source attribution.** No artefact ships without
   `freshness_timestamp` + `source_run_sha`.
3. **Approval routing.** Run-summary is a *routine update* —
   auto-merge after generation. It is not an ADR, not a README
   rewrite, not a breaking-change note.
4. **Idempotency.** Re-running with the same `source_run_sha` +
   same stage artefact set must be a no-op or produce a byte-identical
   artefact.
5. **Cost ceiling.** 60k input / 20k output per run (tighter than the
   parent's 100k / 30k because the run-summary input is bounded by
   the run's stage count, typically ≤ 7).

New for `run_summary`:

6. **No invention.** The "What was shipped" paragraph is **derived**,
   not authored. Quotes or paraphrases the most recent summary line
   from each prior stage artefact. If a stage artefact is missing,
   writes `UNKNOWN — stage <id> artefact not provided` rather than
   guessing.
7. **No product docs.** This is a *run summary*, not a user-facing
   release note. Does not generate `CHANGELOG.md`, README, ADR, or
   API docs as side effects. The post-merge doc run is a separate,
   later trigger.
8. **English only for MVP.** No localisation in the run-summary
   output.

## Inputs

The Orchestrator (FORA-173) wakes the generator on
`sync.stage.approved.v1` (source=devops, decision=approve) with a
JSON payload matching `forge.docs.run_summary.input.v1`. The typed
shape is `RunSummaryInput` in `schemas.py`.

## Outputs

The generator emits a single artefact (`forge/docs/run_summary.md`)
wrapped in `RunSummaryOutput`. See `schemas.py` for the full schema.

## Side effects (deterministic order)

1. **Workspace write** — commit `forge/docs/run_summary.md` to the
   run's workspace. Idempotent on `source_run_sha`.
2. **Jira comment** — post the Markdown body as the final comment on
   the source ticket (FORA-275 envelope). Idempotent on
   `source_run_sha`.
3. **Console panel** — emit the
   `forge.run.{tenantId}.{runId}.artefact.doc` event. Idempotent on
   `content_sha`.
4. **Audit record** — write one `audit.doc_run` record.

All four side effects are idempotent on `source_run_sha`. Re-running
the same `source_run_sha` is a no-op (or produces a byte-identical
artefact + replayed comments + replayed events).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .schemas import (
    CostRecord,
    RunSummaryArtifact,
    RunSummaryError,
    RunSummaryErrorKind,
    RunSummaryInput,
    RunSummaryLinks,
    RunSummaryOutput,
    RunSummarySource,
    RunSummarySourceKind,
    RunSummaryStageEntry,
    RunSummaryStageStatus,
    OUTPUT_SCHEMA_VERSION,
    INPUT_SCHEMA_VERSION,
    now_iso,
)


# ---------------------------------------------------------------------------
# Constants — single source of truth for the artefact shape and the
# side-effect contract. Anything that the smoke test asserts on lives
# here so a contract drift is a single-line diff.
# ---------------------------------------------------------------------------

RUN_SUMMARY_PATH = "forge/docs/run_summary.md"
SIDEEFFECT_ORDER: Tuple[str, ...] = ("workspace", "jira", "console", "audit")

# The Jira base URL prefix used when a stage entry has a relative
# `artefact_url`. Real production paths use the `jira_base_url` from
# the run context; the smoke test stubs `https://example.atlassian.net`.
DEFAULT_JIRA_BASE_URL = "https://example.atlassian.net"

# Display name for the synthetic service account that posts the Jira
# comment on the doc-agent's behalf (per FORA-253 author mapping).
SERVICE_ACCOUNT_ID = "doc-agent"
SERVICE_ACCOUNT_DISPLAY_NAME = "DocAgent"

# Approximate tokens per character for the pre-flight cost ceiling check.
# The parent spec uses a similar heuristic (`len(c.message) // 4`); we
# apply the same to stage summaries + the rendered prompt.
_APPROX_CHARS_PER_TOKEN = 4

# Maximum words in the "What was shipped" paragraph (parent spec cap).
WHAT_SHIPPED_WORD_CAP = 200

# Maximum characters per row's Summary column (parent spec cap).
ROW_SUMMARY_CHAR_CAP = 200


# ---------------------------------------------------------------------------
# Side-effect interfaces — abstract enough for the smoke test to stub
# and concrete enough that production code can wire MCP clients in.
# ---------------------------------------------------------------------------


@dataclass
class RunSummarySideEffects:
    """The four side-effect surfaces the generator calls.

    Each surface is a callable with a deterministic signature; the
    defaults are in-memory stubs used by the smoke test. Production
    wiring passes real Jira MCP / event-bus / audit-MCP / workspace-FS
    clients. The generator records the **order** in which each was
    invoked via `invoked_order[]` so the smoke test can assert the
    ordering invariant.
    """

    workspace_writer: Callable[[str, str], None] = None
    jira_poster: Callable[[str, str, str], str] = None
    console_publisher: Callable[[Dict[str, Any]], None] = None
    audit_writer: Callable[[Dict[str, Any]], None] = None
    invoked_order: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Defaults are in-memory stubs. The smoke test uses these to
        # verify order + idempotency without touching the filesystem or
        # network.
        if self.workspace_writer is None:
            self.workspace_writer = self._default_workspace_writer
        if self.jira_poster is None:
            self.jira_poster = self._default_jira_poster
        if self.console_publisher is None:
            self.console_publisher = self._default_console_publisher
        if self.audit_writer is None:
            self.audit_writer = self._default_audit_writer

    # -- default stubs (the smoke test uses these) ---------------------

    def _default_workspace_writer(self, path: str, content: str) -> None:
        self.invoked_order.append("workspace")
        # In-memory: stash under `_workspace_writes` for assertions.
        self.__dict__.setdefault("_workspace_writes", {})[path] = content

    def _default_jira_poster(self, ticket: str, body: str, idempotency_key: str) -> str:
        self.invoked_order.append("jira")
        # Return a deterministic comment_id for the idempotency-key.
        self.__dict__.setdefault("_jira_comments", {})[idempotency_key] = (ticket, body)
        return hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()

    def _default_console_publisher(self, event: Dict[str, Any]) -> None:
        self.invoked_order.append("console")
        self.__dict__.setdefault("_console_events", {})[event["artefactId"]] = event

    def _default_audit_writer(self, record: Dict[str, Any]) -> None:
        self.invoked_order.append("audit")
        self.__dict__.setdefault("_audit_records", []).append(record)


# ---------------------------------------------------------------------------
# Pure helpers — no I/O, no clock. Tested in the smoke test.
# ---------------------------------------------------------------------------


def _excerpt(text: str, char_cap: int = ROW_SUMMARY_CHAR_CAP) -> str:
    """Return a single-line excerpt of `text`, capped at `char_cap`.

    Newlines and runs of whitespace are collapsed to a single space.
    Used to populate the "Summary" column of the run summary's Stages
    table (parent spec caps at 200 chars).
    """
    if text is None:
        return ""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= char_cap:
        return cleaned
    return cleaned[: char_cap - 1].rstrip() + "…"


def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text or ""))


def _approximate_input_tokens(inp: RunSummaryInput) -> int:
    """Pre-LLM-call cost ceiling check.

    Returns the approximate token count the LLM call would consume
    given the stage summaries + the rendered prompt. The check is
    deliberately conservative — over-estimating is a safe direction
    (refuse when we shouldn't have) but under-estimating would breach
    the cost ceiling.
    """
    chars = 0
    for s in inp.stages:
        chars += len(s.stage_id or "")
        chars += len(s.summary or "")
        chars += len(s.artefact_url or "")
    if inp.source:
        chars += len(inp.source.ref or "")
        chars += len(inp.source.one_line_prompt or "")
    # Plus the prompt contract itself (a few thousand chars worst case).
    chars += 4000
    return chars // _APPROX_CHARS_PER_TOKEN


def _derive_what_was_shipped(inp: RunSummaryInput) -> str:
    """Derive the "What was shipped" paragraph.

    Resolution order (parent spec §"Artefact shape"):

    1. The final stage's `summary` if the final stage is `devops` and
       its status is `ok` (quote / paraphrase).
    2. Otherwise, the most recent prior stage whose `status == "ok"`
       and whose `summary` is non-empty.
    3. Otherwise, `UNKNOWN — final stage devops did not complete
       successfully; see stage summary below.`

    The output is capped at `WHAT_SHIPPED_WORD_CAP` words.
    """
    stages = inp.stages or []
    if not stages:
        return (
            "UNKNOWN — final stage devops did not complete successfully; "
            "see stage summary below."
        )
    final = stages[-1]
    if (
        final.stage_id == "devops"
        and final.status == RunSummaryStageStatus.OK
        and final.summary
    ):
        text = final.summary.strip()
    else:
        # Fall back to the most recent prior stage that succeeded.
        for s in reversed(stages):
            if s.status == RunSummaryStageStatus.OK and s.summary:
                text = s.summary.strip()
                break
        else:
            return (
                "UNKNOWN — final stage devops did not complete successfully; "
                "see stage summary below."
            )
    words = text.split()
    if len(words) > WHAT_SHIPPED_WORD_CAP:
        text = " ".join(words[:WHAT_SHIPPED_WORD_CAP]).rstrip(",;:.") + "…"
    return text


def _render_stages_table(inp: RunSummaryInput) -> List[str]:
    """Render the Stages table rows (no header, no separator).

    The header + separator are added by `_render_markdown`. Rows are
    rendered in pipeline order; the `docs` stage is excluded (it
    would be circular per parent spec §"Input contract").
    """
    rows: List[str] = []
    idx = 0
    for s in inp.stages:
        if s.stage_id == "docs":
            # The doc-agent's own stage is not in the run summary —
            # we are that stage. Skip.
            continue
        idx += 1
        status = s.status.value if isinstance(s.status, RunSummaryStageStatus) else s.status
        artefact_kind = s.artefact_kind or "artefact"
        artefact_url = s.artefact_url or ""
        # Render the artefact link as Markdown. If no URL, render the
        # artefact_kind in backticks so the row is still valid Markdown.
        if artefact_url:
            artefact_cell = f"[{artefact_kind}]({artefact_url})"
        else:
            artefact_cell = f"`{artefact_kind}`"
        summary_cell = _excerpt(s.summary or "")
        rows.append(f"| {idx} | {s.stage_id} | {status} | {artefact_cell} | {summary_cell} |")
    return rows


def _render_links_section(inp: RunSummaryInput) -> List[str]:
    """Render the Links section, omitting the Repo line if `repo` is null."""
    lines: List[str] = ["## Links", ""]
    links = inp.links
    if links is None:
        return lines
    if links.console:
        lines.append(f"- **Console:** [run {inp.run_id}]({links.console})")
    if links.jira_ticket:
        # No `prefix` available here (we are a library, not a service);
        # use a placeholder `FORA` that the production caller can
        # rewrite. The smoke test asserts on shape, not on the prefix.
        lines.append(
            f"- **Jira:** [{links.jira_ticket}](/FORA/issues/{links.jira_ticket})"
        )
    if links.repo:
        lines.append(f"- **Repo:** [{links.repo}]({links.repo})")
    return lines


def _render_source_section(inp: RunSummaryInput) -> List[str]:
    """Render the Source section."""
    lines = ["## Source", ""]
    if inp.source:
        kind_value = (
            inp.source.kind.value
            if isinstance(inp.source.kind, RunSummarySourceKind)
            else inp.source.kind
        )
        lines.append(f"- **Kind:** `{kind_value}`")
        # Source ref link — if the source is a Jira issue, link it; else
        # render the ref in backticks.
        if inp.source.kind == RunSummarySourceKind.JIRA_ISSUE:
            lines.append(
                f"- **Ref:** [{inp.source.ref}](/FORA/issues/{inp.source.ref})"
            )
        else:
            lines.append(f"- **Ref:** `{inp.source.ref}`")
        prompt = inp.source.one_line_prompt or "not provided"
        # Escape any embedded backticks in the prompt.
        prompt_escaped = prompt.replace("`", "'")
        lines.append(f'- **One-line prompt:** "{prompt_escaped}"')
    return lines


def render_run_summary_markdown(inp: RunSummaryInput, freshness_timestamp: str) -> str:
    """Pure renderer — takes `inp` + a fixed `freshness_timestamp`,
    returns the Markdown body for `forge/docs/run_summary.md`.

    Pure (no I/O, no clock). The caller is responsible for supplying
    `freshness_timestamp` so a re-run with the same input SHA produces
    the same bytes. The smoke test calls this directly to assert
    byte-identical re-runs.
    """
    status_value = "ok"
    source_run_sha = inp.source_run_sha or ""
    lines: List[str] = [
        f"# Run summary — {(inp.source.ref if inp.source else 'unknown')} (run {inp.run_id})",
        "",
        f"> **Status:** {status_value} · **Source run SHA:** `{source_run_sha}` · "
        f"**Generated:** {freshness_timestamp}",
        "",
        "## What was shipped",
        "",
        _derive_what_was_shipped(inp),
        "",
    ]
    lines.extend(_render_source_section(inp))
    lines.append("")
    lines.append("## Stages")
    lines.append("")
    lines.append("| # | Stage | Status | Artefact | Summary |")
    lines.append("|---|-------|--------|----------|---------|")
    lines.extend(_render_stages_table(inp))
    lines.append("")
    lines.extend(_render_links_section(inp))
    lines.append("")
    lines.append("---")
    lines.append("")
    # Audit footer — never omitted. The artefact self-declares its
    # provenance here (parent spec §"Artefact shape").
    lines.append(
        f"_Generated by `doc-agent` (run_summary generator) · "
        f"`freshness_timestamp` = {freshness_timestamp} · "
        f"`source_sha` = `{source_run_sha}` · "
        f"`cost_record` = "
        f"{{model: {inp.model}, tokens_in: ?, tokens_out: ?, usd: ?, fallback_used: ?}}_"
    )
    # Trailing newline — most editors expect it.
    if not lines[-1].endswith("\n"):
        lines[-1] = lines[-1] + "\n"
    return "\n".join(lines)


def compute_idempotency_key(inp: RunSummaryInput, suffix: str) -> str:
    """Per spec: `sha256(tenantId | runId | "<suffix>" | sourceRunSha)`.

    Used for both the wake idempotency key and the Jira comment's
    `Idempotency-Key` header. The smoke test asserts on this exact
    shape — any drift is a contract regression.
    """
    parts = [inp.tenant_id or "", inp.run_id or "", suffix, inp.source_run_sha or ""]
    joined = "|".join(parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Generator — owns I/O via the injected side-effect clients.
# ---------------------------------------------------------------------------


class RunSummaryGenerator:
    """Run-summary generator.

    Stateless apart from the injected side-effect clients. The smoke
    test instantiates one with the default in-memory `RunSummarySideEffects`
    and asserts on ordering + idempotency. Production code wires the
    real Jira MCP / event-bus / audit MCP clients.
    """

    def __init__(
        self,
        side_effects: Optional[RunSummarySideEffects] = None,
        # `clock` is injectable so the smoke test can pin the
        # `freshness_timestamp` for byte-identical re-runs.
        clock: Callable[[], str] = now_iso,
        # `cost_recorder` returns the cost_record for the run. The
        # default records zero tokens (the run-summary generator's
        # primary work is deterministic rendering, not an LLM call);
        # the smoke test injects a real-ish recorder.
        cost_recorder: Optional[Callable[[RunSummaryInput], CostRecord]] = None,
    ) -> None:
        self.side_effects = side_effects or RunSummarySideEffects()
        self.clock = clock
        self.cost_recorder = cost_recorder or self._default_cost_recorder

    def _default_cost_recorder(self, inp: RunSummaryInput) -> CostRecord:
        # Deterministic placeholder for tests; production code wires a
        # real recorder that reports the actual LLM tokens consumed.
        prompt_hash = hashlib.sha256(INPUT_SCHEMA_VERSION.encode("utf-8")).hexdigest()
        return CostRecord(
            prompt_hash=prompt_hash,
            model=inp.model,
            tokens_in=0,
            tokens_out=0,
            usd=0.0,
            duration_ms=0,
            fallback_used=False,
        )

    # -- public API -----------------------------------------------------

    def run(self, inp: RunSummaryInput) -> RunSummaryOutput:
        """Run end-to-end. Returns a `RunSummaryOutput`.

        Order of operations:

        1. Validate the input (MISSING_INPUT_SHA, EMPTY_STAGES,
           OVERSIZED_INPUT).
        2. Render the Markdown (pure).
        3. Side effects in fixed order: workspace → Jira → console →
           audit. Non-fatal side-effect failures abort *that* side
           effect only and surface in `errors[]`; the run stays
           `status = "ok"`.
        4. Build the output envelope.
        """
        started = time.monotonic()

        # 1. Pre-flight: input validation.
        fatal_errors: List[RunSummaryError] = []
        input_errs = inp.validate()
        if input_errs:
            for msg in input_errs:
                if "sourceRunSha" in msg:
                    fatal_errors.append(RunSummaryError(
                        kind=RunSummaryErrorKind.MISSING_INPUT_SHA,
                        message=msg,
                        recoverable=False,
                    ))
                elif "stages" in msg:
                    fatal_errors.append(RunSummaryError(
                        kind=RunSummaryErrorKind.EMPTY_STAGES,
                        message=msg,
                        recoverable=False,
                    ))
                else:
                    fatal_errors.append(RunSummaryError(
                        kind=RunSummaryErrorKind.MISSING_INPUT_SHA,
                        message=msg,
                        recoverable=False,
                    ))
        else:
            # Cost ceiling pre-flight (non-fatal — surfaces as a
            # structured warning per parent spec).
            approx = _approximate_input_tokens(inp)
            if approx > inp.cost_envelope["per_run_tokens_in"]:
                fatal_errors.append(RunSummaryError(
                    kind=RunSummaryErrorKind.OVERSIZED_INPUT,
                    message=(
                        f"expanded input ~{approx} tokens > "
                        f"per_run_tokens_in={inp.cost_envelope['per_run_tokens_in']}; "
                        "drop stage summaries beyond the last 7"
                    ),
                    recoverable=True,
                    retry_after_seconds=0,
                ))

        if fatal_errors:
            # Fatal errors abort the run with status="aborted".
            is_fatal = any(
                e.kind in {
                    RunSummaryErrorKind.MISSING_INPUT_SHA,
                    RunSummaryErrorKind.EMPTY_STAGES,
                    RunSummaryErrorKind.MODEL_TIMEOUT,
                }
                for e in fatal_errors
            )
            return RunSummaryOutput(
                run_id=inp.run_id,
                source_run_sha=inp.source_run_sha or "",
                status="aborted" if is_fatal else "ok",
                artefacts=[],
                cost_record=self.cost_recorder(inp),
                errors=fatal_errors,
            )

        # 2. Render the artefact (pure).
        freshness = self.clock()
        body = render_run_summary_markdown(inp, freshness_timestamp=freshness)
        content_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
        artefact = RunSummaryArtifact(
            path=RUN_SUMMARY_PATH,
            content=body,
            content_sha=content_sha,
            freshness_timestamp=freshness,
            source_sha=inp.source_run_sha or "",
            generator_type="run_summary",
            approval_required=False,  # routine update per parent spec
        )

        # 3. Side effects in fixed order. Each is idempotent on
        #    `source_run_sha`; a non-fatal failure surfaces in
        #    `errors[]` but does not abort the run.
        side_effect_errors: List[RunSummaryError] = []

        # 3a. Workspace write.
        try:
            self.side_effects.workspace_writer(RUN_SUMMARY_PATH, body)
        except Exception as exc:  # noqa: BLE001 — surface as typed error
            side_effect_errors.append(RunSummaryError(
                kind=RunSummaryErrorKind.WORKSPACE_WRITE_FAILED if hasattr(RunSummaryErrorKind, "WORKSPACE_WRITE_FAILED") else RunSummaryErrorKind.JIRA_POST_FAILED,
                message=f"workspace write failed: {exc}",
                recoverable=True,
                retry_after_seconds=10,
            ))

        # 3b. Jira comment (only if we have a ticket ref).
        comment_id: Optional[str] = None
        if inp.source and inp.source.kind == RunSummarySourceKind.JIRA_ISSUE:
            try:
                idem_key = compute_idempotency_key(inp, suffix="docs-comment")
                comment_id = self.side_effects.jira_poster(
                    ticket=inp.source.ref,
                    body=body,
                    idempotency_key=idem_key,
                )
            except Exception as exc:  # noqa: BLE001
                side_effect_errors.append(RunSummaryError(
                    kind=RunSummaryErrorKind.JIRA_POST_FAILED,
                    message=f"Jira post failed: {exc}",
                    recoverable=True,
                    retry_after_seconds=30,
                ))

        # 3c. Console event.
        try:
            event_payload: Dict[str, Any] = {
                "runId": inp.run_id,
                "tenantId": inp.tenant_id,
                "stageId": "docs",
                "artefactKind": "doc",
                "artefactId": content_sha,
                "summary": _derive_what_was_shipped(inp),
                "url": RUN_SUMMARY_PATH,
                "contentType": "text/markdown",
                "publishedAt": freshness,
            }
            self.side_effects.console_publisher(event_payload)
        except Exception as exc:  # noqa: BLE001
            side_effect_errors.append(RunSummaryError(
                kind=RunSummaryErrorKind.CONSOLE_EVENT_FAILED,
                message=f"console event failed: {exc}",
                recoverable=True,
                retry_after_seconds=10,
            ))

        # 3d. Audit record (last).
        cost = self.cost_recorder(inp)
        try:
            self.side_effects.audit_writer({
                "runId": inp.run_id,
                "sourceRunSha": inp.source_run_sha,
                "content_sha": content_sha,
                "generator_type": "run_summary",
                "cost_record": cost,
                "side_effects": list(self.side_effects.invoked_order),
                "comment_id": comment_id,
                "warnings": [],
                "errors": [e.to_dict() for e in side_effect_errors],
            })
        except Exception as exc:  # noqa: BLE001
            # Audit failure is non-fatal — surface and continue. The
            # parent spec marks AUDIT_WRITE_FAILED as an alert, not an
            # abort.
            side_effect_errors.append(RunSummaryError(
                kind=RunSummaryErrorKind.CONSOLE_EVENT_FAILED,  # reuse
                message=f"audit write failed: {exc}",
                recoverable=True,
                retry_after_seconds=60,
            ))

        # 4. Build the output envelope.
        # Tick `duration_ms` on the default cost recorder so the smoke
        # test can verify non-zero wall clock on the path.
        if cost.duration_ms == 0:
            cost.duration_ms = int((time.monotonic() - started) * 1000)

        # Non-fatal side-effect failures do not flip status to aborted.
        # We only flip on a fatal error from step 1.
        has_fatal = any(
            e.kind in {
                RunSummaryErrorKind.MISSING_INPUT_SHA,
                RunSummaryErrorKind.EMPTY_STAGES,
                RunSummaryErrorKind.MODEL_TIMEOUT,
            }
            for e in side_effect_errors
        )

        return RunSummaryOutput(
            run_id=inp.run_id,
            source_run_sha=inp.source_run_sha or "",
            status="aborted" if has_fatal else "ok",
            artefacts=[artefact],
            cost_record=cost,
            errors=side_effect_errors,
        )


# ---------------------------------------------------------------------------
# High-level entry point — produce a RunSummaryOutput from a payload
# dict. Mirrors `run_changelog` / `run_readme` in the existing
# generators. The Orchestrator can call either `generator.run(inp)`
# directly or `run_run_summary(payload_dict)` from the wake handler.
# ---------------------------------------------------------------------------


def _coerce_input(payload: Dict[str, Any]) -> RunSummaryInput:
    """Coerce a raw JSON payload dict into a typed `RunSummaryInput`.

    Pure (no I/O). The smoke test round-trips a sample payload through
    this function to assert the contract.
    """
    source_dict = payload.get("source") or {}
    source = RunSummarySource(
        kind=RunSummarySourceKind(source_dict["kind"]),
        ref=source_dict.get("ref", ""),
        one_line_prompt=source_dict.get("oneLinePrompt"),
    ) if source_dict else None

    links_dict = payload.get("links") or {}
    links = RunSummaryLinks(
        console=links_dict.get("console", ""),
        jira_ticket=links_dict.get("jiraTicket"),
        repo=links_dict.get("repo"),
    ) if links_dict else None

    stages: List[RunSummaryStageEntry] = []
    for s in payload.get("stages", []):
        approved_by = s.get("approvedBy") or {}
        stages.append(RunSummaryStageEntry(
            stage_id=s["stageId"],
            stage_run_id=s.get("stageRunId", ""),
            agent_id=s.get("agentId", ""),
            status=RunSummaryStageStatus(s.get("status", "ok")),
            artefact_kind=s.get("artefactKind", ""),
            artefact_id=s.get("artefactId"),
            artefact_url=s.get("artefactUrl", ""),
            summary=s.get("summary"),
            approved_at=s.get("approvedAt", ""),
            approved_by_type=approved_by.get("type", "system"),
            approved_by_id=approved_by.get("id", ""),
            approved_by_display_name=approved_by.get("displayName", ""),
        ))

    cost_envelope = payload.get("cost_envelope") or {
        "per_run_tokens_in": 60_000,
        "per_run_tokens_out": 20_000,
    }

    return RunSummaryInput(
        schema=payload.get("schema", INPUT_SCHEMA_VERSION),
        tenant_id=payload.get("tenantId", ""),
        run_id=payload.get("runId", ""),
        source_run_sha=payload.get("sourceRunSha"),
        source=source,
        stages=stages,
        links=links,
        cost_envelope=cost_envelope,
        model=payload.get("model", "claude-sonnet-4-6"),
        fallback_model=payload.get("fallback_model", "gemini-2.5-pro"),
        timeout_ms=payload.get("timeout_ms", 30_000),
    )


def run_run_summary(
    payload: Dict[str, Any],
    side_effects: Optional[RunSummarySideEffects] = None,
    clock: Callable[[], str] = now_iso,
    cost_recorder: Optional[Callable[[RunSummaryInput], CostRecord]] = None,
) -> RunSummaryOutput:
    """High-level entry: coerce payload → run generator → return output.

    `payload` matches `forge.docs.run_summary.input.v1`.
    """
    inp = _coerce_input(payload)
    gen = RunSummaryGenerator(
        side_effects=side_effects,
        clock=clock,
        cost_recorder=cost_recorder,
    )
    return gen.run(inp)