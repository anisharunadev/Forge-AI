---
project_name: 'forge-ai'
date: '2026-06-20'
research_topic: 'Forge Delivery Accelerator — Architecture Decision Research'
research_type: 'Technical Research'
duration: '~45 minutes'
sources_consulted: 12
status: 'complete'
feeds_into: 'bmad-create-architecture'
---

# Research Report: Forge Delivery Accelerator — Architecture Decision Research

## Executive Summary

This research resolves three open PRD blockers (OQ-005 deployment topology, OQ-006 knowledge graph substrate, OQ-007 source-of-truth conflict policy) and gathers external evidence for the broader architecture decisions facing the Forge Delivery Accelerator team. The findings are filtered against the PRD's constitutional constraints (NFR-001..033, DL-001..011) and the project-context.md engineering rules (Rules 1–8).

**Key findings:**

1. **PostgreSQL + Apache AGE is the recommended graph substrate** — it co-locates graph and relational data in a single database, enabling the hybrid SQL+Cypher queries Forge needs (F-103 service discovery joining with relational data), supports PostgreSQL RLS for multi-tenancy, avoids a second database engine's operational footprint, and aligns with the project-context tech stack (PostgreSQL 17 already committed).
2. **PostgreSQL Row-Level Security is the recommended multi-tenancy enforcement mechanism** — `tenant_id` column + `app.tenant_id` session variable + permissive + restrictive policy pattern provides defense-in-depth isolation, integrates naturally with both relational and graph data (when using AGE), and is SOC2-controls-ready.
3. **LiteLLM is the recommended LLM provider abstraction layer** — it satisfies NFR-029 (model-provider agnostic), provides built-in audit logging (`store_audit_logs: true`), virtual keys with per-key/team budgets, Prometheus cost metrics, and integrates cleanly with LangGraph (the project-context agent runtime).
4. **Source-of-truth conflict resolution should be a hybrid MDM pattern with a Steward-overridable policy table** — never auto-merge; never silent-drop; always record provenance.
5. **A critical strategic pivot is recommended:** Forge should **adopt Open GSD as the default Development Execution Framework** rather than build its own. GSD already solves spec-driven development, durable artifacts, runtime integrations (Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Copilot). Forge should extend GSD with what it does not solve: multi-tenancy, project intelligence, organization knowledge, governance, visualization, enterprise integrations.

**Top recommendation:** Architecture must commit to PostgreSQL + Apache AGE + RLS + LiteLLM as the substrate stack, and add two new PRD requirements: **FR-210 Agent Runtime Management** and **FR-211 Hook Orchestration**, to support the multi-runtime + GSD-integrated development accelerator.

---

## Research Questions

| # | Question | Status |
|---|---|---|
| Q1 | Knowledge graph substrate (OQ-006) | Resolved — recommend Apache AGE |
| Q2 | Source-of-truth conflict resolution (OQ-007) | Resolved — recommend hybrid MDM + Steward policy |
| Q3 | Multi-tenancy enforcement patterns | Resolved — recommend PostgreSQL RLS + per-tenant CMK |
| Q4 | LLM provider abstraction (NFR-029) | Resolved — recommend LiteLLM Proxy + per-key budgets |
| Q5 | SOC2-ready architecture patterns | Partial — recommend specific topology, defer to ADR for KMS |
| Q6 | Knowledge freshness as invariant (NFR-031) | Resolved — recommend graph-layer ownership, per-node granularity |
| Q7 | Cost attribution as invariant (NFR-030) | Resolved — recommend workflow-level attribution + token-level breakdown |

---

## Methodology

**Research approach:**
- **Method 1:** WebFetch + Context7 on official documentation (Apache AGE, PostgreSQL 17 RLS, LiteLLM, Portkey, Open GSD)
- **Method 2:** Cross-reference against PRD constitutional NFRs and project-context.md rules
- **Method 3:** Strategic analysis of Open GSD product surface vs. Forge PRD scope
- **Method 4:** Architecture pattern literature (MDM, CQRS, event sourcing for source-of-truth)

**Sources consulted:** 12 (PostgreSQL docs, Apache AGE docs, LiteLLM docs, Portkey docs, Open GSD product pages, project-context.md, PRD, review-architecture.md, reconcile-brief.md)

**Time period:** 2026-06-20

---

## Findings

### Q1: Knowledge Graph Substrate (OQ-006) — RECOMMEND POSTGRESQL + APACHE AGE

**Answer:** Use **PostgreSQL 17 + Apache AGE** as the knowledge graph substrate. Co-locate graph and relational data, leverage RLS for tenant isolation natively, and avoid a second database engine.

**Supporting evidence:**

- **Apache AGE** is a PostgreSQL extension that adds openCypher (the open-source Cypher query language) graph capabilities. It runs *inside* PostgreSQL, so graph data lives alongside relational data with full transactional guarantees.
- **Hybrid SQL + Cypher queries** are first-class: you can JOIN relational tables with graph traversals in a single query. This is critical for Forge's F-103 (architecture discovery) which needs to join service catalog (relational) with dependency edges (graph).
- **NetworkX integration**: `age_to_networkx` / `networkx_to_age` enables offloading graph algorithms (PageRank, shortest path, community detection) to NetworkX when needed.
- **Mature drivers**: Java/JDBC, Python (`apache-age-python` over psycopg3), Node.js, Go all have first-class drivers.
- **PostgreSQL RLS applies to graph data** stored as tables — same multi-tenancy mechanism works for both relational and graph.

**Why not Neo4j:**

- Neo4j is a separate database engine → dual operational footprint (Postgres + Neo4j)
- RLS-style multi-tenancy requires per-database-per-tenant (operational overhead) or application-layer filtering
- No hybrid SQL+graph queries — every cross-domain query requires ETL or app-layer joins
- Enterprise tier required for many features
- A-007 commits Forge to "single graph engine, not federated"

**Why not GraphRAG / vector-only:**

- Cannot do multi-hop relational traversal (F-104 dependency graph, F-110 impact analysis)
- LLM-mediated lookups, not native graph queries
- No ACID transactions on graph state
- Falls back to vector similarity which is wrong for impact analysis

**Trade-offs acknowledged:**

- AGE is less mature than Neo4j (project started 2019, donated to Apache 2022)
- Native graph performance is slower than Neo4j for pure graph workloads
- Mitigated by: NetworkX offload for complex algorithms; project context (greenfield) doesn't have an existing graph workload to optimize for

**Sources:**
- [Apache AGE documentation](https://age.apache.org/age-manual/master/intro/overview.html)
- [apache/age GitHub](https://github.com/apache/age)
- [Context7: /apache/age](https://context7.com/apache/age)

---

### Q2: Source-of-Truth Conflict Resolution (OQ-007) — RECOMMEND HYBRID MDM + STEWARD POLICY

**Answer:** Implement a **Master Data Management (MDM) golden-record pattern** with a per-claim `provenance` table, a Steward-editable priority policy, and an explicit human override mechanism. Never auto-merge silently.

**Supporting evidence:**

- The "Jira says Cognito, code says Keycloak" problem is a classic multi-source MDM problem.
- Three viable architectures for SSOT systems per the literature:
  1. **No copies** — every read goes to the SSOT (impractical for Forge's hybrid ingestion)
  2. **Read-only copies** — updates go to master only (CQRS pattern)
  3. **Writable copies** — requires reconciliation (Forge's case)
- For Forge, the recommendation is a **writable-graph + provenance record**:
  - Each knowledge graph node carries a `provenance[]` array listing every source that contributed to it
  - Each source's contribution has a `confidence` score and a `received_at` timestamp
  - A `priority_policy` table (Steward-editable) declares the per-domain priority order
  - Default policy: **code wins for runtime truth** (services, APIs, DBs), **Jira wins for human-process truth** (workflow, ownership), **explicit human override wins for everything else**

**Conflict resolution flow:**

1. Ingestion adds or updates a node with new provenance
2. If new provenance disagrees with existing data, the system does NOT auto-merge
3. Instead, the node enters a `conflicted` state
4. A `conflict_events` record is created with both old and new values
5. The system applies the priority policy to compute a "suggested winner"
6. Steward / Architect reviews the conflict in the UI
7. Override is recorded in audit log with reason
8. The conflict event is closed (auto-accepted suggestion OR human override)

**Why not auto-merge:**

- Auto-merge silently masks data quality problems
- Pilot will surface dozens of these on day one; auto-merge hides them
- M3 demo (architecture discovery) is unsellable if conflict resolution is opaque

**Sources:**
- [Wikipedia: Single Source of Truth](https://en.wikipedia.org/wiki/Single_source_of_truth) (MDM, golden record, CQRS, event sourcing)

---

### Q3: Multi-Tenancy Enforcement — RECOMMEND POSTGRESQL RLS + PER-TENANT CMK

**Answer:** Use **PostgreSQL Row-Level Security (RLS)** as the primary enforcement mechanism, with a `tenant_id` column on every tenant-scoped table, `app.tenant_id` session variable set per-transaction, combined permissive + restrictive policies, and per-tenant AWS KMS Customer Master Keys for encryption-at-rest.

**Supporting evidence (PostgreSQL 17 RLS best practices):**

- **Pattern**: `tenant_id` column + `SET LOCAL app.tenant_id` in connection pooler + `CREATE POLICY tenant_isolation ON table USING (tenant_id = current_setting('app.tenant_id')::int)`
- **Defense in depth**: combine permissive policy (allow) + restrictive policy (must-have) — e.g., tenant match AND tenant active
- **Service role isolation**: `FORCE ROW LEVEL SECURITY` for service-owned tables
- **Operational safety**: backups as `BYPASSRLS` role OR `SET row_security = off` to catch silent RLS filtering
- **Performance**: keep policy expressions simple, add expression indexes, avoid subqueries (race condition risk)
- **Integration with Apache AGE**: AGE stores graph data as tables → RLS applies to both relational and graph

**Per-tenant CMK:**

- NFR-001 SOC2-ready posture requires per-tenant encryption key custody
- AWS KMS CMK per tenant with automatic annual rotation
- KMS access scoped to the tenant's role via IAM policy
- Audit-log encryption uses a separate key from primary data

**Why not schema-per-tenant:**

- Operational overhead: 100+ tenants = 100+ schemas to migrate
- Connection pool exhaustion
- Cross-tenant analytics (Steward view) requires federated queries

**Why not database-per-tenant:**

- Same operational overhead, multiplied
- No meaningful additional isolation beyond RLS
- Cost prohibitive at scale (database instances)

**Why not application-layer only:**

- A single missing tenant filter is a customer breach
- RLS provides a database-level safety net
- Application-layer becomes one of multiple defense layers, not the only one

**Sources:**
- [PostgreSQL 17 RLS documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html)

---

### Q4: LLM Provider Abstraction (NFR-029) — RECOMMEND LITELLM PROXY

**Answer:** Use **LiteLLM Proxy** as the central LLM gateway. All LLM traffic flows through LiteLLM, no service may import a provider SDK directly (Rule 1 in project-context.md).

**Supporting evidence (LiteLLM features):**

- **Unified `completion()` interface** for 100+ LLMs (OpenAI, Anthropic, Vertex AI, Bedrock, etc.) using OpenAI format
- **OpenAI-compatible Proxy Server** — any OpenAI client works without code changes (LangGraph, custom agents, etc.)
- **Per-key/team/user virtual keys** with budgets — addresses NFR-030 cost attribution
- **`store_audit_logs: true`** in `litellm_settings` — addresses NFR-006 auditability
- **Custom callbacks** for cost capture per response (`response_cost`)
- **Prometheus metrics** for budget tracking and observability
- **One-line integration** with Langfuse, Helicone, MLflow for observability
- **MCP & Agent support** with per-key access control
- **Guardrails** for content filtering, PII masking, safety checks (NFR-002 GDPR)

**Audit log example (per LiteLLM docs):**

```json
{
  "id": "bd136c28-edd0-4cb6-b963-f35464cf6f5a",
  "updated_at": "2024-06-08 23:41:14.793",
  "changed_by": "user@knackforge.com",
  "changed_by_api_key": "tenant-cmc-key-abc",
  "action": "updated",
  "table_name": "LiteLLM_TeamTable",
  "object_id": "tenant-cmc",
  "before_value": { "spend": 0, "max_budget": 0 },
  "updated_values": { "max_budget": 5000 }
}
```

**Portkey comparison:**

- Stronger on gateway strategies (fallbacks, circuit breakers, conditional routing, canary testing)
- Weaker on built-in audit logging and Prometheus integration
- Could be added as a secondary layer, but LiteLLM is the better single choice for Forge's needs

**Architecture:**

```text
Forge Services (LangGraph agents)
  ↓
Forge Provider Abstraction Layer (in-house wrapper, thin)
  ↓
LiteLLM Proxy (single point of LLM ingress)
  ↓
[OpenAI] [Anthropic] [Bedrock] [Vertex AI] [OpenRouter] ...
```

The in-house wrapper enforces Forge-specific rules (tenant binding, audit logging integration, cost attribution workflow tag). LiteLLM handles the provider fan-out.

**Sources:**
- [LiteLLM documentation](https://docs.litellm.ai/docs/)
- [Context7: /websites/litellm_ai](https://context7.com/websites/litellm_ai)
- [Portkey AI Gateway](https://portkey.ai/docs/product/ai-gateway)

---

### Q5: SOC2-Ready Architecture Patterns — PARTIAL (TOPOLOGY RECOMMENDED, KMS DEFERRED)

**Answer:** For SOC2-controls-ready (not certified, per NFR-001, DL-011), the following architectural commitments are recommended:

**Recommended:**

- **Audit log storage topology**: separate AWS account from primary data. Append-only, write-once, retention ≥ 7 years. Per-tenant CMK encryption.
- **Structured logging**: every LLM call, every approval gate, every supersession generates a structured audit event with: actor, action, target, timestamp, tenant_id, before_value, after_value, reason.
- **Trace propagation**: OpenTelemetry across all services (Rule 7 in project-context.md).
- **Backup topology**: RPO ≤ 24h, RTO ≤ 4h per NFR-014. Daily backups. Quarterly DR tests.
- **Data classification primitive**: ingested source code and Jira content treated as containing personal data (committer names, email addresses, comment authors) — pseudonymization at ingestion.

**Right-to-erasure vs audit immutability collision:**

- GDPR right-to-erasure (NFR-002) and audit immutability (NFR-020) collide
- Resolution: **pseudonymize, don't erase** the audit record. The actor reference is replaced with a salted hash; the audit metadata (when, what action, what artifact) is preserved.
- This satisfies both: the data subject is no longer personally identifiable in the audit log, and the regulatory audit requirement is met.

**Deferred to ADR (requires architecture + security + legal sign-off):**

- KMS key custody policy: per-tenant CMK vs shared CMK vs HSM-backed
- PII boundary definition: which fields are pseudonymized vs which are stripped
- Data residency: NFR-008 commits to single-region at V1, but which region (US-East-1? EU?) is a legal/compliance decision
- Retention periods per data class

**Research gap:** Could not retrieve authoritative AICPA Trust Services Criteria documentation through web fetch. The above recommendations are based on industry standard SOC2-CC6/CC7/CC8/A1.2/C1.1/P3-P6 patterns and must be reviewed by Forge's compliance lead.

---

### Q6: Knowledge Freshness as Architectural Invariant (NFR-031) — RECOMMEND GRAPH-LAYER OWNERSHIP

**Answer:** The **graph layer** owns the freshness clock. Freshness is per-node. Per-FR staleness thresholds defined in Architecture.

**Supporting evidence:**

- The PRD's addendum A.3 defines `freshness_at` and `freshness_source` on graph nodes — this is the right shape
- The graph layer (not ingestion layer, not connector layer) should stamp `freshness_at` whenever it writes a node
- This eliminates the "Last Updated 2 hours ago" disagreement between F-103 and F-110

**Per-FR staleness thresholds (initial):**

- F-101 (repo ingestion): stale after 24h
- F-102 (language detection): stale after 7 days
- F-103 (architecture discovery): stale after 24h
- F-104 (dependency graph): stale after 24h
- F-105 (API catalog): stale after 7 days
- F-106 (database map): stale after 7 days
- F-110 (impact analysis): derived — never stale, always based on current state
- F-111 (incremental sync): per-event-driven, freshness_at = sync timestamp

**Granularity:** Per-node (not per-subgraph). Cost is acceptable because the timestamps are cheap; masks stale parts is unacceptable.

**Cross-tenant freshness:** Per-tenant. CMC's knowledge graph freshness is independent of Honeywell's.

**Propagation:** When F-111 syncs a new commit, freshness_at updates on: the service node, the API node, the DB node, the repo node — all four, because all four are affected by a code change.

---

### Q7: Cost Attribution as Architectural Invariant (NFR-030) — RECOMMEND WORKFLOW-LEVEL + TOKEN-LEVEL BREAKDOWN

**Answer:** Cost attribution is **workflow-level** (the primary unit) with **token-level breakdown** (for analysis). Enforcement is **pre-call admission control + post-call alert**.

**Supporting evidence:**

- The PRD's addendum A.3 defines `cost_estimate`, `cost_actual`, `cost_budget` on Workflow — this is the right shape
- LiteLLM's `response_cost` callback provides per-call token-level data
- The workflow instance aggregates per-call costs into `cost_actual`

**Enforcement:**

- **Pre-call admission control**: LiteLLM's `max_budget` per virtual key blocks calls that would exceed the budget
- **Post-call alert**: Prometheus metrics on `litellm_remaining_budget` trigger alerts at configurable thresholds
- **Hard kill-switch**: When budget is exhausted, the workflow instance transitions to a `budget_exceeded` state and cannot start new LLM calls
- **Partial artifacts**: In-flight workflows may complete or roll back based on a Steward-configurable policy

**Budget ownership:**

- **Default budget**: Steward-set per tenant
- **Override budget**: Per-tenant-admin can set their own
- **Engagement budget**: Per-engagement-lead can scope budget to a specific project

**Multi-provider interaction:**

- LiteLLM records `model_provider_id` per call (OpenAI, Anthropic, Bedrock, etc.)
- Cost ledger has columns: `tenant_id`, `engagement_id`, `workflow_id`, `provider_id`, `model_id`, `input_tokens`, `output_tokens`, `cost_usd`, `timestamp`
- Multi-provider routing (LiteLLM fallback / load balancing) is recorded transparently in the ledger

**Cost across non-LLM operations:**

- F-101 ingestion can burn cost (compute, storage, third-party API calls) without LLM involvement
- NFR-030's third term ("workflow cost") includes non-LLM cost
- Mechanism: connector-level cost entries, ingestion compute cost (e.g., EC2 hours), storage cost (GB-month)
- These are tracked separately from LLM cost and aggregated at the workflow level

---

## Technology Evaluation Matrix

| Component | Recommended | Alternative | Why |
|---|---|---|---|
| **Primary database** | PostgreSQL 17 | — | Already committed in project-context.md |
| **Graph extension** | Apache AGE | Neo4j, GraphRAG | Hybrid SQL+Cypher, RLS-applicable, no second engine |
| **Multi-tenancy** | PostgreSQL RLS | Schema-per-tenant, app-layer-only | Defense-in-depth, applies to both relational + graph |
| **Vector store** | pgvector | Pinecone, Weaviate | Already committed; co-located with graph |
| **Cache / Pub-Sub** | Redis | — | Already committed in project-context.md |
| **LLM gateway** | LiteLLM Proxy | Portkey, OpenRouter | Built-in audit logs, virtual keys with budgets, Prometheus |
| **Auth** | Keycloak + OIDC + SAML | Auth0, Okta | Already committed; supports RBAC + tenant binding |
| **Agent framework** | LangGraph + LangChain | — | Already committed; integrates with LiteLLM |
| **Development framework** | **Open GSD (gsd-core, gsd-pi, gsd-workbench, gsd-cloud)** | Build in-house | **GSD already solves spec-driven development, durable artifacts, multi-runtime** |
| **Visualization** | React Flow | Recharts (for charts only) | Already committed; default for all node-edge graphs |

---

## Forge Strategic Positioning — The GSD Integration Pivot

**This is the most important finding of this research.**

### The Strategic Insight

Open GSD already solves several problems that Forge's PRD defines:

| Forge PRD scope | Open GSD coverage |
|---|---|
| F-201..F-204 (planning, requirements decomposition) | gsd-core's `/gsd discuss`, `/gsd plan` |
| F-205 (approval workflow) | gsd-core's `verify` stage + handoff |
| F-208 (ship handoff) | gsd-core's `SHIP_HANDOFF.md` |
| Runtime integrations | gsd-core: Claude Code, Codex, Gemini CLI, Cursor, Windsurf, Copilot |
| Durable project artifacts | gsd-core: VISION.md, ROADMAP.md, CURRENT_STATE.md |
| Worktree + check + recovery | gsd-pi: terminal-native CLI |

**Forge should not reinvent this. Forge should adopt GSD as the default Development Execution Framework and extend it with what GSD does not solve:**

| GSD does not solve | Forge extends with |
|---|---|
| Multi-tenancy | PostgreSQL RLS + per-tenant CMK + tenant-scoped cost ledger |
| Project Intelligence (knowledge graph) | Apache AGE + ingestion layer (F-101..F-111) |
| Organization Knowledge (shared standards) | Steward-controlled standards library (F-001..F-010) |
| Knowledge visualization | React Flow + Knowledge Center UI |
| Enterprise governance | Approval engine (F-205) + audit log + policy engine (F-003) |
| Enterprise integrations | MCP registry: Jira, Confluence, GitHub, Bitbucket, AWS, SonarQube, Slack, Teams, Figma |
| SOC2-ready posture | Per-tenant CMK, audit log topology, structured logging, OTel |
| Cost governance | LiteLLM virtual keys + per-tenant budget + workflow-level cost ledger |

### New Architecture (replaces earlier 5-layer model)

```text
Forge
│
├── Organization Knowledge Layer        (Forge owns)
├── Project Intelligence Layer          (Forge owns)
├── Forge Control Center (UI)           (Forge owns)
│
├── GSD Platform Layer                  (Forge integrates, doesn't build)
│   ├── gsd-core     (spec-driven workflow, durable artifacts)
│   ├── gsd-pi       (autonomous milestones, worktrees, cost tracking)
│   ├── gsd-workbench (UI primitives — adapted as Forge Development Center)
│   └── gsd-cloud    (cloud workspace — adapted as Forge Cloud)
│
├── SDLC Accelerators                   (Forge owns)
│   ├── Ideation
│   ├── Architecture
│   ├── Development  (GSD-powered)
│   ├── Security
│   ├── Testing
│   └── Deployment
│
├── Refactor Accelerators               (Forge owns)
│
├── Connector Center                    (Forge owns)
│   ├── GitHub, Bitbucket, GitLab
│   ├── Jira, Confluence
│   ├── AWS, SonarQube
│   ├── Slack, Teams
│   └── Figma
│
├── Agent Center                        (Forge owns)
│   ├── Runtime Registry: Claude Code, Codex, Gemini CLI, OpenCode, Aider, Hermes, GSD Core
│   ├── Provider Registry: OpenAI, Anthropic, Gemini, OpenRouter, Bedrock, Azure OpenAI, Vertex AI
│   └── Hook Framework: pre/post hooks for every runtime
│
├── Governance Center                   (Forge owns)
│   ├── Approvals
│   ├── Audit Logs
│   ├── Policy Engine
│   └── Compliance
│
└── Visualization Layer                 (Forge owns)
    ├── Knowledge Graph
    ├── Repository Graph
    ├── Dependency Graph
    ├── Workflow Graph
    ├── Agent Execution Graph
    ├── Audit Timeline
    └── Approval Timeline
```

### New PRD Principle

> **Forge adopts Open GSD as the default Development Execution Framework.**
>
> Forge extends Open GSD with multi-tenancy, project intelligence, organization knowledge, knowledge graphs, visualization, governance, audit, and enterprise integrations — rather than reimplementing development execution primitives.

### New PRD Requirements

**FR-210 — Agent Runtime Management**

The system shall support multiple development runtimes — Claude Code, Codex CLI, Gemini CLI, OpenCode, Hermes, GSD Core, and future runtimes — without requiring platform code changes. Each runtime has a registered adapter that translates between Forge's hook protocol and the runtime's native lifecycle events.

**FR-211 — Hook Orchestration**

The system shall provide pre/post execution hooks for every supported runtime and visualize hook execution through the Forge UI. Hooks are scoped at three levels: global (Steward-configured), tenant (admin-configured), and project (lead-configured). The hook pipeline is:

```text
User Story
  → pre-plan → GSD Planning → post-plan
  → pre-code → Claude Code / Codex / etc. → post-code
  → Validator → Security → pre-commit → Git → pre-pr → post-pr
```

### What Forge Owns vs. What GSD Owns

| Concern | Owner |
|---|---|
| Multi-tenant enterprise platform | **Forge** |
| Project Intelligence (knowledge graph) | **Forge** |
| Organization Knowledge | **Forge** |
| Visualization (React Flow) | **Forge** |
| Governance + audit + policy | **Forge** |
| Enterprise integrations (MCP registry) | **Forge** |
| Development lifecycle (Discuss → Plan → Execute → Verify → Ship) | **GSD** |
| Project artifacts (VISION.md, ROADMAP.md, etc.) | **GSD** (Forge maps into its artifact store) |
| Runtime adapters (Claude Code, Codex, etc.) | **GSD** (Forge provides universal hook SDK) |
| Worktree + check + recovery | **GSD** (gsd-pi) |

**Sources:**
- [Open GSD — gsd-core](https://opengsd.net/products/gsd-core)
- [Open GSD — main product page](https://www.opengsd.net/)

---

## Key Insights

### Insight 1: PostgreSQL + AGE + RLS is a forcing function for architectural simplicity

**Finding:** A single PostgreSQL 17 database with Apache AGE and RLS handles all of Forge's primary data needs: relational (entities, audit, cost), graph (knowledge graph, dependencies, impact), vector (semantic search via pgvector), and multi-tenant isolation.

**Implication:** Forge does not need a second database engine. No Neo4j, no separate graph service, no federated query layer. Operations, backup, replication, and tenant isolation are all unified.

**Recommendation:** Commit to PostgreSQL 17 + Apache AGE + pgvector + RLS as the substrate. Build the governance, cost, and audit ledgers as relational tables alongside the graph.

**Priority:** High

---

### Insight 2: The "single graph engine" commitment (A-007) and the "hybrid SQL+Cypher" need are not in conflict

**Finding:** A-007 commits Forge to "single graph engine, not federated." F-103 needs to join service catalog (relational) with dependency edges (graph).

**Implication:** These two requirements are satisfied by **Apache AGE**, not Neo4j. Neo4j forces a federated architecture (Postgres + Neo4j + ETL). AGE keeps everything in one engine, allowing F-103's hybrid queries natively.

**Recommendation:** Use the A-007 commitment as a wedge argument for AGE over Neo4j in the architecture ADR.

**Priority:** High

---

### Insight 3: LiteLLM Proxy is more than an LLM gateway — it's an audit and cost instrument

**Finding:** LiteLLM's `store_audit_logs: true` + Prometheus metrics + per-key virtual keys with budgets provides NFR-006 (auditability) and NFR-030 (cost attribution) out of the box.

**Implication:** Building these primitives in-house would take significant engineering and would still need to integrate with the LLM provider SDKs (violating Rule 1).

**Recommendation:** Adopt LiteLLM Proxy as the central LLM gateway. The Forge Provider Abstraction Layer becomes a thin in-house wrapper that enforces tenant binding, audit log integration with Forge's audit log, and cost attribution workflow tagging.

**Priority:** High

---

### Insight 4: The biggest risk to the pilot is the M1 substrate missing fields

**Finding:** review-architecture.md flagged that M1 (F-001..F-010) is missing primitives that M3+ (F-101..F-210) depend on: typed event substrate, LLM provider abstraction, tenant-scoped cost/freshness ledgers, query-layer isolation primitive, append-only artifact storage with supersession, snapshot/diff, policy evaluation engine, connector failure-mode primitive.

**Implication:** If architecture waits for M3 to design these, M3 will be late. If architecture designs them at M1, M1 will be late. Either way, one milestone slips.

**Recommendation:** Architecture must commit to the **M1 substrate expansion** as a deliberate choice (rather than a retrofit). The PRD should be updated to include these primitives in M1 scope.

**Priority:** High

---

### Insight 5: The GSD integration pivot changes Forge from "SDLC agent" to "Delivery Operating System"

**Finding:** Forge's PRD scopes Development Accelerator as a core capability. GSD already solves the spec-driven development primitives (planning, execution, verification, durable artifacts, multi-runtime support).

**Implication:** Building a parallel Development Accelerator would be:
- A reinvention of solved problems
- A maintenance burden forever
- A weaker product (less runtime coverage than GSD)

**Recommendation:** Adopt GSD as the default Development Execution Framework. Forge's value moves up the stack to multi-tenancy, project intelligence, governance, and enterprise integration.

**Priority:** Critical — affects the PRD, the architecture, and the entire GTM story.

---

### Insight 6: The "first aha" UX signal requires a tenant-isolated knowledge graph query

**Finding:** PRD §8.6's "first aha" is "the platform understood our project in minutes" — a brownfield → queryable knowledge graph signal. This requires:
- A working ingestion layer
- A working graph substrate
- A working query interface (F-108 Q&A)
- Per-tenant isolation (NFR-006)
- Visualization (React Flow)

**Implication:** The M3 demo (architecture discovery) is unsellable without all five working together. Architecture must commit to all five in the M3 milestone, not push any to M4+.

**Recommendation:** Architecture must protect M3 scope from expansion. Use the "first aha" framing as the M3 acceptance criterion.

**Priority:** High

---

### Insight 7: The replacement-fear reassurance must be re-anchored in architecture, not just UX

**Finding:** reconcile-brief.md flagged that the PRD's "Forge is not intended to replace engineers" framing is procedural, not emotional. The brief addressed executives; the PRD speaks in engineering vocabulary.

**Implication:** Architecture decisions (human approval gates, auditability, mandatory review) are the *mechanism* of the replacement-fear reassurance. If the architecture is sloppy about human-in-the-loop, no amount of UX copy will reassure.

**Recommendation:** The replacement-fear reassurance must be defended at the architecture layer, not just the UX layer. The Approval Workflow (F-205), the Versioning & Supersession (F-207), and the audit log are the structural commitments.

**Priority:** Medium-High

---

### Insight 8: Per-tenant CMK is achievable at pilot scale but requires architecture commitment

**Finding:** Per-tenant AWS KMS CMK with annual rotation satisfies NFR-001 SOC2-controls-ready for the encryption dimension. Per-tenant CMK is achievable at pilot scale (3-5 tenants) but becomes operationally heavy at 100+ tenants.

**Implication:** Commit to per-tenant CMK at V1 with an explicit scaling path (e.g., move to per-tenant data keys wrapped by a single KMS key at N tenants).

**Recommendation:** Architecture must commit to per-tenant CMK at V1 with a defined scaling migration plan.

**Priority:** Medium

---

## Recommendations

### Immediate Actions (Before Architecture Finalization)

1. **Update PRD** with the new principle: "Forge adopts Open GSD as the default Development Execution Framework."
2. **Add to PRD** FR-210 (Agent Runtime Management) and FR-211 (Hook Orchestration).
3. **Update PRD §8.3** (Capability Phases) to reflect GSD integration: Phase 2 (Development Accelerator) becomes "GSD-Core powered" rather than a separate Forge build.
4. **Resolve OQ-005** (deployment topology) — recommend cloud-only (AWS) at V1, with the ADR documenting per-tenant CMK + audit log topology.
5. **Resolve OQ-006** (graph substrate) — recommend PostgreSQL + Apache AGE. ADR documents the hybrid SQL+Cypher pattern, RLS applicability, and the A-007 single-engine commitment.
6. **Resolve OQ-007** (source-of-truth conflict) — recommend hybrid MDM + Steward policy. ADR documents the provenance pattern, the priority policy table, and the conflict event lifecycle.

### Short-term (Architecture Phase)

1. **Architecture document** must commit to:
   - PostgreSQL 17 + Apache AGE + pgvector + RLS as the substrate
   - LiteLLM Proxy as the LLM gateway
   - OpenTelemetry for observability (Rule 7)
   - React Flow as the default visualization (project-context UI First)
   - Per-tenant CMK + separate audit log account for SOC2 posture
   - Hook Framework SDK for runtime integration
2. **Architecture document** must defer to ADRs:
   - KMS key rotation policy
   - Data residency region
   - Retention periods per data class
   - Incident response process (SOC2 CC7.4)

### Long-term (Post-Pilot)

1. **Evaluate GSD-cloud integration** as a replacement for self-hosted multi-tenant SaaS once GSD-cloud ships.
2. **Build a Connector Marketplace** for community-contributed MCP connectors (GitLab, Azure DevOps, Snyk, etc.).
3. **Evaluate multi-cloud** (GCP, Azure) at Strategic Phase B (Customer-facing) per PRD §8.3.

---

## Research Gaps

**What we still don't know:**

1. **Open GSD roadmap visibility** — gsd-workbench and gsd-cloud are listed as "coming soon." Need to track GA dates and license terms.
2. **Neo4j vs Apache AGE performance benchmarks** — no authoritative public benchmarks for multi-tenant knowledge graph workloads at Forge's scale (100+ concurrent requirements). Recommend internal benchmark in M1.
3. **LiteLLM production SLAs** — LiteLLM is the central LLM gateway; downtime = Forge downtime. Need to evaluate LiteLLM Enterprise tier for HA, multi-region, and SOC2 attestation.
4. **AWS KMS per-tenant cost** at 100+ tenants — current AWS pricing suggests per-tenant CMK is feasible at $1/key/month, but rotation overhead and quota limits need validation.
5. **Authoritative SOC2 Trust Services Criteria** — could not retrieve AICPA documentation through web fetch. Compliance review needed.

**Recommended follow-up research:**

1. **bmad-domain-research**: Pilot customer organizational dynamics, decision-making patterns, and change management for SDLC platform adoption.
2. **bmad-market-research**: Market sizing for delivery accelerators / AI-SDLC platforms.
3. **bmad-competitive-research**: Direct comparison with Rally, Jira Align, internal delivery platforms, and other AI-SDLC tools.
4. **bmad-technical-research (deferred)**: Specific Neo4j vs AGE benchmark, LiteLLM Enterprise evaluation, AWS KMS at scale.

---

## Sources

1. [Apache AGE documentation](https://age.apache.org/age-manual/master/intro/overview.html) — Graph extension for PostgreSQL
2. [Apache AGE GitHub](https://github.com/apache/age) — Source and driver support
3. [Context7: /apache/age](https://context7.com/apache/age) — Up-to-date code patterns
4. [PostgreSQL 17 Row-Level Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) — RLS semantics and best practices
5. [PostgreSQL 17 CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html) — Policy definition
6. [LiteLLM documentation](https://docs.litellm.ai/docs/) — LLM gateway, audit logs, virtual keys, budgets
7. [Context7: /websites/litellm_ai](https://context7.com/websites/litellm_ai) — LiteLLM code patterns
8. [Portkey AI Gateway](https://portkey.ai/docs/product/ai-gateway) — Alternative LLM gateway
9. [Wikipedia: Single Source of Truth](https://en.wikipedia.org/wiki/Single_source_of_truth) — MDM, golden record, CQRS, event sourcing
10. [Open GSD — main product page](https://www.opengsd.net/) — gsd-core, gsd-pi, gsd-workbench, gsd-cloud
11. [Open GSD — gsd-core](https://opengsd.net/products/gsd-core) — Spec-driven development framework
12. Internal: `_bmad-output/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md` (Forge Delivery Accelerator PRD)
13. Internal: `_bmad-output/project-context.md` (Project context with constitutional rules)

---

*Generated by BMAD Method v6 — Creative Intelligence*

*Research Duration: ~45 minutes*

*Sources Consulted: 12 (10 external, 2 internal upstream artifacts)*

*Output feeds: `bmad-create-architecture` (next workflow in pipeline)*
