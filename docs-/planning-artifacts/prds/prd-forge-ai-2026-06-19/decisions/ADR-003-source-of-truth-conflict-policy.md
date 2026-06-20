---
adr_id: ADR-003
title: Source-of-Truth Conflict Policy — Hybrid MDM + Steward-Editable Priority
status: Accepted
date: 2026-06-20
deciders: Arunachalam V, Architecture team
consulted: Pilot Tech Leads (CMC, GAPI, Honeywell), Stewards, Compliance
informed: Engineering, Product
supersedes: PRD §6.1 OQ-007
related:
  - PRD F-103 (Architecture Discovery)
  - PRD F-104 (Dependency Graph)
  - PRD F-105 (API Catalog)
  - PRD F-106 (Database Map)
  - PRD F-110 (Impact Analysis)
  - PRD F-208 (Standards Attestation)
  - PRD F-209 (Context-Aware Architecture Generation)
  - PRD NFR-032 (no autonomous cross-boundary transitions)
  - ADR-002 (Knowledge Graph Substrate)
---

# ADR-003: Source-of-Truth Conflict Policy — Hybrid MDM + Steward-Editable Priority

## Context and Problem Statement

The PRD §6.1 OQ-007 lists the source-of-truth conflict policy as an unresolved open question, acknowledging that F-103, F-104, F-105, F-106, F-110, and F-209 already presume a resolution. The PRD's illustrative example — "Jira says Cognito, code says Keycloak" — is a Phase 0 day-one reality, not an edge case.

The `review-architecture.md` flagged this as one of the three CRITICAL risks: "Source-of-truth conflict policy (OQ-007) is unresolved but F-110 (Impact Analysis) and F-103/F-104 (Architecture / Dependency Discovery) already presume one."

Without a resolved policy, every Phase 0 output is a guess, and the M3 demo (architecture discovery) is unsellable.

The decision must satisfy:
- **F-103, F-104, F-105, F-106, F-110, F-209** — all read from the knowledge graph and presume a conflict resolution policy
- **NFR-032** — no autonomous cross-boundary transitions (conflict resolution is a governance boundary)
- **Project Context Rule 6** — full auditability of every agent action
- **PRD §1.2** — knowledge as organizational asset (cannot be silently auto-merged)

## Decision Drivers

- **Pilot day-one reality** — conflicts between Jira / Confluence / code / docs will surface immediately on brownfield ingestion
- **Auditability requirement** — every conflict resolution must be traceable (Rule 6)
- **Human-in-the-loop** — NFR-032 forbids autonomous resolution of governance-boundary decisions
- **Steward authority** — Organization Knowledge is Steward-controlled (Rule 5, A-008); Steward should own the priority policy
- **Pilot feedback loop** — the policy must be tunable per-pilot feedback without code changes

## Considered Options

### Option 1: Hybrid MDM + Steward-Editable Priority Policy
Master Data Management pattern: every knowledge graph node carries a `provenance[]` array with all sources, confidence scores, and timestamps. A `priority_policy` table (Steward-editable) declares the per-domain priority order. Conflicts are flagged, never silently auto-merged. Steward / Architect resolves via UI.

### Option 2: Code-Wins Always
Code is authoritative for everything that exists in code. Auto-merge silently overwrites Jira/Confluence disagreements.

### Option 3: Last-Write-Wins
The most recent ingestion update wins. No priority policy.

### Option 4: Manual-only
Every conflict requires human review, no automatic policy application.

## Decision Outcome

**Chosen Option 1: Hybrid MDM + Steward-Editable Priority Policy.**

### Default priority policy (provisional, Steward-editable)

| Domain | Source of Truth | Rationale |
|---|---|---|
| Service existence (F-103) | **Code** | Runtime truth — what actually runs in production |
| Service ownership (F-103, F-105) | **CODEOWNERS** | Explicit declaration of human ownership |
| Service API contracts (F-105) | **Code (OpenAPI/GraphQL schemas)** | Runtime contract — what consumers actually call |
| Database schemas (F-106) | **Code (ORM models / migrations)** | Runtime truth — what the database actually contains |
| Workflow / task tracking | **Jira** | Human-process truth — what humans agreed to do |
| Documentation | **Confluence** | Long-form narrative |
| Operational reality (deployed services, runtime config) | **AWS / SonarQube** | Observed state |
| Cross-system overlap | **Explicit human override** | Tie-breaker; recorded in audit log with reason |

### Architecture commitments (consequence of this decision)

- **Graph node schema** (every node):
  ```sql
  CREATE TABLE graph_node (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL,
    label TEXT NOT NULL,
    properties JSONB NOT NULL,
    agtype agtype,  -- AGE graph payload
    provenance JSONB NOT NULL DEFAULT '[]',  -- array of {source, source_id, confidence, received_at, raw_value}
    freshness_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    freshness_source TEXT NOT NULL,
    conflict_state TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'pending' | 'resolved'
    conflict_id BIGINT REFERENCES conflict_event(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```

- **Priority policy table** (Steward-editable via UI):
  ```sql
  CREATE TABLE priority_policy (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    domain TEXT NOT NULL,  -- 'service_existence', 'api_contract', etc.
    source_priority TEXT[] NOT NULL,  -- ordered list of source types
    updated_by_user_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rationale TEXT,
    UNIQUE(tenant_id, domain)
  );
  ```

- **Conflict event lifecycle**:
  ```
  Ingestion adds/updates node with new provenance
       ↓
  System detects disagreement with existing data
       ↓
  System applies priority policy → computes "suggested winner"
       ↓
  Node enters conflict_state = 'pending'
       ↓
  conflict_event row created with both old + new values
       ↓
  Steward / Architect reviews in Forge UI (Governance Center)
       ↓
  Override recorded in audit log with reason
       ↓
  conflict_event closed:
     - 'auto_accepted_suggestion' OR
     - 'human_override'
       ↓
  Node updates conflict_state = 'resolved', conflict_id = ...
  ```

- **F-110 (Impact Analysis) behavior**:
  - Uses the priority_policy-resolved graph state for "current truth"
  - Reports `conflict_state = 'pending'` nodes as "potentially stale — review in Governance Center"
  - Surfaces conflicts in impact analysis reports (never silently ignores)

- **F-209 (Context-Aware Architecture Generation)**:
  - When generating ADRs/API contracts, the input must be the resolved truth
  - If `conflict_state = 'pending'` for any input node, the generation pipeline requires Steward resolution before proceeding (NFR-032 compliance)

### Positive Consequences

- **Day-one pilot correctness** — conflicts surface in the UI, not silently merged
- **Steward authority** — the priority policy is owned by the Steward role, not hardcoded
- **Tunable per pilot feedback** — without code changes, Steward can adjust the policy
- **Audit trail complete** — every conflict, every override, every rationale recorded
- **NFR-032 compliance** — no autonomous cross-boundary transitions; human in the loop
- **Pilot learnings feed back** — pilot metrics on conflict types feed policy refinement

### Negative Consequences

- **UI surface area** — Governance Center must include a Conflict Resolution view (additional UX work)
- **Operational overhead** — every brownfield project will surface dozens of conflicts initially; Steward must triage
- **Latency impact on F-110** — when conflicts are pending, impact analysis reports include "review required" annotations
- **Policy migration risk** — when the priority policy changes, in-flight conflicts may need re-resolution

### Neutral Consequences

- **Steward role responsibility increases** — from standards-author to also conflict-resolver
- **Pilot feedback loop** — Steward should expect to tune the policy 5-10 times during pilot based on observed conflicts

## Pros and Cons of the Options

### Option 1: Hybrid MDM + Steward-Editable Priority Policy

**Pros:**
- Pilot correctness from day one
- Steward authority over policy
- Tunable without code changes
- Complete audit trail
- NFR-032 compliance

**Cons:**
- UI surface area expansion
- Initial operational overhead (dozens of conflicts to triage)
- Latency impact on impact analysis reports during conflicts
- Policy migration requires re-resolution of in-flight conflicts

### Option 2: Code-Wins Always

**Pros:**
- Simplest implementation
- No conflict resolution UI

**Cons:**
- **Silently overwrites Jira/Confluence disagreements** — masks data quality issues
- M3 demo unsellable (no transparency on why a service is what it is)
- Violates pilot learning feedback loop (no human review of conflicts)
- NFR-032 risk (autonomous resolution of governance-boundary decisions)

### Option 3: Last-Write-Wins

**Pros:**
- Trivial implementation
- No policy to maintain

**Cons:**
- Random outcomes (depends on ingestion order)
- No audit trail of why a particular value won
- No way to express "code wins for runtime, Jira wins for workflow"

### Option 4: Manual-only

**Pros:**
- Maximum human oversight

**Cons:**
- Doesn't scale (every disagreement requires human review)
- Slows F-110 (impact analysis) when many conflicts
- No policy framework — every resolution is ad hoc

## Open Items (Deferred to Implementation ADR)

- **Conflict Resolution UI** — specific design of the Governance Center view
- **Steward assignment model** — single Steward per tenant vs. shared Steward pool
- **Conflict severity classification** — which conflict types are urgent vs. routine
- **Auto-suggestion algorithm** — how the system computes "suggested winner" from priority policy + provenance confidence
- **Conflict archive retention** — how long closed conflicts are retained in audit log

## References

- PRD §6.1 Open Questions — OQ-007
- PRD §4.2 Phase 0 (F-103, F-104, F-105, F-106, F-110)
- PRD §4.3 Phase 1 (F-208, F-209)
- PRD §5.8 NFR-032 (no autonomous cross-boundary transitions)
- `review-architecture.md` — flag: "Source-of-truth conflict policy (OQ-007) is unresolved but F-110 (Impact Analysis) and F-103/F-104 already presume one"
- `reconcile-brief.md` — qualitative-only signal: "Knowledge-in-individuals → system-as-property"
- `_bmad-output/research-forge-architecture-decisions-2026-06-20.md` — Q2 Source-of-Truth Conflict Resolution
- Wikipedia: Single Source of Truth (MDM, golden record patterns)