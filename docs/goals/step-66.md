# Step 66 — Phase 4 Workflows + Runs: Production Hardening

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1 week (5 focused zones)
> **Phase:** 4 — Workflows + Runs (currently `Beta` in `built-features.yaml`)
> **Goal:** Close the two gaps that keep this phase in `Beta`, ship to `Production`

## /goal

`built-features.yaml` currently reads:

> Phase 4 — Workflows + Runs (visual builder + live execution) | step 56 | **Beta**

The honest reason for `Beta` is **two real gaps** found during this session's investigation:

1. **Approval pause/resume roundtrip is broken.** The test `test_executor_pauses_on_approval_and_resumes_on_grant` in `backend/tests/test_workflow_executor.py` fails because after `WorkflowExecutor.resume(approval_id, decision="granted")` runs, the next `execute()` call replays the approval step and raises `WorkflowApprovalResumeRequired` again — the `step_results["a1"]` was supposed to flip from `WAITING_APPROVAL` → `SUCCEEDED` but the change is not persisted correctly before the second `execute()` runs. (1 failing test out of 8.)
2. **Templates are surfaced but not deep-wired.** `lib/workflow/templates.ts` defines 6 starter workflows but the gallery's "install template" path is incomplete — it copies node positions but does NOT create a Workflow row in the database. Users see templates in the gallery but they can't actually create a workflow from them.

What ships to `Production` after this step:
- The 1 failing test now passes
- "Install template" creates a real `Workflow` row in the DB
- One new lightweight integration test exercises pause → resume via the **HTTP route** (not just executor unit test)
- A new `LiveStreamPill` indicator badge verifies the SSE stream is healthy
- `built-features.yaml` flips from `Beta` to `Production`

## Files to read FIRST (in this order)

1. `/workspace/prompts/step57p5-dashboard-real.md` — prompt shape reference (zones / deliverables / constraints)
2. `/workspace/prompts/step65-oidc-litellm-bridge.md` — newest sibling prompt; check zone structure
3. `backend/tests/test_workflow_executor.py` — see `test_executor_pauses_on_approval_and_resumes_on_grant` (lines 350-410) for the broken case
4. `backend/app/services/workflow_executor.py` — the bug locus. Read `execute()` (lines 102-220) and `resume()` (lines 218-280). Pay attention to the comment at line 154 about JSONB change events.
5. `backend/app/api/v1/workflows.py` — `POST /workflows/runs/{run_id}/resume` route. The HTTP path that calls `WorkflowExecutor.resume`.
6. `apps/forge/components/workflows/WorkflowCenter.tsx` — `installTemplate()` callback (search for `installTemplate`)
7. `apps/forge/lib/workflow/templates.ts` — 6 templates, each has `nodes` + `edges` arrays
8. `apps/forge/components/workflows/WorkflowRunDetail.tsx` — `<LiveStreamPill status={streamStatus}>` at the top of the run detail
9. `/workspace/docs/features/workflows.md` and `/workspace/docs/features/runs.md` — feature docs; update if behavior changes
10. `built-features.yaml` — the YAML row to flip at the end

## ZONE 1 — Fix the pause/resume roundtrip bug

### Symptom (verified during investigation)

```
$ python3 -m pytest tests/test_workflow_executor.py::test_executor_pauses_on_approval_and_resumes_on_grant
FAILED tests/test_workflow_executor.py::test_executor_pauses_on_approval_and_resumes_on_grant
app/services/workflow_executor.py:195: WorkflowApprovalResumeRequired:
  run 685a311f-ac3c-4241-844e-8b32f1a469df paused awaiting approval 3db17a74-...
```

### Root cause analysis (don't just patch; understand)

The flow:
1. `execute()` walks topo order `t1 → c1 → a1 → c2`. At `a1`, `_dispatch_approval` writes `envelope["status"] = WAITING_APPROVAL` and returns. `execute()` then sees the WAITING_APPROVAL status, commits, and raises `WorkflowApprovalResumeRequired`.
2. Test catches the exception in `pytest.raises`, extracts `approval_id`, calls `resume(approval_id, decision="granted")`.
3. `resume()` reads `run`, computes `step_results = dict(run.state.get("stepResults", {}))`, mutates `step_results[approval_step_id]["status"] = "succeeded"`, then writes back: `run.state = {**run.state, "stepResults": step_results}; await db.commit()`.
4. `resume()` then calls `self.execute(db, ...)`.
5. The new `execute()` re-loads `run` via `_load_run` (fresh DB query), reads `run.state`, computes `step_results`, loops topo order. **At a1, the skip check is**:
   ```python
   if existing and existing.get("status") in (
       WorkflowStepStatus.SUCCEEDED.value,
       WorkflowStepStatus.FAILED.value,
       WorkflowStepStatus.SKIPPED.value,
   ):
       continue
   ```
   But `existing.get("status")` is still `"waiting_approval"` — the change from step 3 did not persist.

### Probable cause

The JSONB column on `WorkflowRun.state` is loaded as a plain `dict` (not `MutableDict.as_mutable()`). After `resume()` mutates `step_results` and assigns a NEW dict to `run.state`, then `db.commit()`, SQLAlchemy should fire an UPDATE because the column is dirty. **But** — here's the subtle bug — the `step_results` dict that `resume()` mutates is `dict(run.state.get("stepResults", {}))`. This is a **shallow copy**. When `resume()` does `step_results[approval_step_id]["status"] = "succeeded"`, that mutates a key in the copy — but **the original `run.state["stepResults"]` still has the same nested dict reference**, so the original is also "mutated" (because shallow copy). Then `run.state = {**run.state, "stepResults": step_results}` reassigns `run.state` to a new top-level dict, but the value at `"stepResults"` is the same shallow-copied dict.

When `db.commit()` runs, SQLAlchemy's JSONB change detection compares the **serialized form**. The new `run.state` dict serializes to the same JSON as the old one (because shallow copy + reassign doesn't change the structure). SQLAlchemy concludes: "no change." UPDATE never fires.

**Fix options (pick one):**

**Option A — Deep copy in `resume()`:**
```python
step_results = copy.deepcopy(run.state.get("stepResults", {}))
step_results[approval_step_id]["status"] = WorkflowStepStatus.SUCCEEDED.value
run.state = {"stepResults": step_results}   # don't spread, just rebuild
run.status = WorkflowRunStatus.RUNNING
await db.commit()
```

This guarantees the dict structure differs from the prior state at the JSONB layer.

**Option B — Mutate in place + use `MutableDict.as_mutable()`:**
Mark the column `MutableDict.as_mutable(JSONB)` on the model, then in `resume()`:
```python
run.state["stepResults"][approval_step_id]["status"] = SUCCEEDED.value
await db.commit()
```
This is the cleanest but requires a migration.

**Option C — Force-update via `__setattr__` + `flag_modified`:**
```python
from sqlalchemy.orm.attributes import flag_modified
step_results = dict(run.state.get("stepResults", {}))
step_results[approval_step_id]["status"] = SUCCEEDED.value
run.state = {"stepResults": step_results}
flag_modified(run, "state")
await db.commit()
```
Lightest touch, most surgical.

**My recommendation: Option C** — `flag_modified` is the idiomatic SQLAlchemy escape hatch, no migration needed, leaves the rest of the executor unchanged. Document it with a comment so future-me doesn't undo it.

### Test to write first (TDD)

The existing test `test_executor_pauses_on_approval_and_resumes_on_grant` is the test that should pass. Don't rewrite it — it IS the spec. Once your fix passes it, also verify the other 7 tests in `test_workflow_executor.py` still pass (run `pytest tests/test_workflow_executor.py -v`).

## ZONE 2 — Wire "install template" to the database

### Symptom

`WorkflowCenter.tsx` has a gallery tab that lists 6 templates. Clicking one fires `installTemplate(template)` which:
- Calls `hydrateFromTemplate(template)` on the visual builder store
- Does NOT call any backend endpoint to create a Workflow row
- The user sees the canvas populate with nodes, but if they refresh, the template is gone — nothing persisted

### Fix

Two paths, one new endpoint:

**Backend** (`backend/app/api/v1/workflows.py` — add a new route, NOT modify existing):

```python
class WorkflowFromTemplateRequest(ForgeBaseModel):
    template_id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

@router.post("/from-template", response_model=WorkflowRead, status_code=201)
@audit(action="workflows.from_template", target_type="workflow")
async def create_workflow_from_template(
    body: WorkflowFromTemplateRequest,
    principal: Principal,
    db: DbSession,
) -> WorkflowRead:
    """Create a workflow from one of the canonical 6 starter templates.

    The templates themselves live in the frontend catalog
    (lib/workflow/templates.ts) AND are mirrored on the backend so the
    validator runs against a known schema. The canonical list is in
    `app.services.workflow_templates.WORKFLOW_TEMPLATES_BACKEND`.
    """
    from app.services.workflow_templates import get_template
    template = get_template(body.template_id)
    if template is None:
        raise HTTPException(404, "template_not_found")
    wf = await workflow_service.create_workflow(
        db,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        created_by=principal.user_id,
        name=body.name,
        description=body.description or template.description,
        definition=template.to_definition(),
    )
    return _to_response(wf)
```

The mirror templates (`backend/app/services/workflow_templates.py`):

```python
"""Mirror of the frontend workflow template catalog.

The frontend (`apps/forge/lib/workflow/templates.ts`) ships 6 starter
workflows. The backend keeps an authoritative mirror so we can:
  - validate that the catalog hasn't drifted from the backend spec
  - reject template_ids the backend doesn't know about
  - emit audit events for "created from template X"

The templates are duplicated intentionally — the frontend catalog is
rich (has icons, descriptions, layout coordinates) and is the source of
truth for the gallery UI. The backend mirror has only what the API
needs (name, description, definition).
"""

from app.schemas.workflow import WorkflowDefinition

_TEMPLATES: dict[str, "TemplateSpec"] = {
    "wf-template-ideation": TemplateSpec(
        name="Ideation → PRD pipeline",
        description="Capture idea → AI score → PM approval → Generate PRD",
        definition=WorkflowDefinition(nodes=[...], edges=[...]),
    ),
    "wf-template-bug-fix": ...,
    # 4 more
}

def get_template(template_id: str) -> "TemplateSpec | None":
    return _TEMPLATES.get(template_id)
```

**Pick the same 6 templates** as the frontend (`wf-template-ideation`, `wf-template-bug-fix`, etc.). Don't add new ones — keep the catalog symmetric.

**Frontend** (`apps/forge/components/workflows/WorkflowCenter.tsx` — `installTemplate` callback):

Replace the in-memory-only path with:

```typescript
const createFromTemplate = useCreateWorkflow();  // already exists in useWorkflows.ts

const installTemplate = React.useCallback(
  async (template: WorkflowTemplate) => {
    const wf = await createFromTemplate.mutateAsync({
      template_id: template.id,
      name: `${template.label} (from template)`,
      description: template.description,
    });
    hydrateFromTemplate(template);  // populate the local canvas
    router.push(`/forge-workflows/${wf.id}`);  // navigate to the real workflow
    toast.success(`Workflow "${wf.name}" created`);
  },
  [createFromTemplate, hydrateFromTemplate, router],
);
```

Add the helper to `lib/workflows/data.ts`:

```typescript
export async function createWorkflowFromTemplate(
  body: { template_id: string; name: string; description?: string },
): Promise<Workflow> {
  return api.post<Workflow>('/workflows/from-template', body);
}
```

And `useCreateWorkflowFromTemplate()` hook in `lib/hooks/useWorkflows.ts`:

```typescript
export function useCreateWorkflowFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createWorkflowFromTemplate,
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: workflowQueryKeys.list() });
      qc.setQueryData(workflowQueryKeys.detail(wf.id), wf);
    },
  });
}
```

## ZONE 3 — LiveStreamPill robustness

The `<LiveStreamPill status={streamStatus} />` component exists in `WorkflowRunDetail.tsx`. Make sure it correctly handles **all 5 states** from `useRunLiveEvents`:

| `streamStatus` | Pill color | Text |
|---|---|---|
| `idle` | muted | "Not subscribed" |
| `connecting` | amber | "Connecting…" |
| `open` | emerald | "Live" + green pulse |
| `closed` | muted | "Stream closed" |
| `error` | rose | "Reconnecting…" |

Verify each transition path:
- `idle` → `connecting` when component mounts and runId is set
- `connecting` → `open` when SSE handshake completes
- `open` → `closed` when run reaches `DONE` / `FAILED` / `CANCELLED`
- `open` → `error` → `connecting` (retry) on network blip

If the current `LiveStreamPill` already handles these, **don't change it**. If it only shows one or two states, expand it.

Test: `apps/forge/__tests__/live-stream-pill.test.tsx` (new). Render the pill for each of 5 statuses; assert class names + text.

## ZONE 4 — End-to-end HTTP test for pause/resume

The existing `test_executor_pauses_on_approval_and_resumes_on_grant` exercises the executor directly. We need a second test that exercises the **HTTP route** `POST /workflows/runs/{run_id}/resume` so we know the full integration works:

`backend/tests/api/test_workflow_resume_http.py`:

```python
@pytest.mark.asyncio
async def test_resume_run_via_http_route(client, paused_workflow_run):
    """POST /workflows/runs/{id}/resume drives the same flow as the unit test,
    but through the FastAPI layer (TestClient) so we know the HTTP contract
    works (request body, response, audit emission, error envelopes).
    """
    run_id = paused_workflow_run["run_id"]
    approval_id = paused_workflow_run["approval_id"]
    response = await client.post(
        f"/api/v1/workflows/runs/{run_id}/resume",
        json={"approval_id": approval_id, "decision": "granted"},
        headers={"X-Forge-Principal": json.dumps(...steward principal...)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    # Verify audit was emitted
    audit = await audit_service.list(...)
    assert any(e.action == "workflows.resume.granted" for e in audit)
```

Follow the pattern of `tests/api/v1/test_dashboard_v2.py` for setting up `TestClient` + auth override.

## ZONE 5 — Update docs + YAML

**`/workspace/docs/features/workflows.md`** — add a short section "From template to live run" with the screenshot-friendly flow:
1. User opens Workflows gallery tab
2. Picks template → sees canvas preview
3. Clicks "Use this template" → enters name
4. Workflow row created in DB, user navigated to editor
5. Clicks "Run" → run starts, SSE stream shows status, awaits approval at gate
6. Steward approves → run continues to completion

**`/workspace/docs/features/runs.md`** — add a sentence: "Run pauses at approval gates; the executor persists the pause state and the resume path skips already-completed steps. See /workspace/prompts/step66-phase4-production.md."

**`built-features.yaml`** — find:
```yaml
  - area: Integration
    order: 43
    feature: "Phase 4 — Workflows + Runs (visual builder + live execution)"
    steps: ["56"]
    status: Beta
    docs: centers/workflows
```

Change to:
```yaml
  - area: Integration
    order: 43
    feature: "Phase 4 — Workflows + Runs (visual builder + live execution)"
    steps: ["56", "66"]
    status: Production
    docs: centers/workflows
```

Same for the `Workspace` row that mirrors `Phase 4`. Run:
```bash
./scripts/generate-built-features.sh
./scripts/check-feature-docs.sh
```

Both must pass: `41 passed, 0 missing`.

## CONSTRAINTS

- **No schema migration** — flag_modified pattern avoids touching the JSONB column. Template mirror is a new Python file, no DB changes.
- **No new endpoints beyond what Zone 2 requires.** Don't ship a "list templates" route — the frontend already knows them. The new `/workflows/from-template` endpoint is the only addition.
- **Don't add LLM-as-judge** to resume. Approval decisions stay human-only.
- **Don't change the SSE event shape.** EventSource contract is `data: { json }` lines with `RunStreamEvent` payloads. Frontend already knows this shape.
- **Don't break the existing 7 passing tests in `test_workflow_executor.py`.** After your fix, all 8 must pass.
- **Audit emission** — `POST /workflows/from-template` emits `workflows.from_template`; `POST /workflows/runs/{id}/resume` emits `workflows.resume.granted` or `workflows.resume.denied`. Per Rule 6.
- **Multi-tenant** (Rule 2) — every query includes `tenant_id == principal.tenant_id`.
- **Dark theme only.** LiveStreamPill uses `--accent-emerald`, `--accent-rose`, etc. via CSS variables.

## DELIVERABLE

Modified:
- [ ] `backend/app/services/workflow_executor.py` — flag_modified + comment in `resume()`
- [ ] `backend/app/api/v1/workflows.py` — new `POST /workflows/from-template` route
- [ ] `apps/forge/components/workflows/WorkflowCenter.tsx` — `installTemplate` calls backend
- [ ] `apps/forge/lib/workflows/data.ts` — `createWorkflowFromTemplate()` helper
- [ ] `apps/forge/lib/hooks/useWorkflows.ts` — `useCreateWorkflowFromTemplate()` hook
- [ ] `built-features.yaml` — Beta → Production on Phase 4 row

Created:
- [ ] `backend/app/services/workflow_templates.py` — backend mirror of 6 templates
- [ ] `backend/tests/api/test_workflow_resume_http.py` — HTTP route test for resume
- [ ] `apps/forge/__tests__/live-stream-pill.test.tsx` — 5-status pill test
- [ ] `apps/forge/__tests__/workflows-install-template.test.tsx` — gallery install flow test

Verify:
- [ ] `pytest tests/test_workflow_executor.py -v` — 8/8 pass (was 7/8)
- [ ] `pytest tests/api/test_workflow_resume_http.py -v` — 1/1 pass
- [ ] `npx tsc --noEmit` — 0 new errors in any of the touched files
- [ ] `bash scripts/generate-built-features.sh --check` — no drift
- [ ] `python3 scripts/check-feature-docs.py` — 41 passed, 0 missing
- [ ] End-to-end: open Workflows gallery → click "Use this template" → workflow row created → run starts → pauses at approval → approve → run continues to completion

## "What we deliberately did NOT do"

- **Did not add SSE event replay from server-side queue.** The current implementation replays the snapshot on connect, then streams new events. That's good enough. (If you need replay-from-history, that's a separate Redis-backed event store step.)
- **Did not refactor the visual builder.** This step adds 1 endpoint + 1 hook + 1 test. The builder itself is out of scope.
- **Did not implement "save workflow as template".** That's a useful feature (Phase 4+future) but it's a separate prompt.
- **Did not change the 6 templates.** Mirror them as-is. Future template evolution is its own prompt.
- **Did not migrate to `MutableDict.as_mutable(JSONB)`.** flag_modified is the surgical fix; the broader column-type change has bigger blast radius.

---

**Total scope:** ~5 days focused work for 1 engineer. ~400 lines backend + ~150 lines frontend + ~250 lines tests.

Tell me to ship it and I'll walk the zones in order: 1 (fix pause/resume) → 4 (HTTP test) → 2 (templates) → 3 (pill) → 5 (YAML + docs). Or tell me **which zone to inspect first** if anything needs detail.