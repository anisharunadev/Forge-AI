# Forge Backend — Phase 3 Implementation Spec

> **Phase:** 3 of 4 — Productivity
> **Goal of this doc:** spec the 5 features in Phase 3 with explicit goals, contracts, and acceptance criteria — no code, just the contract.
> **Depends on:** Phase 1 (Config, Models, Keys, Chat SSE, Spend), Phase 2 (Guardrails, Policies, MCP, Skills, Tools).
> **Source API:** LiteLLM `1.82.6` at `https://litellm-api.up.railway.app/` (see `forge-litellm-integration.md` for full endpoint map).

---

## Phase 3 Goal (one sentence)

**Make Forge AI usable at scale for real engineering work: a versioned prompt library, full multi-tenant RBAC (users / teams / orgs / projects), a real RAG pipeline (embeddings + vector stores + OCR + rerank + hybrid search), long-running async workloads (files / batches / fine-tuning), and the audit + health + compliance observability layer that enterprise buyers require.**

After Phase 3 ships, Forge AI is enterprise-grade: tenant onboarding is real, knowledge is queryable, jobs run for hours, and the auditors can ask any question and get an answer.

---

## Phase 3 Success Criteria (Definition of Done)

Phase 3 is done only when **all** are true:

1. ✅ Prompts are versioned, testable, and renderable; one prompt change does not affect existing pinned versions.
2. ✅ A complete org → team → user → project → agent hierarchy can be created, scoped, and torn down via API.
3. ✅ A document can be uploaded, OCR'd (if image/PDF), chunked, embedded, stored, and retrieved with sub-second latency at 100k chunks.
4. ✅ A batch of 10,000 chat completions can be submitted, polled, cancelled, and have its results streamed back.
5. ✅ Fine-tuning jobs can be created, polled, and cancelled.
6. ✅ Every Phase 1/2/3 action is captured in the audit log with retention policy applied.
7. ✅ `/api/forge/health` exposes LiteLLM version, model count, key count, MCP server count, vector store count, and per-feature health.
8. ✅ EU AI Act and GDPR compliance reports can be generated on demand.
9. ✅ Cost alerts fire within 60 seconds of a tenant crossing a budget threshold.
10. ✅ Phase 1 + Phase 2 acceptance criteria still pass — no regression.

---

## Feature Map

| # | Feature | LiteLLM endpoints | Forge-side module |
|---|---|---|---|
| 11 | **Prompts (versioned library)** | `/prompts/list`, `/prompts/info`, `/prompts/versions`, `/prompts/test`, `/utils/dotprompt_json_converter`, `/utils/transform_request`, `/utils/supported_openai_params`, `/utils/token_counter` | `forge.prompts` |
| 12 | **Users / Teams / Orgs / Projects (RBAC)** | `/user/new`, `/user/update`, `/user/delete`, `/user/list`, `/user/info`, `/v2/user/*`, `/team/new`, `/team/update`, `/team/delete`, `/team/info`, `/team/list`, `/team/member_*`, `/team/bulk_member_add`, `/team/model/*`, `/team/daily`, `/team/available`, `/team/permissions_*`, `/team/block`, `/team/unblock`, `/v2/team/*`, `/organization/*`, `/project/*`, `/customer/*` | `forge.rbac` |
| 13 | **Embeddings + Vector stores + RAG** | `/v1/embeddings`, `/embeddings`, `/engines/embeddings`, `/v1/vector_stores`, `/vector_stores/{id}/files`, `/v1/vector_stores/{id}/search`, `/vector_stores/{id}/search`, `/vector_store/new`, `/vector_store/list`, `/vector_store/info`, `/vector_store/update`, `/vector_store/delete`, `/v1/rag/ingest`, `/rag/query`, `/v1/rerank`, `/v1/rerank`, `/v2/rerank`, `/ocr`, `/v1/ocr`, `/search_tools/*`, `/v1/indexes` | `forge.rag` |
| 14 | **Files / Batches / Fine-tuning** | `/v1/files`, `/files`, `/files/content`, `/{provider}/v1/files`, `/v1/files/{id}/content`, `/v1/batches`, `/batches`, `/{provider}/v1/batches`, `/v1/batches/{id}/cancel`, `/batches/cancel`, `/fine_tuning/jobs`, `/v1/fine_tuning/jobs`, `/v1/responses`, `/responses`, `/v1beta/interactions`, `/responses/{id}/cancel`, `/responses/{id}/input_items`, `/responses/compact` | `forge.async` |
| 15 | **Audit / Health / Compliance** | `/audit`, `/api/event_logging`, `/health`, `/health/readiness`, `/health/liveness`, `/health/liveliness`, `/health/services`, `/health/history`, `/health/latest`, `/health/shared-status`, `/health/license`, `/health/backlog`, `/health/test_connection`, `/compliance/eu-ai-act`, `/compliance/gdpr`, `/in_product_nudges`, `/callback` | `forge.observability` |

---

## Feature 11 — Prompts (versioned library)

### Goal
A **prompt is a versioned, renderable, testable template** — distinct from a Skill (which composes Prompt + Tools + Config). The library lets teams own prompts independently of skills, run A/B tests, and roll back without touching agent configs.

### Spec

**Prompt object:**
```yaml
Prompt {
  id, name, version, status: draft | active | archived
  template: string              # Jinja2-style with {{variables}} and {% if %} blocks
  model_defaults: {
    model?: string
    temperature?: number
    max_tokens?: number
    top_p?: number
    response_format?: json | text
  }
  variables: VariableSpec[]    # declared for UI form generation
  metadata: {
    forge_tenant_id, created_by, created_at, updated_at
    category: system | user | tool | custom
    tags: string[]
    source: "manual" | "from-skill" | "from-dotprompt"
  }
}
```

**CRUD:**
- `POST /api/forge/prompts` (admin) — create.
- `GET /api/forge/prompts?name=X&version=N` — fetch.
- `PATCH /api/forge/prompts/:id` — creates a new version; previous version stays active.
- `GET /api/forge/prompts/:id/versions` — list versions.
- `POST /api/forge/prompts/:id/archive` — archive (cannot be referenced by new agents).

**Versioning rules:**
- Versions are immutable once active.
- Auto-increment integer on every update.
- Up to 100 versions per prompt; older versions auto-archived.
- Pinning: agents/skills pin to `(name, version)`. No auto-upgrade.
- Diff: `GET /api/forge/prompts/:id/diff?from=v1&to=v2` returns the rendered diff.

**Variable system:**
- `{{variable}}` substitution.
- `{% if condition %}…{% endif %}` conditional blocks.
- `{% for item in list %}…{% endfor %}` iteration.
- Variables can be `string`, `number`, `boolean`, `enum`, `array`, `object`.
- `variables` field declares schema → UI auto-generates a form for testing.

**Test execution:**
- `POST /api/forge/prompts/:id/test` with `{ variables, model_override? }` → calls LiteLLM `/prompts/test`.
- Returns: `{ rendered_prompt, response, usage, cost_usd, latency_ms }`.
- Does NOT save the result or affect spend reconciliation (test calls are tagged `test: true`).

**Token counting (dry-run):**
- `POST /api/forge/prompts/:id/count` with variables → calls `/utils/token_counter`.
- Returns: `{ input_tokens, model_max_context, fits: boolean }`.
- Used by UI to warn before submitting prompts that exceed context.

**Supported OpenAI params (`/utils/supported_openai_params`):**
- Forge Backend caches this per model. Used to filter which params can be set per prompt.

**Dotprompt import (`/utils/dotprompt_json_converter`):**
- Import `.prompt` files (Google's dotprompt format) → JSON Prompt.
- Used for portability with other tools.

**Transform request (`/utils/transform_request`):**
- Render a prompt with variables → final chat-completion request body.
- Used by both Skills (Phase 2) and standalone prompt tests.

**Relationship to Skills (Phase 2):**
- A Skill can reference multiple Prompts.
- A Prompt can be promoted to a Skill by wrapping with Tools + Config.
- Prompts exist independently for teams that want template management without skill overhead.

**Audit:**
- `forge.prompts.created | updated | archived | version_pinned | tested | imported`
- `forge.prompts.rendered` (low-volume event, only for production renderings, not tests)

### LiteLLM endpoints used
- `GET /prompts/list`
- `GET /prompts/info?prompt_id=…`
- `GET /prompts/versions?prompt_id=…`
- `POST /prompts/test`
- `POST /utils/dotprompt_json_converter`
- `POST /utils/transform_request`
- `GET /utils/supported_openai_params`
- `POST /utils/token_counter`

### Forge Backend contract
- `GET /api/forge/prompts` — list (filterable by name, version, status, category, tag)
- `POST /api/forge/prompts` — admin: create
- `GET /api/forge/prompts/:id` — detail (specific version)
- `PATCH /api/forge/prompts/:id` — update (new version)
- `POST /api/forge/prompts/:id/archive` — archive
- `GET /api/forge/prompts/:id/versions` — version list
- `GET /api/forge/prompts/:id/diff?from=v1&to=v2` — version diff
- `POST /api/forge/prompts/:id/test` — dry-run
- `POST /api/forge/prompts/:id/count` — token estimate
- `POST /api/forge/prompts/import-dotprompt` — admin: import `.prompt` file
- `POST /api/forge/prompts/preview` — render with sample variables (no chat call)

### Acceptance criteria
1. Creating a prompt and rendering it via `/preview` produces the expected string with all variables substituted.
2. Updating a prompt creates a new version; agents pinned to the old version still render the old template.
3. A prompt referencing an undeclared variable returns a typed error at render time, not at chat time.
4. Token count via `/count` matches actual token usage within 5% (validated against 100 real chat completions).
5. Dotprompt import of a valid `.prompt` file produces an equivalent JSON Prompt.
6. `/prompts/test` with `model_override` actually calls the model and returns usage + cost.
7. Archiving a prompt blocks new agent references but existing references continue to work.
8. Variable schema auto-generates a UI form (verified by inspecting the response and confirming it has `properties`, `required`, `enum` fields).
9. `forge.prompts.version_pinned` audit event fires when an agent/skill is created referencing a specific version.
10. Version diff endpoint highlights added/removed/modified sections using a unified diff format.

---

## Feature 12 — Users / Teams / Orgs / Projects (RBAC)

### Goal
Forge becomes a **multi-tenant platform with proper role-based access control**. An organization owns teams; teams own users; projects scope work; agents and keys hang off projects. Permissions inherit from org → team → user, with explicit overrides anywhere.

### Spec

**Hierarchy:**
```
Organization
└── Team (1..n)
    ├── User (member)
    └── Project (work unit)
        ├── Agent
        ├── Skill (refs)
        ├── Vector Store (refs)
        └── MCP Server (refs)
```

**Each entity owns:**
- `Organization`: brand, billing, top-level policies, default teams, all customer accounts.
- `Team`: model allowlist, default agent configs, members, child projects.
- `User`: personal keys, personal settings, audit access (own actions only by default).
- `Project`: agent cluster, knowledge base, MCP servers, agent execution scope.
- `Customer` (optional, for white-label): end-customer account under an org with their own users/teams/budgets.

**CRUD endpoints (Forge-side, all tenant-scoped):**
- Organizations: list, get, create, update, delete (super-admin only).
- Teams: list, get, create, update, delete (org-admin).
- Team members: add (single + bulk), update role, remove, list.
- Users: list, get, create, update, delete; `available_users` for invite picker.
- Projects: list, get, create, update, delete (team-admin).
- Customers: list, get, create, update, delete, block, unblock (org-admin).
- `team/block`, `team/unblock` — emergency stop on a team's keys.
- `team/permissions_list`, `team/permissions_update` — per-team role/permission overrides.

**RBAC model:**

| Role | Scope | Can |
|---|---|---|
| `super_admin` | Platform | Everything |
| `org_admin` | Organization | Manage teams, projects, policies, billing |
| `team_admin` | Team | Manage team members, agents, keys, MCP servers |
| `project_admin` | Project | Manage agents, knowledge, MCP, vector stores |
| `member` | Team | Run agents, view own usage, read team resources |
| `viewer` | Team | Read-only access to dashboards |
| `customer_admin` | Customer | Manage customer users + projects |

**Inheritance:**
- Default: org role permissions inherit down. A `team_admin` can do everything a `member` can.
- Overrides: explicit grants/restrictions per level. Higher-priority grants **add** permissions; restrictions **remove** them.
- Conflicting grants: deny wins (matching policy system from Phase 2).

**Member management:**
- `POST /api/forge/teams/:id/members` — single add.
- `POST /api/forge/teams/:id/members/bulk` — CSV / JSON list add (atomic or per-row).
- `PATCH /api/forge/teams/:id/members/:user_id` — change role.
- `DELETE /api/forge/teams/:id/members/:user_id` — remove.
- All emit `forge.rbac.member_*` audit events.

**Tag-based access:**
- Users, agents, projects can carry tags (`frontend`, `backend`, `pii-sensitive`).
- Policies (Phase 2) can match on tags; access grants can match on tags.
- `team/model` endpoints let admins set per-team model allowlists.

**Daily activity endpoints (`/user/daily`, `/team/daily`, `/organization/daily`, `/customer/daily`, `/agent/daily`):**
- Forge Backend reads these for dashboards. Cached for 60s.
- Powers the "spend per user / team / org" widgets.

**Audit:**
- Every CRUD emits `forge.rbac.{entity}_created | _updated | _deleted | _archived`.
- Role changes emit `forge.rbac.role_changed` with old + new role.
- Permission overrides emit `forge.rbac.permission_granted | permission_revoked`.

**Customer accounts (white-label):**
- Each customer has its own org-like boundary.
- Customer users cannot see other customers' data.
- Customer spend is rolled up to the parent org for billing.

**Onboarding (integration with Phase 1 onboarding wizard):**
- Wizard step 1 (tenant setup) → `POST /organization/new`.
- Wizard step 2 (connect repos) → grants access to the team's projects.
- Wizard step 4 (configure agents) → agents are scoped to projects.

**Migration path:**
- Single-tenant Forge → multi-tenant Forge requires org + team bootstrapping.
- Forge Backend provides `POST /api/forge/admin/bootstrap-tenant` for super-admins.

### LiteLLM endpoints used
- `POST /user/new`, `GET /user/list`, `GET /user/info`, `POST /user/update`, `POST /user/delete`, `POST /user/bulk_update`, `GET /user/available_users`, `/v2/user/*`
- `POST /team/new`, `GET /team/list`, `GET /team/info`, `POST /team/update`, `POST /team/delete`, `/v2/team/*`
- `POST /team/member_add`, `POST /team/member_delete`, `POST /team/member_update`, `POST /team/bulk_member_add`
- `POST /team/model/add`, `POST /team/model/delete`
- `GET /team/available`, `GET /team/daily`
- `POST /team/block`, `POST /team/unblock`
- `GET /team/permissions_list`, `POST /team/permissions_update`
- `POST /organization/new`, `GET /organization/list`, `GET /organization/info`, `POST /organization/update`, `POST /organization/delete`
- `POST /organization/member_add`, `POST /organization/member_update`, `POST /organization/member_delete`
- `GET /organization/daily`
- `POST /project/new`, `GET /project/list`, `GET /project/info`, `POST /project/update`, `POST /project/delete`
- `POST /customer/new`, `GET /customer/list`, `GET /customer/info`, `POST /customer/update`, `POST /customer/delete`
- `POST /customer/block`, `POST /customer/unblock`
- `GET /customer/daily`

### Forge Backend contract
- `GET /api/forge/orgs` — list orgs (super-admin)
- `POST /api/forge/orgs` — create org (super-admin)
- `GET /api/forge/orgs/:id` — detail
- `PATCH /api/forge/orgs/:id` — update
- `DELETE /api/forge/orgs/:id` — delete (super-admin)
- `GET /api/forge/orgs/:id/teams` — teams in org
- `GET /api/forge/orgs/:id/daily` — daily rollup
- `GET /api/forge/teams` — teams in caller's scope
- `POST /api/forge/teams` — create (org-admin)
- `GET /api/forge/teams/:id` — detail
- `PATCH /api/forge/teams/:id` — update
- `DELETE /api/forge/teams/:id` — delete
- `GET /api/forge/teams/:id/members` — list members
- `POST /api/forge/teams/:id/members` — add
- `POST /api/forge/teams/:id/members/bulk` — bulk add
- `PATCH /api/forge/teams/:id/members/:user_id` — change role
- `DELETE /api/forge/teams/:id/members/:user_id` — remove
- `GET /api/forge/teams/:id/daily` — daily rollup
- `POST /api/forge/teams/:id/block` — emergency stop
- `POST /api/forge/teams/:id/unblock` — restore
- `GET /api/forge/users` — users in caller's scope
- `POST /api/forge/users` — create
- `GET /api/forge/users/:id` — detail
- `PATCH /api/forge/users/:id` — update
- `DELETE /api/forge/users/:id` — delete
- `GET /api/forge/users/available` — invite picker
- `GET /api/forge/users/:id/daily` — daily rollup
- `GET /api/forge/projects` — projects in caller's scope
- `POST /api/forge/projects` — create (team-admin)
- `GET /api/forge/projects/:id` — detail
- `PATCH /api/forge/projects/:id` — update
- `DELETE /api/forge/projects/:id` — delete
- `GET /api/forge/customers` — customers (org-admin)
- `POST /api/forge/customers` — create
- `GET /api/forge/customers/:id` — detail
- `PATCH /api/forge/customers/:id` — update
- `DELETE /api/forge/customers/:id` — delete
- `POST /api/forge/customers/:id/block` — block
- `POST /api/forge/customers/:id/unblock` — unblock
- `GET /api/forge/customers/:id/daily` — daily rollup
- `POST /api/forge/admin/bootstrap-tenant` — super-admin only

### Acceptance criteria
1. Creating an org + team + user via API results in exactly one LiteLLM call per entity.
2. A `member` cannot delete a project; `team_admin` can. Verified by 403 vs 204 response.
3. Adding 100 users via `/teams/:id/members/bulk` issues 100 `POST /team/member_add` calls OR 1 bulk call (configurable).
4. Removing a team member revokes their virtual keys within 60 seconds.
5. `team/block` immediately stops all keys for that team; in-flight chat completions fail with typed error `TeamBlocked`.
6. Customer data isolation: a user in customer A cannot read resources owned by customer B (verified by 403).
7. Daily rollup endpoints (`/user/daily`, `/team/daily`, `/organization/daily`) return within 500ms warm-cache.
8. RBAC inheritance: granting `team_admin` to a user automatically grants `member` permissions; revoking `team_admin` does NOT revoke `member` (explicit revocation required).
9. `forge.rbac.member_role_changed` audit event includes old + new role.
10. Phase 1 onboarding wizard successfully creates org + team + project end-to-end (regression of Phase 1 + Phase 3).

---

## Feature 13 — Embeddings + Vector Stores + RAG

### Goal
Forge AI gets a **real knowledge layer**: agents can ingest documents, store embeddings, search semantically, rerank results, retrieve context for chat completions. RAG is a first-class capability, not a hack.

### Spec

**Pipeline:**
```
Document (PDF / image / text / markdown / code)
    │
    ▼
OCR (if PDF / image) ─────────────► text
    │
    ▼
Chunking (recursive, semantic, or fixed)
    │
    ▼
Embedding (model → vector)
    │
    ▼
Vector Store (per project)
    │
    ▼
Index (BM25 + vector for hybrid)
    │
    ▼
Query → Embed → ANN search → top-K
    │
    ▼
Rerank → top-N
    │
    ▼
Assemble context → inject into chat
```

**Embedding service:**
- `POST /api/forge/embeddings` → proxies to LiteLLM `/v1/embeddings` with virtual key.
- Supports: OpenAI `text-embedding-3-small/large`, Cohere embed, Voyage, custom.
- Batch up to 2048 inputs per call.
- Result cached per `(model, input_hash)` for 7 days.

**Vector stores:**
- One vector store per project (default), or multiple per project (custom).
- LiteLLM `POST /v1/vector_stores` creates it; Forge tracks metadata (project, owner, schema version).
- File-based ingestion: `POST /v1/vector_stores/{id}/files` with the file id from Phase 14.
- Listing: `GET /api/forge/projects/:id/vector-stores`.

**RAG ingest (`/v1/rag/ingest`):**
- Forge Backend calls this for new documents; LiteLLM handles chunking + embedding.
- Forge Backend supplies: `file_id`, `vector_store_id`, `chunking_strategy` (recursive / semantic / fixed / none), `chunk_size`, `chunk_overlap`.
- Returns: `{ chunks_created, tokens_used, cost_usd, latency_ms }`.

**RAG query (`/rag/query`):**
- Forge Backend calls this for chat context assembly.
- Inputs: `{ vector_store_ids[], query, top_k, rerank: boolean, rerank_top_n, hybrid: boolean }`.
- Returns: `{ chunks: [{ text, score, source_file_id, source_chunk_id, metadata }], total_tokens }`.

**Search (`/v1/vector_stores/{id}/search`):**
- Direct vector search without RAG context assembly.
- Used by admin tools to debug/test stores.

**Reranking (`/v1/rerank`, `/v2/rerank`):**
- Forge Backend supports both versions; v2 is preferred for new code.
- Models: Cohere rerank, BGE reranker, custom.
- Used to boost top-N from initial ANN search.

**OCR (`/v1/ocr`):**
- PDFs, scanned images, handwritten notes → text.
- Used as a pre-stage before embedding.
- Optional: skip if file is already text.

**Index management (`/v1/indexes`):**
- Custom indexes for hybrid search.
- LiteLLM manages the index; Forge references by id.

**Search tools (`/search_tools/*`):**
- External search providers (web, code, internal wikis).
- `GET /search_tools/list` enumerates available tools.
- `POST /search_tools/test_connection` validates.
- `GET /search_tools/ui` returns UI metadata.

**Tenant isolation:**
- Each project's vector store is isolated by API key scope (Phase 1 virtual keys + project_id metadata).
- Cross-project search is admin-only and audit-logged.

**Lifecycle:**
- Vector stores can be archived (soft-delete); chunks remain queryable for grace period (default 30 days), then purged.
- Re-indexing on schema change: create new store, migrate chunks, swap atomically.

**Cost attribution:**
- Every embedding + every RAG query contributes to spend (Phase 1) with `metadata.kind = "rag" | "embedding"`.

**Audit:**
- `forge.rag.ingested` — per document
- `forge.rag.queried` — per query
- `forge.rag.chunked` — when chunking strategy differs from default
- `forge.rag.store_created | store_archived | store_reindexed`

### LiteLLM endpoints used
- `POST /v1/embeddings`, `POST /embeddings`, `POST /engines/embeddings`
- `POST /v1/vector_stores`, `GET /v1/vector_stores`, `/vector_store/new`, `/vector_store/list`, `/vector_store/info`, `/vector_store/update`, `/vector_store/delete`
- `POST /v1/vector_stores/{id}/files`, `POST /vector_stores/{id}/files`
- `POST /v1/vector_stores/{id}/search`, `POST /vector_stores/{id}/search`
- `POST /v1/rag/ingest`, `POST /rag/query`
- `POST /v1/rerank`, `POST /rerank`, `POST /v2/rerank`
- `POST /ocr`, `POST /v1/ocr`
- `GET /search_tools/list`, `POST /search_tools/test_connection`, `GET /search_tools/ui`
- `POST /v1/indexes`

### Forge Backend contract
- `GET /api/forge/embeddings/models` — supported embedding models
- `POST /api/forge/embeddings` — embed inputs
- `GET /api/forge/projects/:id/vector-stores` — list
- `POST /api/forge/projects/:id/vector-stores` — create
- `DELETE /api/forge/vector-stores/:id` — archive
- `POST /api/forge/vector-stores/:id/files` — attach file (uses Phase 14)
- `GET /api/forge/vector-stores/:id/search?q=…` — direct search
- `POST /api/forge/rag/ingest` — ingest document(s)
- `POST /api/forge/rag/query` — query for context
- `POST /api/forge/ocr` — OCR a file
- `GET /api/forge/search-tools` — list external search providers
- `POST /api/forge/search-tools/:id/test` — test connection
- `GET /api/forge/rag/stats` — chunk count, store count, query latency percentiles

### Acceptance criteria
1. Uploading a 100-page PDF: OCR runs, text is extracted, chunked into ~500 chunks, embedded, stored. Total time < 60s.
2. Semantic search on a 100k-chunk store returns top-10 results in < 200ms.
3. Reranking top-100 → top-10 improves precision@10 by > 20% vs no-rerank baseline (measured on a labeled eval set).
4. Hybrid search (BM25 + vector) beats vector-only on keyword-heavy queries (verified on test set).
5. Two projects' vector stores are isolated: a query in project A returns zero chunks from project B.
6. Archiving a vector store blocks new ingests; existing queries still work for 30 days.
7. Re-indexing a store does not cause query failures (atomic swap).
8. Embedding cost per document is reported in `forge.rag.ingested` audit event.
9. OCR on a non-image file returns the original text (no double-extraction).
10. `forge.rag.queried` audit event includes `top_k`, `hybrid`, `rerank` flags for offline analysis.

---

## Feature 14 — Files / Batches / Fine-tuning

### Goal
Long-running, large-scale workloads work end-to-end: file uploads (used by RAG and fine-tuning), batch completions (10k+ at a time), fine-tuning jobs, and the underlying async-response mechanism that ties them together.

### Spec

**Files:**
- Multipart upload: `POST /api/forge/files` with file body + metadata.
- LiteLLM-backed: `POST /v1/files` (purpose: `assistants` | `batch` | `fine-tune` | `vision` | `user_data` | `evals`).
- Forge stores file id mapping; content retrieval via `GET /files/{id}/content` or `GET /v1/files/{id}/content`.
- Provider passthrough: `/{provider}/v1/files` for raw provider file uploads (S3, Azure, etc.).
- File metadata: `{ id, purpose, bytes, created_at, filename, content_type }`.

**Batches:**
- Submit: `POST /api/forge/batches` with `{ completion_window, endpoint, requests: ChatRequest[] }` (up to 50,000).
- LiteLLM creates the batch; Forge tracks the batch id.
- Poll: `GET /api/forge/batches/:id` returns `{ status, request_counts, metadata, output_file_id, error_file_id }`.
- Cancel: `POST /api/forge/batches/:id/cancel` proxies to `/v1/batches/{id}/cancel`.
- Result: download output file via `/files/{output_file_id}/content`, parse JSONL.
- Webhook on completion (optional, via `POST /callback`).

**Fine-tuning:**
- Create: `POST /api/forge/fine-tuning/jobs` with `{ model, training_file, validation_file?, hyperparameters, suffix? }`.
- LiteLLM-backed: `POST /fine_tuning/jobs` or `POST /v1/fine_tuning/jobs`.
- Poll: `GET /api/forge/fine-tuning/jobs/:id` returns `{ status, fine_tuned_model, trained_tokens, error? }`.
- Cancel: `POST /api/forge/fine-tuning/jobs/:id/cancel`.
- Resulting fine-tuned model becomes available in `/v1/models` for the tenant.

**Background responses (long-running agents):**
- `POST /api/forge/responses` proxies to `/v1/responses` (or `/responses`).
- Returns immediately with `{ id, status: "queued" | "in_progress" }`.
- Poll: `GET /api/forge/responses/:id`.
- Stream: `GET /api/forge/responses/:id/stream` (SSE).
- Append input: `POST /api/forge/responses/:id/input_items`.
- Cancel: `POST /api/forge/responses/:id/cancel`.
- Compact: `POST /api/forge/responses/compact` (truncate long-running context).

**Interactions (`/v1beta/interactions`):**
- Anthropic-style interaction format for cross-provider compatibility.
- Cancel: `POST /interactions/{id}/cancel`.

**Use cases in Forge:**
- File → RAG ingest (Feature 13)
- Batch → nightly bulk evaluation runs
- Fine-tune → tenant-specific models
- Background response → long-running agents (e.g. multi-hour refactor jobs)
- Interaction → Anthropic-compatible agent runs

**Audit:**
- `forge.files.uploaded | deleted | downloaded`
- `forge.batches.submitted | completed | failed | cancelled`
- `forge.fine_tuning.started | completed | failed | cancelled`
- `forge.responses.started | polled | cancelled | compacted`
- All include `duration_ms`, `bytes` (files), `request_count` (batches).

**Spend integration:**
- Batch completion spend rolls up under one batch id (Phase 1 spend uses the batch id as `metadata.batch_id`).
- Fine-tuning spend reported per training-step.
- File storage costs (if any) tracked separately.

**Limits:**
- Max file size: 512MB (configurable).
- Max batch size: 50,000 requests.
- Max fine-tune dataset: 1GB.
- Max response duration: 24h (then auto-cancel).

### LiteLLM endpoints used
- `POST /v1/files`, `GET /v1/files`, `DELETE /v1/files/{id}`, `GET /v1/files/{id}/content`
- `POST /files`, `GET /files`, `DELETE /files/{id}`, `GET /files/content`
- `POST /{provider}/v1/files`, `GET /{provider}/v1/files`, `DELETE /{provider}/v1/files/{id}`, `GET /{provider}/v1/files/{id}/content`
- `POST /v1/batches`, `GET /v1/batches`, `GET /v1/batches/{id}`, `POST /v1/batches/{id}/cancel`, `DELETE /v1/batches/{id}`
- `POST /batches`, `GET /batches`, `POST /batches/cancel`
- `POST /{provider}/v1/batches`, `GET /{provider}/v1/batches`, `POST /{provider}/v1/batches/{id}/cancel`
- `POST /fine_tuning/jobs`, `GET /fine_tuning/jobs`, `GET /fine_tuning/jobs/{id}`, `POST /fine_tuning/jobs/{id}/cancel`
- `POST /v1/fine_tuning/jobs`, `GET /v1/fine_tuning/jobs`, `GET /v1/fine_tuning/jobs/{id}`
- `POST /v1/responses`, `GET /v1/responses`, `GET /v1/responses/{id}`, `GET /v1/responses/{id}/input_items`
- `POST /responses`, `GET /responses`, `POST /responses/{id}/cancel`, `POST /responses/{id}/input_items`, `POST /responses/compact`
- `POST /v1beta/interactions`, `GET /v1beta/interactions`, `POST /v1beta/interactions/{id}/cancel`
- `POST /interactions`, `GET /interactions`, `POST /interactions/{id}/cancel`
- `POST /callback` (webhook)

### Forge Backend contract
- `POST /api/forge/files` — upload
- `GET /api/forge/files/:id` — metadata
- `GET /api/forge/files/:id/content` — download
- `DELETE /api/forge/files/:id` — delete
- `POST /api/forge/batches` — submit
- `GET /api/forge/batches` — list
- `GET /api/forge/batches/:id` — status
- `POST /api/forge/batches/:id/cancel` — cancel
- `GET /api/forge/batches/:id/results` — download + parse JSONL
- `POST /api/forge/fine-tuning/jobs` — create
- `GET /api/forge/fine-tuning/jobs` — list
- `GET /api/forge/fine-tuning/jobs/:id` — status
- `POST /api/forge/fine-tuning/jobs/:id/cancel` — cancel
- `POST /api/forge/responses` — start background response
- `GET /api/forge/responses/:id` — poll
- `GET /api/forge/responses/:id/stream` — SSE stream
- `POST /api/forge/responses/:id/cancel` — cancel
- `POST /api/forge/responses/:id/input_items` — append
- `POST /api/forge/responses/compact` — truncate
- `WS /api/forge/jobs/ws` — WebSocket for job progress events

### Acceptance criteria
1. Uploading a 100MB file completes within 30 seconds and returns a valid file id.
2. Submitting a batch of 1000 chat completions returns a batch id within 5 seconds.
3. Batch status polling returns correct `request_counts` (total / completed / failed) at each interval.
4. Cancelling an in-progress batch returns success; subsequent poll shows `cancelled` status.
5. Batch results JSONL parses cleanly; each line has matching request id from input.
6. Submitting a fine-tuning job creates it on LiteLLM and returns a job id.
7. Cancelling a fine-tune job in `validating_files` state returns success; cancelling in `running` returns typed error `FineTuneUncancelable`.
8. Background response started via `/api/forge/responses` is pollable within 5 seconds.
9. Long-running response (>10 minutes) can be streamed via SSE without timing out at any proxy layer.
10. `forge.batches.completed` audit event includes total cost and per-request p50/p95 latency.

---

## Feature 15 — Audit / Health / Compliance

### Goal
Enterprise-grade observability + compliance. Every Phase 1/2/3 action is auditable, the platform's health is monitored in real time, and EU AI Act + GDPR reports can be generated on demand.

### Spec

**Audit log (`/audit`):**
- Every Phase 1/2/3 event lands here with: `{ event_id, ts, tenant_id, team_id?, user_id?, agent_id?, run_id?, event_type, payload_summary, status, duration_ms, ip, user_agent }`.
- Retention: 7 years for compliance events, 90 days for operational events (configurable).
- Queryable by: tenant, team, user, agent, event_type, time range, status.
- Tamper-evident: every audit row carries a hash chain reference (each row hashes the previous row's hash + own payload).

**Health endpoints:**
- `GET /health` — overall health.
- `GET /health/readiness` — readiness (Phase 1 already wired).
- `GET /health/liveness` — process alive.
- `GET /health/liveliness` — actively responding.
- `GET /health/services` — per-service health (DB, cache, providers).
- `GET /health/history` — historical health snapshots.
- `GET /health/latest` — most recent snapshot.
- `GET /health/shared-status` — cross-instance status.
- `GET /health/license` — license info.
- `GET /health/backlog` — pending jobs.
- `POST /health/test_connection` — test connectivity to a specific provider.

**Forge-side health dashboard:**
- `/api/forge/health` aggregates LiteLLM health + Forge Backend health.
- Returns: `{ status, litellm: { version, reachable, db, cache, callbacks_count }, forge: { uptime, version, cache_hit_rate, error_rate_5m, error_rate_1h, error_rate_24h, p50_chat_latency_ms, p95_chat_latency_ms, p99_chat_latency_ms } }`.

**Event logging (`/api/event_logging`):**
- Server-side telemetry push.
- Forge Backend can push structured events for offline analysis.

**Compliance — EU AI Act (`/compliance/eu-ai-act`):**
- Generates a per-tenant report covering: model inventory, training data lineage, human oversight mechanisms, transparency disclosures, risk classifications.
- Output: `{ report_id, generated_at, tenant_id, sections: { inventory, lineage, oversight, transparency, risk }, pdf_url, json_url }`.
- Report stored encrypted; access logged.

**Compliance — GDPR (`/compliance/gdpr`):**
- Generates: data inventory per user, processing purposes, retention policies, data export (per Article 20), data deletion workflow (per Article 17).
- `GET /api/forge/compliance/gdpr/export?user_id=…` → JSON archive of all data Forge holds on the user.
- `POST /api/forge/compliance/gdpr/delete?user_id=…` → initiates deletion cascade (audit logs retained per legal requirement).

**Drift detection (cross-feature):**
- Spend drift (Phase 1): Forge DB cost vs LiteLLM spend log differs > 1% → alert.
- Model drift: model in cache no longer available at LiteLLM → alert + auto-remove from picker.
- Key drift: key budget exhausted but still being used → block + alert.
- Vector drift: store chunk count decreases unexpectedly → alert.

**Cost alerts:**
- Per-tenant budget threshold (e.g. 80%, 95%, 100% of monthly budget) → email + Slack + audit event.
- Per-agent budget threshold → block + audit event.
- Per-user daily threshold → warn + audit event.
- Configurable via `/api/forge/orgs/:id/alerts`.

**In-product nudges (`/in_product_nudges`):**
- Forge UI feature tips based on usage patterns.
- LiteLLM provides the rule definitions; Forge renders.

**Webhook callback (`/callback`):**
- Receives webhooks from LiteLLM (e.g. budget exhausted, key blocked, health changed).
- Forge Backend re-emits as audit events + alerts.

**Rate limit metrics:**
- Forge Backend tracks: per-user, per-agent, per-tenant, per-tool call rates.
- Exposed at `/api/forge/metrics/rate-limits`.
- Alert when rate > 80% of configured limit.

**Audit access control:**
- Users see their own audit events.
- Team admins see their team's events.
- Org admins see their org's events.
- Super admins see all.
- Customers see only their customer's events.

**Compliance access control:**
- Compliance reports are org-admin-only.
- GDPR exports of self are user-self-only.
- GDPR exports of others are org-admin-only with justification required (audit logged).

### LiteLLM endpoints used
- `GET /audit`, `POST /audit` (for ingest)
- `POST /api/event_logging`
- `GET /health`, `GET /health/readiness`, `GET /health/liveness`, `GET /health/liveliness`, `GET /health/services`, `GET /health/history`, `GET /health/latest`, `GET /health/shared-status`, `GET /health/license`, `GET /health/backlog`, `POST /health/test_connection`
- `GET /compliance/eu-ai-act`, `POST /compliance/eu-ai-act`
- `GET /compliance/gdpr`, `POST /compliance/gdpr`
- `GET /in_product_nudges`
- `POST /callback`

### Forge Backend contract
- `GET /api/forge/audit?tenant_id&since&event_type&user_id&agent_id&status` — paginated query
- `GET /api/forge/audit/:event_id` — detail
- `GET /api/forge/health` — health dashboard
- `GET /api/forge/health/services` — per-service health
- `GET /api/forge/metrics/spend-drift` — current drift
- `GET /api/forge/metrics/rate-limits` — current rates
- `GET /api/forge/metrics/latency?window=1h` — p50/p95/p99
- `GET /api/forge/compliance/eu-ai-act` — generate report
- `GET /api/forge/compliance/gdpr/export?user_id` — self or admin
- `POST /api/forge/compliance/gdpr/delete` — admin only
- `GET /api/forge/orgs/:id/alerts` — current alert config
- `POST /api/forge/orgs/:id/alerts` — configure
- `GET /api/forge/alerts/active` — currently firing alerts
- `POST /api/forge/webhooks/callback` — receive LiteLLM webhooks

### Acceptance criteria
1. Audit log query `/api/forge/audit?tenant_id=X&since=24h` returns within 500ms for 1M events.
2. Every Phase 1/2/3 action lands in the audit log within 5 seconds.
3. Health dashboard `/api/forge/health` returns within 200ms warm-cache.
4. EU AI Act report generation completes within 30s for a tenant with 100 agents + 50 skills.
5. GDPR export of a user includes: profile, audit events, spend records, agent configs authored, RAG queries made.
6. GDPR deletion cascade removes the user's PII from all non-audit stores within 24h.
7. A tenant crossing 80% budget triggers an alert within 60s.
8. Drift detection alert fires within one reconciliation cycle when LiteLLM and Forge spend differ > 1%.
9. Rate limit at 80% threshold fires a warning; at 100% starts returning 429 with `Retry-After`.
10. Audit log hash chain is verifiable: tampering with one row breaks the chain at the next verification step.

---

## Cross-Cutting Concerns

### Audit events (new in Phase 3)
- `forge.prompts.created | updated | archived | version_pinned | tested | imported | rendered`
- `forge.rbac.org_created | org_updated | org_deleted`
- `forge.rbac.team_created | team_updated | team_deleted | team_blocked | team_unblocked`
- `forge.rbac.user_created | user_updated | user_deleted`
- `forge.rbac.project_created | project_updated | project_deleted`
- `forge.rbac.customer_created | customer_updated | customer_deleted | customer_blocked | customer_unblocked`
- `forge.rbac.member_added | member_removed | member_role_changed | permission_granted | permission_revoked`
- `forge.rag.ingested | queried | chunked | store_created | store_archived | store_reindexed`
- `forge.files.uploaded | deleted | downloaded`
- `forge.batches.submitted | completed | failed | cancelled`
- `forge.fine_tuning.started | completed | failed | cancelled`
- `forge.responses.started | polled | cancelled | compacted`
- `forge.compliance.eu_ai_act_generated | gdpr_export | gdpr_delete`
- `forge.alerts.budget_warning | budget_exceeded | spend_drift | model_unavailable | rate_limit_warning | rate_limit_exceeded`
- `forge.health.degraded | recovered`

### Error envelope (additions)
- `FineTuneUncancelable` (409) — `{ job_id, current_status }`
- `BatchNotCancellable` (409) — `{ batch_id, current_status }`
- `VectorStoreArchived` (410) — `{ store_id }`
- `ChunkingFailed` (422) — `{ file_id, reason }`
- `OCRFailed` (422) — `{ file_id, reason }`
- `PermissionDenied` (403) — `{ required_role, current_role }`
- `ComplianceReportInProgress` (409) — `{ report_id }`
- `GDPRDeleteInProgress` (202) — `{ user_id, eta }`

### Rate limits (additions)
- File uploads: 100/min per tenant.
- Batch submissions: 10/day per tenant (configurable).
- RAG queries: 1000/min per project.
- Audit log queries: 60/min per user (heavier queries are admin-only).

### Composition: Phase 3 features with prior phases
```
Phase 1 (foundation) — every Phase 3 call uses virtual keys + models + spend
Phase 2 (safety)    — every Phase 3 call passes through guardrails + policies
Phase 3 features:
  11. Prompts   — reference Skills (P2) and stand alone
  12. RBAC      — gates every prior call; inheritance chain P1 → P2 → P3
  13. RAG       — uses Files (P3.14); outputs to Chat (P1) + Spend (P1)
  14. Async     — uses Files (P3.14); outputs to Background Responses + RAG
  15. Audit/Health — observes every prior phase; required for enterprise sale
```

---

## Data Flow (Phase 3)

```
                           ┌─────────────────┐
                           │  Forge Admin UI │
                           └────────┬────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐          ┌─────────────────┐         ┌─────────────────┐
│  Prompts UI   │          │  RBAC Admin UI  │         │  Knowledge UI   │
│  /prompts/*   │          │  /orgs/teams/.. │         │  /vector-stores │
└───────┬───────┘          └────────┬────────┘         └────────┬────────┘
        │                           │                           │
        ▼                           ▼                           ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                     FORGE BACKEND (Phase 3 modules)              │
   │  forge.prompts  ·  forge.rbac  ·  forge.rag  ·  forge.async  ·  forge.observability │
   └────────────┬─────────────────────────────────────────────────────┘
                │
   ┌────────────┼─────────────────┬─────────────────┐
   ▼            ▼                 ▼                 ▼
┌────────┐  ┌──────────┐    ┌─────────────┐   ┌──────────────┐
│Prompts │  │Users/Tms │    │Embeddings + │   │Files/Batches │
│ /utils │  │/orgs/... │    │Vector + RAG │   │Fine-tune     │
└────────┘  └──────────┘    └─────────────┘   └──────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │ Audit + Health   │
                                              │ /audit /health   │
                                              │ /compliance/*    │
                                              └──────────────────┘
```

---

## Build Order (within Phase 3)

1. **Feature 12: RBAC** — gates everything else; needs to exist before the other features can be properly scoped.
2. **Feature 11: Prompts** — relatively isolated, no deps on other Phase 3 features.
3. **Feature 14: Files / Batches / Fine-tuning** — provides the substrate for RAG.
4. **Feature 13: RAG** — biggest feature, depends on Files.
5. **Feature 15: Audit / Health / Compliance** — depends on everything else being observable.

**Verification gate after each feature:** acceptance criteria met + Phase 1/2 regression suite still green.

---

## Anti-Patterns (auto-reject if seen)

- ❌ Prompt update that mutates a previously-active version (must create new version).
- ❌ RBAC check that runs after the action instead of before.
- ❌ Cross-project vector store query without explicit admin scope.
- ❌ File upload without purpose validation (assistants vs batch vs fine-tune vs vision).
- ❌ Batch result parsing that doesn't validate JSONL line shape.
- ❌ Fine-tuning job cancel after `running` state (must be in `validating_files` or `queued`).
- ❌ Audit log entry without hash chain reference.
- ❌ Health check that returns cached "healthy" without verifying.
- ❌ GDPR deletion that touches audit logs (audit must be retained per legal requirement).
- ❌ Cost alert fired on raw spend without comparing to budget.

---

## Deliverables for Phase 3

1. `forge-prompts.md` — versioning, rendering, test, dotprompt import
2. `forge-rbac.md` — full hierarchy, roles, inheritance, member management
3. `forge-rag.md` — embedding, vector stores, search, rerank, OCR, hybrid
4. `forge-async.md` — files, batches, fine-tuning, background responses
5. `forge-observability.md` — audit log, health, compliance, alerts, drift
6. `forge-phase3-roles-matrix.md` — every role × every action matrix
7. `forge-phase3-audit-events.md` — every new audit event with payload schema
8. `forge-phase3-error-codes.md` — every new error type with retry semantics
9. `forge-phase3-verification.md` — acceptance criteria checklist with evidence per feature
10. `forge-phase3-regression-report.md` — Phase 1 + Phase 2 acceptance criteria still passing

---

## Out of Scope for Phase 3 (deferred to Phase 4)

- Provider pass-through for Cursor-compat OpenAI (raw OpenAI/Anthropic-compatible endpoints)
- Realtime / A2A (long-running streamed agent protocols)
- Provider-agnostic Assistants / Threads (legacy OpenAI Assistants API surface)
- OAuth / SCIM / SSO at the Forge layer (SSO via corporate IdP)
- Cache (cost-reduction via response caching)
- Credentials & vault (per-provider credential management)
- Integrations (CloudZero / Vantage FinOps exports)
- Audio / vision / video endpoints (image gen, video gen, TTS, STT)
- Claude Code plugins (Anthropic IDE plugins)
- Email event settings (transactional email hooks)

These are listed in `forge-litellm-integration.md` §3 with their LiteLLM endpoints; they are explicitly **not** part of Phase 3's spec.