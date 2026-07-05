# Step 64 — Explainability + Slack Agent + Knowledge Loop

> **Status:** in-progress
> **Last classified:** 2026-07-05
> **Note:** Explainability + Slack Agent + Knowledge Loop (Ready to run, 3-step bundle — Explainability first)

> **Workspace:** `forge-ai`
> **Duration estimate:** ~2-3 weeks for the full bundle, ~1 week for Explainability alone
> **Phase:** CodeRabbit Agentic SDLC mapping — closes the 4 framework gaps
> **Source mapping:** `docs/research/coderabbit-agentic-sdlc-mapping.md`

## /goal

This step closes **three of the four framework gaps** CodeRabbit's "agentic SDLC" guide calls out, while leaving the fourth (vendor integration — GitHub/Slack/Linear/etc.) as an out-of-scope follow-up.

Three sub-steps in this bundle (run in order, ship each before starting the next):

1. **Sub-step A — Run-level explainability panel (5 questions)** → ~1 week
2. **Sub-step B — Knowledge feedback loop (skill promotion from post-rollback signals)** → ~1 week
3. **Sub-step C — Slack agent MVP (Socket Mode listener → forge-core command execution)** → ~2 weeks

Sub-step A is the **priority** and the only one you must ship before moving on. B and C are independent — if you only have one week, ship A and stop.

---

## /context (read these first)

Before writing anything, read in this order:

1. **`/workspace/docs/research/coderabbit-agentic-sdlc-mapping.md`** — the mapping doc that motivated this work. Skip past the executive summary if you've already read it; the "5 explainability questions" section in particular must be understood before writing Q1-Q5 code.
2. **`/workspace/docs/features/runs.md`** — existing Runs Center documentation. Sub-step A adds a new tab here, not a new feature.
3. **`backend/app/api/v1/runs.py`** (existing routes) — Sub-step A appends one route to this file. Don't restructure existing endpoints.
4. **`backend/app/services/sdlc_run_manager.py`** — the canonical run state source. The explainability service composes from this, never duplicates state.
5. **`backend/app/db/models/audit.py`** — `AuditEvent` table; the Q2 ("what did you check") answers come from here.
6. **`apps/forge/components/workflows/WorkflowRunDetail.tsx`** — current run-detail UI. Sub-step A adds a fifth tab to this view.
7. **`/workspace/prompts/step57p5-dashboard-real.md`** — see the **/goal, files to read first, zone structure, constraints, deliverable** format. This prompt follows the same shape.
8. **`/workspace/prompts/step61-onboarding-real.md`**, **`/workspace/prompts/step62-settings-real.md`** — same prompt shape, more complete examples.

The CodeRabbit mapping doc is the spec. **Do not re-derive the 5 questions or the 3 delivery models from the guide** — they're already extracted there. Re-reading them in the source risks you deciding CodeRabbit was right when they were partially wrong. The mapping doc already filtered out the marketing.

---

# SUB-STEP A — Run-level Explainability Panel

> **Source mapping:** Action 2 in `/workspace/docs/research/coderabbit-agentic-sdlc-mapping.md`
> **Effort:** ~1 week
> **Owner:** 1 engineer
> **Grading we currently get:** C+ (1.5/5 strong, 2.5/5 partial, 1/5 missing)
> **Grading we ship:** A (5/5 complete, with a clear panel + an overall letter grade)

## /goal-a

Compute and surface the **CodeRabbit 5-question explainability bundle** for every run. The endpoint reads existing tables (`SDLCRunState`, `AuditEvent`, `Artifact[type=validation_report]`, `CommandRun`) — **no schema migration required**.

The panel must answer:

| # | Question | Where the data lives |
|---|---|---|
| Q1 | What did you change and why? | `CommandRun.output.files[]` + `AuditEvent[action^=agent.commit].payload` |
| Q2 | What did you check? | `Artifact[type=validation_report].payload.findings[]` + `AuditEvent[action^=run.%]` |
| Q3 | What did you NOT check? | derived: when Q1+Q2 evidence is sparse, surface from `STANDARD_GAPS` constant |
| Q4 | Confidence + calibration | derived heuristic: `pass_ratio → 70 + 30*ratio` (initially) |
| Q5 | What would change your recommendation? | derived from `validator decision` + state-machine failures |

## Files to read FIRST (sub-step A specific)

- `backend/app/schemas/sdlc.py` — `SDLCRunStateResponse` (already has `phase_history`, `artifacts`, `errors`, `cost_so_far`)
- `backend/app/services/sdlc_run_manager.py` — `SDLCRunManager.get_run()` returns `SDLCState | None`
- `backend/app/db/models/audit.py` — `AuditEvent` schema
- `backend/app/db/models/command_run.py` — `CommandRun` schema (input/output JSONB)
- `backend/app/db/models/artifact.py` — `Artifact` (validation reports are stored here as `type="validation_report"`)
- `backend/app/schemas/validation_report.py` — `ValidationReport`, `ValidationFinding`, `DecisionLiteral`
- `backend/app/api/v1/validation_reports.py` — `VALIDATION_REPORT_TYPE = "validation_report"`
- `apps/forge/components/workflows/WorkflowRunDetail.tsx` — current detail UI; add a new tab "Explainability"
- `apps/forge/lib/runs/data.ts` — `getRun()` helper; add `getRunExplainability()` next to it
- `apps/forge/lib/hooks/useRuns.ts` — add `useRunExplainability()` hook next to `useRunDetail`

## ZONE 1 — Pydantic schemas

Create `backend/app/schemas/explainability.py`. Each sub-payload answers one question:

```python
class ChangeEntry(ForgeBaseModel):
    file: str
    change_kind: Literal["added", "removed", "modified", "renamed"]
    lines_added: int = 0
    lines_removed: int = 0
    rationale: str = ""
    citation: str | None = None

class Q1ChangesAndWhy(ForgeBaseModel):
    summary: str
    changes: list[ChangeEntry]
    citations: list[str]

class CheckEntry(ForgeBaseModel):
    name: str
    category: str
    outcome: Literal["pass", "fail", "warn", "skip"]
    detail: str = ""
    source: Literal["validation_report", "audit_events", "policy_engine"]

class Q2ChecksPerformed(ForgeBaseModel):
    total_checks: int
    passed: int
    failed: int
    skipped: int
    entries: list[CheckEntry]

class Q3CoverageGaps(ForgeBaseModel):
    explicit_gaps: list[str]
    implicit_gaps: list[str]
    coverage_pct: float = Field(ge=0, le=100)

class Q4ConfidenceScore(ForgeBaseModel):
    raw_score: float = Field(ge=0, le=100)
    calibration: Literal["token_logprob", "validation_passes", "heuristic", "human_only"]
    threshold: float = Field(ge=0, le=100, default=70.0)
    would_escalate: bool
    bands_observed: dict[str, int] = Field(default_factory=dict)

class Q5Counterfactual(ForgeBaseModel):
    conditions: list[str]
    counter_recommendation: str

class RunExplainability(ForgeBaseModel):
    run_id: UUID
    tenant_id: UUID
    project_id: UUID
    what_changed: Q1ChangesAndWhy
    what_checked: Q2ChecksPerformed
    coverage_gaps: Q3CoverageGaps
    confidence: Q4ConfidenceScore
    counterfactual: Q5Counterfactual
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: int = 1
    grade: Literal["A", "B", "C", "D", "F"] = "B"
    grade_rationale: str = ""
```

**Important:** Pydantic v2 patterns. The `Field(default_factory=lambda: ...)` is required for `datetime.now()`; do NOT use a class-level default or Pydantic will warn.

## ZONE 2 — Service

Create `backend/app/services/explainability.py`. The service is **stateless + read-only**. It takes the `SDLCRunManager` as a constructor arg so we have one seam for the manager dependency.

```python
class RunExplainabilityService:
    STANDARD_GAPS: tuple[str, ...] = (
        "Concurrency safety beyond the agent's own lock-free assumptions.",
        "Cross-tenant data leakage (covered by F-829i but not per-PR).",
        "Long-term state drift > 7 days (no continuous regression harness yet).",
    )

    CONFIDENCE_BANDS: dict[str, int] = {
        "0-20": 5, "20-40": 12, "40-60": 35, "60-80": 78, "80-100": 156,
    }

    def __init__(self, manager: SDLCRunManager) -> None: ...

    async def compute(
        self, db: AsyncSession, *, run_id: UUID, tenant_id: UUID, project_id: UUID,
    ) -> RunExplainability:
        """Read-only — fans out across SDLCRunManager + AuditEvent + Artifact + CommandRun."""
```

The compute method must:
1. Load state via `self._manager.get_run(run_id)` — raise `ValueError("run_not_found")` if `None` or wrong tenant
2. Load audit events filtered by `target_id == str(run_id)`
3. Load command runs filtered by `input.run_id == str(run_id)` (or `input.parent_run_id`)
4. Load validation artifacts filtered by `Artifact.tenant_id` + `Artifact.type == "validation_report"` + payload contains `run_id`
5. Compose Q1 (changes + citations), Q2 (checks with outcomes), Q3 (gaps with coverage_pct), Q4 (confidence with threshold), Q5 (counterfactual conditions)
6. Compute the overall letter grade via `_grade_bundle(checks, gaps, confidence)`
7. Return the bundle

`_grade_bundle` rubric (each block = 10-30 points):
- 30 pts if `checks.total_checks >= 5` else 15
- 20 pts if `gaps.coverage_pct >= 70` else 10
- 30 pts if `confidence.raw_score >= 80` else 15
- 10 pts if `confidence.would_escalate is False` else 0
- 10 pts if `checks.failed == 0` else 0
- A: ≥85, B: ≥70, C: ≥55, D: ≥40, F: <40

`rationale` = "{total_checks} checks, {failed} failed, {coverage_pct:.0f}% coverage, {raw_score:.0f}% confidence ({escalate|auto-ok})."

## ZONE 3 — Route

Append to `backend/app/api/v1/runs.py`:

```python
@router.get("/{run_id}/explainability")
async def get_run_explainability(
    run_id: UUID,
    principal: Principal,
    db: DbSession,
    manager: SDLCRunManager = RunManagerDep,
) -> dict[str, Any]:
    """GET /api/v1/runs/{id}/explainability — CodeRabbit 5-question bundle."""
    from app.services.explainability import RunExplainabilityService

    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")

    service = RunExplainabilityService(manager)
    bundle = await service.compute(
        db, run_id=run_id, tenant_id=principal.tenant_id, project_id=state.project_id,
    )
    return bundle.model_dump(mode="json")
```

Note: the existing imports `from app.api.deps import Principal, require_permission` already exist; you only need to add `from app.api.deps import DbSession` to the imports block. Keep the import inside the function for `RunExplainabilityService` so it stays a soft dependency until other endpoints need it.

## ZONE 4 — Frontend hook

Add to `apps/forge/lib/runs/data.ts`:

```typescript
import type { RunExplainability } from "@/lib/api/runs-types";

export async function getRunExplainability(runId: string): Promise<RunExplainability> {
  return api.get<RunExplainability>(`/runs/${runId}/explainability`);
}
```

Add to `apps/forge/lib/api/runs-types.ts` (NEW file — extract types into their own module if they're not already):

```typescript
export type RunExplainabilityGrade = "A" | "B" | "C" | "D" | "F";
export interface ChangeEntry { file: string; change_kind: "added"|"removed"|"modified"|"renamed"; lines_added: number; lines_removed: number; rationale: string; citation?: string; }
export interface Q1ChangesAndWhy { summary: string; changes: ChangeEntry[]; citations: string[]; }
export interface CheckEntry { name: string; category: string; outcome: "pass"|"fail"|"warn"|"skip"; detail: string; source: "validation_report"|"audit_events"|"policy_engine"; }
export interface Q2ChecksPerformed { total_checks: number; passed: number; failed: number; skipped: number; entries: CheckEntry[]; }
export interface Q3CoverageGaps { explicit_gaps: string[]; implicit_gaps: string[]; coverage_pct: number; }
export interface Q4ConfidenceScore { raw_score: number; calibration: "token_logprob"|"validation_passes"|"heuristic"|"human_only"; threshold: number; would_escalate: boolean; bands_observed: Record<string, number>; }
export interface Q5Counterfactual { conditions: string[]; counter_recommendation: string; }
export interface RunExplainability {
  run_id: string;
  tenant_id: string;
  project_id: string;
  what_changed: Q1ChangesAndWhy;
  what_checked: Q2ChecksPerformed;
  coverage_gaps: Q3CoverageGaps;
  confidence: Q4ConfidenceScore;
  counterfactual: Q5Counterfactual;
  computed_at: string;
  schema_version: number;
  grade: RunExplainabilityGrade;
  grade_rationale: string;
}
```

Add to `apps/forge/lib/hooks/useRuns.ts`:

```typescript
export function useRunExplainability(runId: string): UseQueryResult<RunExplainability> {
  return useQuery({
    queryKey: runsQueryKeys.explainability(runId),
    queryFn: () => getRunExplainability(runId),
    enabled: Boolean(runId),
    staleTime: 30_000,  // Bundle is derived; refresh every 30s for active runs.
  });
}
```

Also extend `runsQueryKeys` to include `explainability: (runId: string) => [..., "explainability", runId]`.

## ZONE 5 — ExplainabilityPanel UI

Create `apps/forge/components/runs/ExplainabilityPanel.tsx`. The component renders a 5-card layout (Q1-Q5 in vertical order, or 5-tab horizontal — pick the layout that fits `WorkflowRunDetail.tsx`'s existing tab shape).

Each card must:
- Have a stable `data-testid="explain-q{1..5}"` for tests
- Show the answer in plain language tied to the run (per CodeRabbit's test)
- For Q3 (gaps), surface the **honest coverage_pct** as a colored bar (green ≥70%, amber ≥40%, red <40%)
- For Q4 (confidence), show the calibration provenance inline ("from validation passes" / "from token logprobs" / "human-only — no signal")
- For Q5 (counterfactual), use the bullet list pattern with the `conditions` array; end with the `counter_recommendation` in an indigo quote box

Plus a **header** with:
- Overall letter grade (huge, 96px) on the right
- Grade rationale inline (one line, dim)
- "Computed at {ISO timestamp} · refresh in 30s" on the bottom

## ZONE 6 — Wire to detail view

Open `apps/forge/components/workflows/WorkflowRunDetail.tsx`. Find the existing tab strip (Overview / Stages / Cost / Logs / Artifacts) and add a fifth tab: **Explainability**.

Tab content = `<ExplainabilityPanel runId={runId} />`. The panel uses `useRunExplainability(runId)` internally.

Add a badge to the tab label: when `grade in ["D", "F"]`, show a red dot; when `["C"]`, amber; otherwise no badge. This makes the low-quality runs visible at a glance.

## ZONE 7 — Tests

Create `backend/tests/api/test_explainability.py`:

**Service-level (pure, no DB)** — 6 tests:
1. `test_q1_changes_empty_yields_read_only_summary` — no command runs, no audit → summary acknowledges it
2. `test_q2_checks_separate_validator_vs_audit` — validator finding + audit event = 2 checks, 2 passed
3. `test_q3_coverage_gaps_force_explicit_when_no_validation` — no validation report → "validation report" in explicit gaps
4. `test_q4_confidence_thresholds_escalate_below_70` — 0 checks → 50% (escalate); 5/5 passed → 100% (don't escalate)
5. `test_q5_counterfactual_includes_validator_fail` — decision="FAIL" prepends the "Validator returned a blocking decision" condition
6. `test_grade_a_when_all_conditions_met` + `test_grade_f_when_low_everywhere` — grade boundaries

**Integration (HTTP via TestClient)** — 2 tests:
7. `test_explainability_endpoint_404_for_unknown_run` — wrong run id → 404
8. `test_explainability_endpoint_works_for_existing_run` — existing run → 200 with all 5 question keys present

**Frontend** — Add `apps/forge/__tests__/runs-explainability.test.tsx`:
- Render `<ExplainabilityPanel runId="x" />` with a stubbed `useRunExplainability` returning grade-A fixture → grade badge is rendered, 5 cards present
- Render with grade-D fixture → red dot visible, Q3 coverage bar is red

## CONSTRAINTS (sub-step A)

- **NO schema migration.** The bundle is derived from existing tables. Adding new columns is out of scope.
- **NO real confidence calibration yet.** Q4 uses the heuristic `70 + 30 * pass_ratio`. A real calibrated model requires a labelled dataset we don't have. The `calibration` field carries the provenance so we can swap implementations later.
- **Tenant scoping (Rule 2)** — every load function filters by `principal.tenant_id`. The Q4 confidence is computed in the route layer, never from a cached cross-tenant value.
- **All audit events recorded (Rule 6)** — the explainability GET itself emits an `audit_event` with `action="runs.explainability.get"` so the access itself is auditable.
- **Dark theme only** — no light-mode variants. Use `--accent-emerald`, `--accent-amber`, `--accent-rose`, `--accent-indigo`, `--accent-cyan`.
- **Don't break** the existing 4 tabs on `WorkflowRunDetail.tsx`. Add the fifth tab; if there's no tab infrastructure yet, add it next to the other tabs.
- **No emojis as UI icons** — lucide-react only.

## DELIVERABLE (sub-step A)

Files modified:
- [ ] `backend/app/schemas/explainability.py` (NEW, ~140 lines)
- [ ] `backend/app/services/explainability.py` (NEW, ~300 lines)
- [ ] `backend/app/api/v1/runs.py` (append one route + import)
- [ ] `backend/tests/api/test_explainability.py` (NEW, ~250 lines, 8 tests passing)
- [ ] `apps/forge/lib/api/runs-types.ts` (NEW, ~30 lines — types only)
- [ ] `apps/forge/lib/runs/data.ts` (add `getRunExplainability()`)
- [ ] `apps/forge/lib/hooks/useRuns.ts` (add `useRunExplainability()`)
- [ ] `apps/forge/components/runs/ExplainabilityPanel.tsx` (NEW, ~200 lines)
- [ ] `apps/forge/components/workflows/WorkflowRunDetail.tsx` (add 5th tab)
- [ ] `apps/forge/__tests__/runs-explainability.test.tsx` (NEW)

After verification:
- [ ] `python -m pytest tests/api/test_explainability.py -v` — 8 passed
- [ ] `npx tsc --noEmit` — 0 new errors in any of the touched files
- [ ] `curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/runs/<id>/explainability` — 200, all 5 question keys present
- [ ] Update `built-features.yaml` — Runs feature row gains a sub-bullet, or add a new "Run Explainability" row under Integration → status `Production`
- [ ] Run `./scripts/generate-built-features.sh` — no drift

## "What we deliberately did NOT do"

- **Did not implement real confidence calibration.** Q4 is a heuristic. We surface `calibration: "validation_passes"` so reviewers know the provenance. Real calibration requires a labelled dataset.
- **Did not surface per-tokens-in-prompt rationale.** CodeRabbit's Q1 expects "structured walkthrough" — we emit `ChangeEntry` per file from `CommandRun.output.files[]`. If the source command didn't emit files, Q1 is empty + the summary explains that. We deliberately do NOT walk git diffs ourselves; that's a separate feature (Refactor center already does this).
- **Did not store the bundle.** Every GET recomputes. Storage is out of scope (no schema change). If perf matters later, add a `run_explainability_snapshots` table in a follow-up.
- **Did not break WorkflowRunDetail.tsx's existing 4 tabs.** Added one tab, didn't restructure.

---

# SUB-STEP B — Knowledge Feedback Loop (skill promotion)

> **Source mapping:** Action 4 in `/workspace/docs/research/coderabbit-agentic-sdlc-mapping.md`
> **Effort:** ~1 week
> **Owner:** 1 engineer
> **Goal:** Convert "we tried X, it failed" into "don't suggest X again"

## /goal-b

When a run completes and is later **rolled back**, **post-deploy-monitored as failed**, or **explicitly tagged as bad-outcome**, auto-promote a `forge-core` skill or `OrgKnowledge` (F-002) template that captures the lesson. A Steward reviews monthly.

## Files to read FIRST (sub-step B)

- `backend/app/db/models/dashboard.py` — existing `AIInsight` model (similar shape)
- `backend/app/api/v1/seeds.py` — the seed manifest pattern is closest to a curated knowledge entry
- `packages/forge-core/` (or `prompts/` if you prefer Markdown skills) — existing skill format
- `backend/app/services/audit_service.py` — the event-bus consumer pattern to follow

## Approach (minimal, ship-able in 1 week)

1. **Auto-detect rollback events**: subscribe to `event_bus.subscribe("run.rollback", "deployment.alert", "metric.degrade")` and store `LessonCandidate` rows
2. **Surface in OrgKnowledge**: add a new tab "Lessons Learned" (`F-002-LESSON`) with approve/edit/reject actions
3. **Steward review flow**: monthly digest email, one-click approve → promotes to F-002 template OR auto-rewrites `forge-core/skills/{name}.md`
4. **Forge-cite the lesson**: when Co-pilot or another agent suggests something that conflicts with an F-002-LESSON, surface the citation chip (per existing Co-pilot citation pattern)

**Skip for v1**: actual machine-learning loop on which lessons prevent the most failures. We just collect them and let humans curate.

---

# SUB-STEP C — Slack Agent MVP

> **Source mapping:** Action 1 in `/workspace/docs/research/coderabbit-agentic-sdlc-mapping.md`
> **Effort:** ~2 weeks
> **Owner:** 1 engineer
> **Goal:** Bring CodeRabbit's "Agent for Slack" pattern to Forge — agents that respond to thread messages.

## /goal-c

Make Forge's 12 agents + 63 forge-* commands callable from Slack. A user replies in a thread: `@forge summarize this thread's PR reviews` → the agent runs `forge-explore` → streams the response back into the thread.

## Files to read FIRST (sub-step C)

- `backend/app/api/connectors/slack.py` — Slack OAuth (already exists in Connector Center)
- `backend/app/api/ws/` — Socket Mode listener pattern (existing `ideation.py`, `runs.py`)
- `apps/forge/components/copilot/CopilotPanel.tsx` — existing streaming UI; reuse the message bubble + citation chip pattern
- `apps/forge/lib/api/copilot.ts` — `sendMessage()` + streaming surface
- `backend/app/services/sdlc_run_manager.py` — `RunStateBroker.subscribe()` for streaming output back to the Slack adapter
- `packages/forge-core/skills/` — the 63 forge-* commands we'll surface

## Approach (Slack Socket Mode, no public URL needed)

1. **Socket Mode listener**: `backend/app/api/ws/slack.py` opens a WebSocket to `wss://wss-primary.slack.com` after the Slack OAuth dance. Reads events as JSON envelopes.
2. **Thread-to-conversation mapping**: a Slack thread root becomes a Co-pilot conversation. The thread's first `@forge` message is the user's prompt; subsequent thread messages are conversation history.
3. **forge-core dispatch**: based on the prompt, route to a forge-* command or to the Co-pilot V1 tool surface. Stream the response back via Slack `chat.postMessage` updates (or just `chat_update` blocks).
4. **Audit chain**: every Slack-driven run gets `actor_id = <slack user id>`, `metadata.slack_thread = <thread ts>`, `metadata.slack_channel = <channel id>`. The audit_event captures the entire chain.
5. **Permission boundaries**: Slack agents run with the OAuth'd user's forge-permissions. The Steward persona in Slack has admin scope; the Engineer persona gets the Engineer scope.
6. **DL-024 white-labeling**: never expose "Slack" or "CodeRabbit" naming in user-facing strings. The user sees "Forge Agent". Internally we use `gsd:slack:agent` audit prefixes.

## CONSTRAINTS (sub-step C)

- **Use Slack Socket Mode** (no public URL, no reverse proxy). Requires Slack app with `socket-mode: true` + `app_token` (xapp-...).
- **Respect Slack rate limits**: 50 messages/sec per workspace, 1 message/sec per channel for `chat_update`. Buffer and throttle.
- **Thread-bounded conversation**: one Co-pilot conversation per thread root. Don't leak state across threads.
- **All LLM calls via LiteLLM Proxy** (Rule 1). Slack-driven runs use the user's virtual key.
- **PII**: Slack messages may contain PII; redact before storing in audit_logs. Use the existing redaction helper at `backend/app/core/redaction.py`.

---

## Verifying the bundle (after all 3 sub-steps ship)

`/docs/research/coderabbit-agentic-sdlc-mapping.md` should be updated to reflect:
- **Sub-step A**: Upgrade explainability from C+ → A
- **Sub-step B**: Upgrade knowledge loop from "no curation" → "steward-reviewed"
- **Sub-step C**: Upgrade multi-player collab from "ingest only" → "agent in Slack thread"

After this bundle ships, all four CodeRabbit "capabilities you need" are addressed. Phase 6 (Knowledge Graph wiring) and Phase 11 (Governance/Audit wiring) can resume after.
