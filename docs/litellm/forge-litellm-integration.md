# Forge AI ↔ LiteLLM — Integration Architecture & Endpoint Reference

> **Goal:** wire Forge AI → Forge Backend → LiteLLM Proxy for every feature Forge AI needs.
> **Source spec:** `https://litellm-api.up.railway.app/openapi.json` (OpenAPI 3.1.0, LiteLLM `1.82.6`, 703 endpoints, 524 paths)
> **Spec dump:** [`litellm-openapi.json`](/litellm-openapi.json) · **Endpoint dump:** [`/litellm-forge-reference.md`](/litellm-forge-reference.md) · **Raw detail:** [`/litellm-endpoints-raw.txt`](/litellm-endpoints-raw.txt) · **Critical schemas:** [`/litellm-critical-schemas.json`](/litellm-critical-schemas.json)

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FORGE AI (UI)                                   │
│   Next.js · Dark-first · Inter · ⌘K everywhere                              │
│   Surfaces: Dashboard · Agents · Stories · Workflows · Chat · Onboarding   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │  HTTPS · Forge session JWT
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FORGE BACKEND (your service)                       │
│   • AuthN/Z (Forge session + RBAC)                                          │
│   • Virtual key broker (selects the right LiteLLM key per user/team/agent)  │
│   • Policy + audit envelope (every LiteLLM call is wrapped + logged)        │
│   • Streaming proxy (SSE/WebSocket passthrough)                              │
│   • Cost accumulator (rolls up `/spend/logs` into Forge metrics)             │
│   • Skill · MCP · Guardrail orchestration                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │  HTTPS · Virtual key (sk-…)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              LITELLM PROXY  ·  litellm-api.up.railway.app                   │
│   • 100+ LLM providers (OpenAI, Anthropic, Bedrock, Vertex, …)              │
│   • Guardrails · Policies · MCP gateway · Skills                            │
│   • Virtual keys · Teams · Orgs · Budgets · Spend logs                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb:** Forge UI → Forge Backend → LiteLLM. Forge UI **never** talks to LiteLLM directly.

---

## 2. Forge AI Feature → LiteLLM Endpoint Matrix

This is the core mapping. Every Forge AI feature is backed by one or more LiteLLM endpoints, reached through the Forge Backend.

### 2.1 Onboarding Wizard (the one in the screenshot)

| Step | Forge UI does | Forge Backend calls | LiteLLM endpoint |
|---|---|---|---|
| **1. Tenant setup** | Form (pre-filled) | `POST /organization/new` (idempotent on tenant slug) | `/organization/new` |
| **2. Connect repos** | Show connector cards | `GET /credentials/list` (to render), `POST /key/generate` (per agent role) | `/key/generate`, `/credentials/list` |
| **3. Detect stack** | Live execution graph (no form) | Streams `chat/completions` with `tools=[…]` for repo inspection | `POST /v1/chat/completions` |
| **4. Configure agents** | Agent rows pre-filled | `GET /v1/skills` (skill catalog), `POST /key/generate` (per agent) | `/v1/skills`, `/key/generate` |
| **5. Run first intel** | Streaming report | `POST /v1/chat/completions` with `metadata={"forge_run_id":…}` | `/v1/chat/completions` |
| **6. Review & confirm** | Summary screen | `POST /project/new`, `GET /spend/logs?start_date=…` | `/project/new`, `/spend/logs` |

### 2.2 AI Command Center (Dashboard)

| Widget | Backend call | LiteLLM endpoint |
|---|---|---|
| Active Agents | `GET /v1/mcp/servers` + cache of recent `spend/logs` | `/v1/mcp`, `/spend/logs` |
| Running Tasks | `GET /v1/responses?status=running` (proxy to LiteLLM job state) | `/v1/responses`, `/v1/batches/{id}` |
| Delivery Velocity | `POST /spend/logs` aggregations + custom Forge query | `/spend/logs`, `/global/spend` |
| AI Utilization | `GET /spend/logs?group_by=model` | `/spend/logs` |
| Cost Tracking | `GET /spend/users`, `GET /global/spend` | `/global/spend`, `/spend/users`, `/spend/keys`, `/budget/list` |
| Open Risks | `GET /guardrails/logs?triggered=true` | `/guardrails`, `/spend/logs` |
| Sprint Health | Roll-up of `/spend`, `/audit`, `/health/services` | `/health/services`, `/audit`, `/spend/logs` |

### 2.3 Agent Workspace

| Panel field | Backend call | LiteLLM endpoint |
|---|---|---|
| Avatar / Role | `GET /v1/agents` or `/v1/skills` (skill-driven agent identity) | `/v1/agents`, `/v1/skills` |
| Status (idle/thinking/executing/…) | Derived from current `chat/completions` SSE state | `/v1/chat/completions` (SSE) |
| Current Task | `GET /v1/responses/{id}` (if running) or Forge DB | `/v1/responses`, `/v1/batches/{id}` |
| Reasoning Summary | Streamed from LiteLLM (parse `reasoning_content` chunks) | `/v1/chat/completions` |
| Token Usage | `GET /spend/logs?request_id={id}` | `/spend/logs` |
| Execution Logs | `GET /spend/logs?request_id={id}` + `metadata.messages` | `/spend/logs` |
| Dependencies | DAG built from MCP servers + skill requires | `/v1/mcp`, `/v1/tool/list` |

### 2.4 Agent Chat (Cursor-style)

| Feature | Backend call | LiteLLM endpoint |
|---|---|---|
| Streaming chat | `POST /v1/chat/completions` (SSE passthrough) | `/v1/chat/completions` |
| Tool execution | Pass `tools=[…]` (LiteLLM MCP-format tools) | `/v1/chat/completions` |
| Artifacts | Forge-side parser of returned `tool_calls` + file refs | `/files`, `/v1/files` |
| Code previews | `/v1/files/{file_id}/content` | `/files/{file_id}/content` |
| Reasoning summary | Server-side parse of `choices[].delta.reasoning_content` | `/v1/chat/completions` |
| Cost meter | Incremental from `usage` chunks | `/v1/chat/completions` (SSE `usage` field) |
| Stop / Cancel | `POST /responses/{id}/cancel` (for background responses) | `/responses/{id}/cancel` |
| Model picker | `GET /models` (returns allowed-for-this-key models) | `/models`, `/v1/models` |

### 2.5 SDLC Pipeline View

Each stage is a **Forge internal concept**, but each stage's workhorse is LiteLLM:

| Stage | Owner agent | LiteLLM endpoint(s) used |
|---|---|---|
| Idea | `forge-ideator` skill | `/v1/chat/completions` (reasoning model) |
| PRD | `forge-prd-writer` skill | `/v1/chat/completions` + `/prompts/{id}` |
| Architecture | `forge-architect` skill | `/v1/chat/completions` + `/v1/tool/list` (for tool discovery) |
| Tasks | `forge-tasker` skill | `/v1/chat/completions` |
| Development | `forge-coder` skill | `/v1/chat/completions` + `/v1/mcp` (tools: git, fs, gh) |
| Testing | `forge-tester` skill | `/v1/chat/completions` + MCP tools |
| Review | `forge-reviewer` skill | `/v1/chat/completions` + `/guardrails/apply_guardrail` |
| Deployment | `forge-deployer` skill | `/v1/chat/completions` + provider-specific passthrough |

### 2.6 Story Workspace

| Section | Backend call | LiteLLM endpoint |
|---|---|---|
| Story details | Forge DB (not LiteLLM) | — |
| Requirements | `POST /v1/chat/completions` (embed requirements) | `/v1/chat/completions` |
| Tasks | `POST /v1/batches` (batch task generation) | `/v1/batches` |
| Code changes | `GET /files/{file_id}/content` | `/files/{file_id}/content` |
| PR status | External (Forge integrates; LiteLLM only used for code review) | `/v1/chat/completions` (review) |
| Agent discussion | Persisted chat thread; LiteLLM provides inference | `/v1/chat/completions`, `/v1/responses` |

### 2.7 Knowledge / RAG

| Operation | Backend call | LiteLLM endpoint |
|---|---|---|
| Index a doc | `POST /v1/vector_stores` + `POST /vector_stores/{id}/files` | `/v1/vector_stores`, `/vector_stores/{id}/files` |
| Search | `POST /vector_stores/{id}/search` | `/vector_stores/{id}/search` |
| RAG retrieve | `POST /v1/rag/ingest`, `POST /rag/query` | `/v1/rag/ingest`, `/rag/query` |
| Embeddings | `POST /v1/embeddings` | `/v1/embeddings` |
| Rerank | `POST /v1/rerank` | `/v1/rerank` |
| OCR (PDFs/docs) | `POST /v1/ocr` | `/v1/ocr` |

### 2.8 Guardrails & Policy (the core of "safe agent execution")

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| List registered guardrails | `GET /guardrails/list` | `/guardrails/list` |
| Register a guardrail | `POST /guardrails/register` | `/guardrails/register` |
| Apply a guardrail inline (pre-call) | `POST /apply_guardrail` | `/apply_guardrail` |
| Apply a guardrail inline (alternate path) | `POST /guardrails/apply_guardrail` | `/guardrails/apply_guardrail` |
| Inspect a guardrail | `GET /guardrails/info` | `/guardrails/info` |
| v2 guardrails list | `GET /v2/guardrails/list` | `/v2/guardrails/list` |
| Submissions log | `GET /guardrails/submissions/list` | `/guardrails/submissions/list` |
| UI-side guardrails | `GET /guardrails/ui/list` | `/guardrails/ui/list` |
| Resolve guardrails from policies | `POST /policies/resolved-guardrails` | `/policies/resolved-guardrails` |
| Test a guardrail custom code | `POST /guardrails/test_custom_code` | `/guardrails/test_custom_code` |
| Test pipeline | `POST /policies/test-pipeline` | `/policies/test-pipeline` |
| List policies | `GET /policies/list` | `/policies/list` |
| Compare policies | `POST /policies/compare` | `/policies/compare` |
| Resolve policies | `POST /policies/resolve` | `/policies/resolve` |
| Test policy | `POST /policies/test` | `/policies/test` |
| Policy status | `GET /policies/status` | `/policies/status` |
| Policy info | `GET /policy/info` | `/policy/info` |
| Policy usage | `GET /policies/usage` | `/policies/usage` |
| List attachments | `GET /policies/attachments/list` | `/policies/attachments/list` |
| Policy templates | `GET /policy/templates/list` | `/policy/templates/list` |
| Tool policy | `GET /v1/tool/policy`, `GET /v1/tool/policy/options` | `/v1/tool/policy`, `/v1/tool/policy/options` |

**This is where Forge enforces "AI works within your rules"** — every `chat/completions` call from Forge Backend passes through `apply_guardrail` first.

### 2.9 MCP (Model Context Protocol — tools for agents)

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| List MCP servers | `GET /v1/mcp/servers` | `/v1/mcp/servers` |
| List MCP tools | `GET /v1/mcp/tools` | `/v1/mcp/tools` |
| Invoke MCP tool | `POST /v1/mcp/call` | `/v1/mcp/call` |
| MCP server OAuth | `GET /{mcp_server_name}/authorize` | `/{mcp_server_name}/authorize` |
| MCP token | `POST /{mcp_server_name}/token` | `/{mcp_server_name}/token` |
| MCP register | `POST /{mcp_server_name}/register` | `/{mcp_server_name}/register` |
| MCP JWKS | `GET /.well-known/jwks.json` | `/.well-known/jwks.json` |
| OAuth discovery | `GET /.well-known/oauth-authorization-server/mcp/{name}` | `/.well-known/oauth-authorization-server/mcp/{name}` |
| Test MCP connection | `POST /mcp-rest/test` | `/mcp-rest/test` |
| List MCP tools (rest) | `GET /mcp-rest/tools` | `/mcp-rest/tools` |
| Public MCP hub | `GET /public/mcp_hub` | `/public/mcp_hub` |

### 2.10 Skills (Agent Skills Registry)

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| List skills | `GET /v1/skills` | `/v1/skills` |
| Get skill | `GET /v1/skills/{id}` | `/v1/skills/{id}` |
| Create skill | `POST /v1/skills` | `/v1/skills` |
| Delete skill | `DELETE /v1/skills/{id}` | `/v1/skills/{id}` |

### 2.11 Prompts (versioned prompt library)

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| List prompts | `GET /prompts/list` | `/prompts/list` |
| Get prompt | `GET /prompts/info` | `/prompts/info` |
| List versions | `GET /prompts/versions` | `/prompts/versions` |
| Test prompt | `POST /prompts/test` | `/prompts/test` |

### 2.12 Tools (broader than MCP)

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| List all tools | `GET /v1/tool/list` | `/v1/tool/list` |
| Tool detail | `GET /v1/tool/{tool_name}/detail` | `/v1/tool/{tool_name}/detail` |
| Tool logs | `GET /v1/tool/{tool_name}/logs` | `/v1/tool/{tool_name}/logs` |
| Tool overrides | `GET /v1/tool/{tool_name}/overrides` | `/v1/tool/{tool_name}/overrides` |
| Delete tool | `DELETE /v1/tool/{tool_name}` | `/v1/tool/{tool_name}` |

### 2.13 Virtual Keys & Auth

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| Generate key | `POST /key/generate` | `/key/generate` |
| Service-account key | `POST /key/service-account/generate` | `/key/service-account/generate` |
| Key info | `GET /key/info` | `/key/info` |
| List keys | `GET /key/list` | `/key/list` |
| Update key | `POST /key/update` | `/key/update` |
| Bulk update keys | `POST /key/bulk_update` | `/key/bulk_update` |
| Delete key | `POST /key/delete` | `/key/delete` |
| Reset spend | `POST /key/reset_spend` | `/key/reset_spend` |
| Block / unblock key | `POST /key/block`, `/key/unblock` | `/key/block`, `/key/unblock` |
| Aliases | `GET /key/aliases` | `/key/aliases` |
| Health (key) | `GET /key/health` | `/key/health` |
| Regenerate | `POST /key/regenerate` | `/key/regenerate` |

### 2.14 Users / Teams / Orgs / Projects

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| User CRUD | `POST /user/new`, `/user/update`, `/user/delete`, `GET /user/list`, `/user/info` | `/user/*`, `/v2/user/*` |
| Team CRUD | `POST /team/new`, `/team/update`, `/team/delete`, `/team/info`, `/team/list` | `/team/*`, `/v2/team/*` |
| Team members | `/team/member_add`, `/team/member_delete`, `/team/member_update`, `/team/bulk_member_add` | same |
| Team model | `/team/model/add`, `/team/model/delete` | same |
| Org CRUD | `/organization/new`, `/organization/update`, `/organization/delete`, `/organization/list`, `/organization/info` | same |
| Org members | `/organization/member_add`, `/organization/member_update`, `/organization/member_delete` | same |
| Project CRUD | `/project/new`, `/project/update`, `/project/delete`, `/project/info`, `/project/list` | same |
| Customer (end-customer) | `/customer/new`, `/customer/info`, `/customer/list`, `/customer/delete`, `/customer/block`, `/customer/unblock`, `/customer/daily` | same |

### 2.15 Spend, Budgets, Cost

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| Spend logs (raw) | `GET /spend/logs` | `/spend/logs` |
| Global spend | `GET /global/spend` | `/global/spend` |
| Per-user daily | `GET /user/daily/activity` | `/user/daily` |
| Per-team daily | `GET /team/daily/activity` | `/team/daily` |
| Per-org daily | `GET /organization/daily/activity` | `/organization/daily` |
| Per-customer daily | `GET /customer/daily/activity` | `/customer/daily` |
| Per-agent daily | `GET /agent/daily/activity` | `/agent/daily` |
| Tag analytics | `/tag/daily`, `/tag/dau`, `/tag/wau`, `/tag/mau`, `/tag/summary`, `/tag/distinct` | same |
| Budgets CRUD | `/budget/new`, `/budget/update`, `/budget/list`, `/budget/info`, `/budget/delete`, `/budget/settings` | same |
| Provider budgets | `/provider/budgets/list` | `/provider/budgets` |
| Spend tags | `/spend/tags` | `/spend/tags` |
| Cost calc | `/cost/estimate`, `/spend/calculate` | same |
| Cost config | `/config/cost_discount_config`, `/config/cost_margin_config` | same |
| Router config | `/router/settings`, `/router/fields` | same |

### 2.16 Audit, Logs, Health

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| Audit log | `GET /audit/logs` | `/audit` |
| Event logging | `POST /api/event_logging` | `/api/event_logging` |
| Health check | `GET /health` | `/health`, `/health/readiness`, `/health/liveness` |
| Service health | `GET /health/services` | `/health/services` |
| Health history | `GET /health/history` | `/health/history` |
| Health latest | `GET /health/latest` | `/health/latest` |
| License info | `GET /health/license` | `/health/license` |
| Backlog | `GET /health/backlog` | `/health/backlog` |
| Test connection | `POST /health/test_connection` | `/health/test_connection` |

### 2.17 Cache, Credentials, Settings

| Capability | Backend call | LiteLLM endpoint |
|---|---|---|
| Cache ping | `POST /cache/ping` | `/cache/ping` |
| Cache delete | `POST /cache/delete` | `/cache/delete` |
| Cache flush | `POST /cache/flushall` | `/cache/flushall` |
| Redis info | `GET /cache/redis/info` | `/cache/redis` |
| Cache settings | `GET /cache/settings`, `/cache/settings/update` | `/cache/settings` |
| Credentials CRUD | `/credentials`, `/credentials/by_name`, `/credentials/by_model` | same |
| Vault | `/config_overrides/hashicorp_vault/*` | same |
| UI theme | `/get/ui_theme_settings`, `/update/ui_theme_settings` | same |
| Internal user settings | `/get/internal_user_settings`, `/update/internal_user_settings` | same |
| Default team settings | `/get/default_team_settings`, `/update/default_team_settings` | same |
| SSO settings | `/get/sso_settings`, `/update/sso_settings` | same |
| UI settings | `/get/ui_settings`, `/update/ui_settings` | same |
| Logo upload | `POST /upload/logo` | `/upload/logo` |
| Email events | `/email/event_settings`, `/email/event_settings/reset` | same |

### 2.18 Provider Pass-through (when you need raw OpenAI/Anthropic compatibility)

| Provider | Endpoint |
|---|---|
| OpenAI chat | `POST /openai/chat/completions`, `POST /openai/v1/chat/completions` |
| OpenAI responses | `POST /openai/v1/responses` |
| OpenAI assistants | `/openai/v1/assistants`, `/openai/v1/threads/*` |
| OpenAI batches | `/openai/v1/batches/*` |
| OpenAI files | `/openai/v1/files/*` |
| OpenAI deployments | `/openai/deployments/{deployment}/chat/completions` |
| Anthropic | `/anthropic/v1/messages`, `/v1/messages` |
| Bedrock | `/bedrock/*`, `/bedrock/invoke`, `/bedrock/converse` |
| Vertex AI | `/vertex_ai/*`, `/vertex_ai/discovery/*`, `/vertex_ai/live` |
| Gemini | `/gemini/v1/*` |
| Mistral | `/mistral/v1/*` |
| Cohere | `/cohere/v1/*` |
| AssemblyAI | `/assemblyai/v2/*`, `/eu.assemblyai/v2/*` |
| Azure | `/azure/*`, `/azure_ai/*` |
| vLLM | `/vllm/*` |
| Cursor | `/cursor/chat`, `/cursor/v1/chat/completions` |
| Langfuse | `/langfuse/*` |
| Custom passthrough | `/config/pass_through_endpoint/*` |

### 2.19 Embeddings / RAG / Vector Stores (full list)

| Capability | Endpoint |
|---|---|
| Embeddings | `POST /v1/embeddings`, `POST /embeddings`, `POST /engines/embeddings` |
| Rerank | `POST /v1/rerank`, `POST /rerank`, `POST /v2/rerank` |
| RAG | `POST /v1/rag/ingest`, `POST /rag/query` |
| Indexes | `POST /v1/indexes` |
| Vector stores (CRUD) | `/vector_stores`, `/v1/vector_stores`, `/vector_store/new`, `/vector_store/list`, `/vector_store/info`, `/vector_store/update`, `/vector_store/delete` |
| Vector store files | `/vector_stores/{id}/files`, `/v1/vector_stores/{id}/files`, `/vector_stores/files/*` |
| Search | `POST /v1/vector_stores/{id}/search` |
| OCR | `POST /v1/ocr`, `POST /ocr` |
| Search tools | `/search_tools/list`, `/search_tools/test_connection`, `/search_tools/ui` |

### 2.20 Audio / Video / Images

| Capability | Endpoint |
|---|---|
| Speech | `POST /audio/speech`, `POST /v1/audio/speech` |
| Transcriptions | `POST /audio/transcriptions`, `POST /v1/audio/transcriptions` |
| Image generation | `POST /images/generations`, `POST /v1/images/generations` |
| Image edits | `POST /images/edits` |
| Video generation | `POST /v1/videos`, `POST /videos`, `/videos/content`, `/videos/remix`, `/videos/edits`, `/videos/extensions`, `/v1/videos/{id}/content` |
| Video characters | `/videos/characters/*` |
| Containers | `/v1/containers`, `/containers`, `/containers/files/*` |
| Moderation | `POST /moderations`, `POST /v1/moderations` |

### 2.21 Files / Batches / Fine-tuning / Evals

| Capability | Endpoint |
|---|---|
| Files (CRUD) | `/v1/files`, `/files`, `/{provider}/v1/files` |
| File content | `/v1/files/{file_id}/content`, `/files/content`, `/{provider}/v1/files/{id}/content` |
| Batches (CRUD) | `/v1/batches`, `/batches`, `/{provider}/v1/batches` |
| Cancel batch | `/v1/batches/{id}/cancel`, `/batches/cancel`, `/{provider}/v1/batches/{id}/cancel` |
| Fine-tuning | `/fine_tuning/jobs`, `/v1/fine_tuning/jobs` |
| Evals | `/v1/evals`, `/v1/evals/{eval_id}`, `/v1/evals/{eval_id}/cancel`, `/v1/evals/{eval_id}/runs` |

### 2.22 Realtime / A2A / Responses (advanced agent flows)

| Capability | Endpoint |
|---|---|
| Realtime calls | `/realtime`, `/v1/realtime`, `/realtime/calls`, `/realtime/client_secrets` |
| A2A | `/v1/a2a`, `/a2a`, `/a2a/message`, `/a2a/.well-known` |
| Responses | `/responses`, `/v1/responses`, `/responses/input_items`, `/responses/compact`, `/responses/cancel` |
| Interactions | `/v1beta/interactions`, `/interactions`, `/interactions/{id}/cancel` |

### 2.23 Assistants / Threads (legacy OpenAI Assistants API)

| Capability | Endpoint |
|---|---|
| Assistants | `/assistants`, `/v1/assistants`, `/assistants/{id}`, `/v1/assistants/{id}` |
| Threads | `/threads`, `/v1/threads`, `/threads/{id}`, `/v1/threads/{id}` |
| Messages | `/threads/{id}/messages`, `/v1/threads/{id}/messages` |
| Runs | `/threads/{id}/runs`, `/v1/threads/{id}/runs` |

### 2.24 Access Control / OAuth / SCIM

| Capability | Endpoint |
|---|---|
| Access groups | `/v1/access_group`, `/v1/unified_access_group`, `/access_group/new`, `/access_group/list`, `/access_group/info`, `/access_group/update`, `/access_group/delete` |
| Allowed IPs | `/add/allowed_ip`, `/delete/allowed_ip` |
| OAuth server | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-authorization-server/mcp/{name}` |
| OAuth protected resource | `/.well-known/oauth-protected-resource` |
| OpenID Connect | `/.well-known/openid-configuration` |
| JWKS | `/.well-known/jwks.json` |
| JWT keys | `/jwt/key/*` |
| SCIM v2 | `/scim/v2/*` (18 endpoints) |
| SSO | `/sso/readiness` |

### 2.25 Claude Code Plugins / Public Endpoints

| Capability | Endpoint |
|---|---|
| Claude Code marketplace | `/claude-code/plugins`, `/claude-code/marketplace.json` |
| Public endpoints | `/public/agent_hub`, `/public/mcp_hub`, `/public/model_hub`, `/public/providers`, `/public/litellm_model_cost_map`, `/public/litellm_blog_posts`, `/public/endpoints`, `/public/agents` |
| Fallback login | `/fallback/login` |
| UI config discovery | `/.well-known/litellm-ui-config` |
| Robots | `/robots.txt` |

### 2.26 Models Registry (full)

| Capability | Endpoint |
|---|---|
| List models | `GET /models`, `GET /v1/models`, `GET /v1/models` (alt), `GET /model_group/info` |
| Model info | `GET /model/info`, `GET /v1/model/info` |
| Add model | `POST /model/new` |
| Update model | `POST /model/update` |
| Delete model | `POST /model/delete` |
| Make public | `POST /model_group/make_public` |
| Update useful links | `POST /model_hub/update_useful_links` |

### 2.27 Router / Callbacks / Callbacks Config

| Capability | Endpoint |
|---|---|
| Router settings | `GET /router/settings`, `GET /router/fields` |
| Active callbacks | `GET /active/callbacks` |
| Callbacks list | `GET /callbacks/list` |
| Callback configs | `GET /callbacks/configs` |
| Callback webhook | `POST /callback` |
| Debug asyncio | `GET /debug/asyncio-tasks` |
| Routes list | `GET /routes` |

---

## 3. Implementation Sequence (recommended)

Build the Forge Backend LiteLLM client in this order:

### Phase 1 — Foundation (week 1)
1. **Config & auth** — LiteLLM base URL, master key, virtual key broker
2. **Models** — `GET /models`, cache, model picker in UI
3. **Chat completion** — `POST /v1/chat/completions` with SSE passthrough
4. **Virtual keys** — `POST /key/generate`, `GET /key/info` (per-agent keys)
5. **Spend** — `GET /spend/logs` rollups for cost meter

### Phase 2 — Safety (week 2)
6. **Guardrails** — `GET /guardrails/list`, `POST /apply_guardrail` (pre-call)
7. **Policies** — `GET /policies/list`, `POST /policies/resolve` (resolve per request)
8. **MCP** — `GET /v1/mcp/servers`, `POST /v1/mcp/call` (tool execution)
9. **Skills** — `GET /v1/skills`, `POST /v1/skills` (skill registry)
10. **Tools** — `GET /v1/tool/list` (broader tool surface)

### Phase 3 — Productivity (week 3)
11. **Prompts** — `GET /prompts/list`, `POST /prompts/test` (versioned prompts)
12. **Users / Teams / Projects** — onboarding, RBAC
13. **Embeddings + Vector stores** — RAG for knowledge base
14. **Files / Batches** — long-running task support
15. **Audit / Health** — observability

### Phase 4 — Scale (week 4)
16. **Provider pass-through** — for Cursor-compat OpenAI calls
17. **Realtime / Responses / Interactions** — long-running agents
18. **OAuth / SCIM** — enterprise SSO
19. **Cache** — cost reduction at scale
20. **CloudZero / Vantage** — FinOps exports

---

## 4. Critical Schemas (what Forge Backend must model)

These are the request/response shapes Forge Backend must understand:

- `ChatCompletionRequest` — `{ model, messages[], tools[], tool_choice, stream, temperature, max_tokens, metadata{forge_run_id, forge_agent_id, forge_tenant_id} }`
- `ChatCompletionResponse` — `{ id, choices[], usage{prompt_tokens, completion_tokens, total_tokens}, model, system_fingerprint }`
- `ChatCompletionChunk` — `{ id, choices[].delta{content, tool_calls, reasoning_content}, usage? }` (SSE)
- `EmbeddingRequest` — `{ model, input[] }`
- `EmbeddingResponse` — `{ data[], model, usage }`
- `Tool` — `{ type:"function", function:{ name, description, parameters } }`
- `ToolCall` — `{ id, type:"function", function:{ name, arguments } }`
- `Message` — `{ role, content, tool_calls?, function_call?, audio?, images?, reasoning_content?, thinking_blocks? }`
- `ModelInfo` — `{ id, db_model, base_model, tier, team_id, team_public_model_name }`
- `Guardrail` — `{ guardrail_id, guardrail_name, litellm_params, guardrail_info, policy_template }`
- `Policy` — policy template + attachments
- `MCPServer` — server registration for MCP tool gateway
- `Skill` — agent skill definition (prompt + tools + config)
- `Prompt` — versioned prompt template
- `BudgetNewRequest` — `{ budget_id, max_budget, duration, max_parallel_requests, tpm_limit, rpm_limit }`
- `KeyRequest` — `{ models[], max_budget, user_id, team_id, duration, metadata }`
- `SpendLogs` — `{ request_id, call_type, spend, total_tokens, prompt_tokens, completion_tokens, startTime, endTime, model, user, metadata, messages }`

**Full schema dump:** `/litellm-critical-schemas.json`

---

## 5. Authentication

- **Master key:** Forge Backend holds the LiteLLM `master_key` (env var, never sent to UI).
- **Virtual keys:** Forge Backend issues **per-user** and **per-agent** virtual keys via `POST /key/generate`. UI only ever sees its own key.
- **Session:** Forge UI authenticates with Forge session JWT; Forge Backend maps session → virtual key.
- **Scoping:** every virtual key carries `metadata={forge_tenant, forge_agent, forge_user, forge_run_id}` so spend logs are queryable per Forge concept.

---

## 6. Streaming Pattern

```ts
// Forge Backend (pseudocode)
const upstream = await fetch(`${LITELLM}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${virtualKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: agent.model,
    messages: thread.messages,
    tools: agent.tools,         // MCP-derived
    stream: true,
    metadata: {
      forge_run_id: run.id,
      forge_agent_id: agent.id,
      forge_tenant_id: tenant.id,
    },
  }),
});

// pipe SSE → Forge UI
return new Response(upstream.body, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  },
});
```

Forge UI reads `delta.content`, `delta.reasoning_content`, `delta.tool_calls`, and `usage` (in the final chunk) for live cost, reasoning panel, and tool execution rendering.

---

## 7. Guardrail Pipeline (pre-call)

```ts
// Before every chat completion
const guard = await fetch(`${LITELLM}/apply_guardrail`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${masterKey}` },
  body: JSON.stringify({
    guardrail_name: 'forge-default-policy',
    text: messages.map(m => m.content).join('\n'),
    language: 'en',
  }),
});

if (!guard.ok) {
  // resolve which policy triggered
  const resolved = await fetch(`${LITELLM}/policies/resolved-guardrails`, {
    method: 'POST',
    body: JSON.stringify({ policy_ids: tenant.policies }),
  });
  return forgeError('Blocked by policy', resolved);
}
```

---

## 8. Cost Aggregation Pattern

```ts
// After every chat completion
await fetch(`${FORGE}/api/forge/spend/record`, {
  method: 'POST',
  body: JSON.stringify({
    run_id: run.id,
    agent_id: agent.id,
    tenant_id: tenant.id,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    cost_usd: spend,
    model: response.model,
  }),
});

// Periodic roll-up from LiteLLM (every 5 min)
const logs = await fetch(`${LITELLM}/spend/logs?start_date=${since}`);
for (const log of logs) {
  await reconcile(log);  // idempotent merge into Forge DB
}
```

---

## 9. MCP Tool Wiring

```ts
// 1. Discover MCP tools for an agent's role
const mcpServers = await fetch(`${LITELLM}/v1/mcp/servers?role=developer`);
const tools = await fetch(`${LITELLM}/v1/mcp/tools?server_ids=${ids}`);

// 2. Pass tools to chat completion
const response = await fetch(`${LITELLM}/v1/chat/completions`, {
  body: JSON.stringify({
    model: 'gpt-4o',
    messages,
    tools: tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    })),
    stream: true,
  }),
});

// 3. When model returns tool_calls, dispatch to MCP
for (const call of response.tool_calls) {
  const result = await fetch(`${LITELLM}/v1/mcp/call`, {
    method: 'POST',
    body: JSON.stringify({
      server_id: call.server_id,
      tool_name: call.function.name,
      arguments: JSON.parse(call.function.arguments),
    }),
  });
  messages.push({ role: 'tool', tool_call_id: call.id, content: result });
}
// → loop back to chat completion
```

---

## 10. Deliverables

1. `litellm-forge-reference.md` — endpoint index grouped by domain
2. `litellm-openapi.json` — raw OpenAPI spec dump (1.2MB)
3. `litellm-endpoints-raw.txt` — every endpoint with method/path/summary/params/schemas
4. `litellm-critical-schemas.json` — key request/response shapes
5. `forge-litellm-client.ts` — typed TypeScript client (planned)
6. `forge-litellm-integration.md` — this file
7. `forge-virtual-key-broker.md` — key issuance strategy (planned)
8. `forge-guardrail-pipeline.md` — pre-call guardrail pattern (planned)

---

## 11. Anti-patterns — auto-reject

- ❌ Forge UI calling LiteLLM directly (skipping Forge Backend)
- ❌ Using the master key for user requests (always use virtual keys)
- ❌ Ignoring `metadata` on chat completion (breaks per-Forge cost tracking)
- ❌ Calling `/spend/logs` synchronously in the UI render path
- ❌ Skipping `/apply_guardrail` for "internal" requests
- ❌ Hardcoding model names instead of pulling from `/models`
- ❌ Forgetting `stream: true` on chat completion (breaks live cost meter)
- ❌ Not reconciling `/spend/logs` periodically (drift between Forge and LiteLLM)

---

**Next step:** pick a phase and start building. I'd recommend starting with Phase 1 — config + auth + chat completion + spend — since everything else depends on it. Want me to draft `forge-litellm-client.ts` as the typed TypeScript client?