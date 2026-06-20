# DoR Lint — Paperclip Issue-Creation Requirement

**Status:** Draft v0.1 (planning child of [Forge AI-281](/Forge AI/issues/Forge AI-281))
**Owner:** Architect (Sync Plane) — `c4654678-…`
**Reviewer:** CEO in the weekly flow cadence ([Forge AI-278](/Forge AI/issues/Forge AI-278))
**Implementation:** parked for the next platform round (post-Epic 11, post-WIP cap enforcement)
**Scope:** Paperclip platform — `POST /api/companies/{id}/issues` (and the create-subtask path) — not sync-plane-specific, but parked under Epic 11 because the Epic 11 1+9 burst is the trigger case.

---

## 0. Why

The Scrum Master's [Forge AI-251](/Forge AI/issues/Forge AI-251) report flagged process defect #3
(big-bang epics). The trigger case is the Epic 11 dispatch: 1 epic + 9 children, all
created in a single heartbeat, with **no internal `blockedByIssueIds`** between the
children. The issue-creation API accepted all of them because every field is optional.

We need a **fail-closed lint at issue creation** that turns the "missing parent / AC /
blocker" class of defect from a Scrum-Master-detected-then-fixed back into a
platform-detected-then-rejected. The lint is upstream of the WIP cap ([Forge AI-212](/Forge AI/issues/Forge AI-212)):
the cap is a runtime limit on *active* work; the lint is a creation-time limit on
*un-formed* work.

---

## 1. Lint trigger condition

The lint runs on every `POST /api/companies/{id}/issues` (and the create-subtask path)
where the new issue is **not exempt** (§3). It validates three required fields, in
order. **All three are blocking; the lint fails closed on the first missing one** so the
error response is unambiguous.

| # | Required field | Shape | Where it lives |
|---|----------------|-------|----------------|
| 1 | `parentId` | UUID of an existing issue, or `null` for top-level epics (see §3) | request body |
| 2 | `acceptanceCriteria` | markdown section `## Acceptance Criteria` with **≥ 1 checkbox item** (`- [ ] …`) in the description | parsed out of `description` |
| 3 | `blockedByIssueIds` | non-empty array of UUIDs **OR** explicit `deferBlockers: true` with a `deferBlockerReason` string (≤ 500 chars) | request body; only required for non-leaf children (see §2) |

The lint is a **synchronous 422** at the API layer; the UI surfaces it as a validation
error before submit. The Epic Generator and dispatch agents receive the 422 in their
tool call result and must re-shape the dispatch (split, add AC, add blockers) before
retrying. **There is no "lint warning" mode** — the lint is binary.

### 1.1 What "non-leaf" means in (3)

A child is **leaf** if and only if (a) it has no further planned children **and** (b) its
own work is fully described in the issue body (i.e. it is the terminal node of the
dispatch). The default is **non-leaf**: dispatch agents must explicitly mark a child as
leaf by passing `leaf: true` in the request body, which exempts it from (3) but still
requires (1) and (2).

If the agent cannot decide, it must pass `blockedByIssueIds` — the cost of an
unnecessary blocker is low (the WIP cap engine still permits it; the dependent
auto-wakes at the right time).

---

## 2. Error code

A single, stable, machine-readable code:

```
dor_requirements_missing
```

The 422 response body is a typed envelope, not free text:

```jsonc
{
  "error": "dor_requirements_missing",
  "message": "Issue creation rejected: missing required DoR fields.",
  "missing": ["parentId", "acceptanceCriteria", "blockedByIssueIds"],
  "exempt_paths_considered": ["coordination_child", "top_level_epic"],
  "hint": "Add parentId + a '## Acceptance Criteria' section with ≥ 1 checkbox, " +
          "plus blockedByIssueIds (or leaf: true with deferBlockerReason)."
}
```

`missing` is an **ordered list** matching §1's table — the first entry is the
blocking field. `exempt_paths_considered` lets the caller see why the engine did
*not* grant an exemption (helps with the loop-break comment pattern from Forge AI-215).

The error code is reserved: no other 422 may reuse `dor_requirements_missing`.

---

## 3. Exempt issue types

The lint skips a creation request if **any** of the following is true. Each exemption
is a typed, auditable claim; the engine records it in the `activity_log` so the
Scrum Master can audit exemption rates in the weekly flow report.

| Exempt key | When it applies | What still applies |
|------------|-----------------|--------------------|
| `top_level_epic` | `parentId is null` AND `issueTypeName in {"Epic"}` AND `goalId is set` | (2) only — (3) is N/A for epics because they are roots |
| `coordination_child` | `billingCode in {"coordination"}` AND the issue is a *commentary-only* child (no deliverable code/artifact) | (1) only — (2) and (3) replaced by a free-text `coordinationPurpose` field |
| `automated_platform_path` | `originKind in {"automation","webhook","routine"}` AND the issuing principal is in the platform allow-list (e.g. `EpicGenerator`, `ArtifactGenerator`) | **all three waived** but the engine stamps `lint_exemption_acknowledged: true` on the issue |
| `board_user_dispatch` | `createdByUserId is set` (i.e. a human created it directly in the board UI) | (2) and (3) waived; (1) is a soft warning, not a 422 |
| `follow_up_with_documented_ac` | `parentId` is set AND description contains `## Acceptance Criteria` (≥ 1 checkbox) AND `followUpOf: <parent-uuid>` is set in the body | (3) waived — the documented AC + explicit follow-up link is the contract |
| `lint_disabled_per_tenant` | tenant has `DOR_LINT_ENABLED=false` in tenant policy (escape hatch for tenants migrating in) | **all three waived**; engine logs a `dor_lint_disabled` audit event |

The list is **closed** — adding a new exemption requires an ADR-style change to
`forge/platform/dor_lint_exemptions.yaml`, reviewed by the Architect + CTO. The
weekly flow report surfaces the top-N exemption reasons; if any exemption is
accounting for > 20 % of new issues, the Scrum Master flags it.

---

## 4. Example

### 4.1 Bad — the Epic 11 burst, replayed

A single-tick dispatch creates an epic + 9 children, none of which carry AC or
internal blockers. The lint rejects every child.

```http
POST /api/companies/3fde…/issues
Content-Type: application/json

{
  "title": "11.1 — Sync Plane skeleton",
  "parentId": "<epic-uuid>",
  "assigneeAgentId": "<architect-uuid>",
  "description": "Implement the sync plane skeleton."
  // no acceptanceCriteria in description
  // no blockedByIssueIds
  // no leaf flag
}
```

Response (HTTP 422):

```jsonc
{
  "error": "dor_requirements_missing",
  "missing": ["acceptanceCriteria", "blockedByIssueIds"],
  "hint": "Add a '## Acceptance Criteria' section with ≥ 1 checkbox to the description, " +
          "and either blockedByIssueIds or leaf: true."
}
```

The dispatch agent must re-shape: add AC checkboxes, then either set `leaf: true`
(only valid for terminal nodes) or add a `blockedByIssueIds` entry pointing to the
parent epic (so the dependent auto-wakes on parent completion).

### 4.2 Good — the same dispatch, DoR-clean

```http
POST /api/companies/3fde…/issues
{
  "title": "11.1 — Sync Plane skeleton",
  "parentId": "<epic-uuid>",
  "assigneeAgentId": "<architect-uuid>",
  "blockedByIssueIds": ["<epic-uuid>"],
  "description": "## Acceptance Criteria\n\n- [ ] HlcClock + WireCodec green\n- [ ] …"
}
```

Lint passes; the issue enters the queue with a first-class blocker on the parent
epic, so the WIP cap engine and the `issue_blockers_resolved` wake handler both
work as designed.

---

## 5. Expected impact on the WIP cap

The WIP cap policy ([Forge AI-212](/Forge AI/issues/Forge AI-212)) caps in-flight work at
≤ 3 active (in_progress + in_review) issues **per agent**. The cap is enforced
*at runtime* — when an agent picks up its 4th active issue, the system rejects
the checkout.

The DoR lint is the **creation-time** companion:

- **Before the lint** — Epic 11 (1 + 9) lands in `todo` in a single tick. The
  WIP cap only kicks in at checkout time, *per agent*. If the 9 children land on
  3 different agents, the cap does nothing — all 9 sit in `todo` until each
  agent picks one up, and the big-bang anti-pattern is preserved.
- **After the lint** — single-tick dispatches of N > 3 children become
  impossible **without an explicit AC + parent + blocker contract** on every
  child. The Epic 11 burst would have been forced to either (a) split across
  multiple ticks (with `blockedByIssueIds` linking the waves), or (b) provide
  AC on every child up-front, which surfaces missing requirements at
  *creation* instead of *review*.

Concretely, the lint is expected to reduce single-tick fan-out (`create N where
N > 3 with no internal DAG`) from the current ~30 % of dispatches (per the
Scrum Master's Forge AI-251 baseline) to **< 5 %**. The remaining 5 % is the
follow-up + coordination exemption path, which is auditable and reviewable.

The two policies compose: the lint shapes the *shape* of new work, the WIP cap
shapes the *flow* of accepted work. Neither is sufficient alone.

---

## 6. Out of scope (for the parked platform round)

- **Lint on `PATCH` updates** — the lint only runs on `POST …/issues`; updates
  that remove AC or unblock a child are out of scope and would need a separate
  audit event. Tracked as a follow-up child if needed.
- **Lint on agent-generated comments** — out of scope; comments are not issues.
- **Cross-tenant lint policy** — the exemption list is global for v0.1; a
  per-tenant override is on the list (the `lint_disabled_per_tenant` exemption)
  but full per-tenant policy is a v0.2 concern.
- **LLM-driven AC quality check** — the lint checks the *shape* of AC (checkbox
  count ≥ 1), not the *substance*. AC quality remains a reviewer/QA concern.

---

## 7. Sequencing & open questions for CEO review

- This is a **planning child**, not implementation. The platform round that
  implements the lint is parked behind Epic 11 ship + WIP cap enforcement.
- Open question for CEO (in [Forge AI-278](/Forge AI/issues/Forge AI-278) cadence): **Is
  `top_level_epic` an acceptable exemption, or do we require AC on epics
  too?** The Scrum Master's data shows epics without AC at a ~15 % rate; if
  the board wants that to zero, the exemption list shrinks.
- Open question: **Should `follow_up_with_documented_ac` require the follow-up
  link to be a structured field (`followUpOf`) or a free-text mention in the
  description?** Structured is enforceable; free-text is friendlier. Default
  in this doc is structured; flag if the board disagrees.

---

**Cross-references:**
- [Forge AI-251](/Forge AI/issues/Forge AI-251) — Board hygiene flow report (Scrum Master, 2026-06-18, done) — the trigger
- [Forge AI-212](/Forge AI/issues/Forge AI-212) — WIP cap policy (the runtime companion)
- [Forge AI-278](/Forge AI/issues/Forge AI-278) — Weekly flow report cadence (review venue)
- [Forge AI-281](/Forge AI/issues/Forge AI-281) — This issue (planning child)
- `forge/sync-plane/risk_register.md` — S7 audit coverage, S1 idempotency contract
