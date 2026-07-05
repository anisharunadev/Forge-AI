# Forge Backend — Phase 2 Implementation Spec

> **Status:** completed
> **Last classified:** 2026-07-05

> **Phase:** 2 of 4 — Safety & Tooling
> **Goal of this doc:** spec the 5 features in Phase 2 with explicit goals, contracts, and acceptance criteria — no code, just the contract.
> **Depends on:** Phase 1 (Config & Auth, Models, Virtual Keys, Chat SSE, Spend Aggregation).
> **Source API:** LiteLLM `1.82.6` at `https://litellm-api.up.railway.app/` (see `forge-litellm-integration.md` for full endpoint map).

---

## Phase 2 Goal (one sentence)

**Layer the safety and capability substrate on top of Phase 1: every chat completion is wrapped by a resolved set of policies + guardrails (pre-call on input, post-call on output), every agent is built from a registered Skill, and every tool the agent can invoke comes from the MCP gateway or the broader Tools registry — all auditable, all overrideable per request.**

After Phase 2 ships, an agent in Forge AI is: *a Skill + a tool palette (MCP + Tools) + a guardrail/policy envelope + chat completion + audit trail.* The Phase 1 substrate (keys, models, SSE, spend) stays unchanged underneath.

---

## Phase 2 Success Criteria (Definition of Done)

Phase 2 is done only when **all** are true:

1. ✅ Every chat completion (Phase 1 endpoint) is wrapped by `apply_guardrail` pre-call and post-call.
2. ✅ Policies can be assigned at tenant, team, agent, and request scope — all four levels compose correctly.
3. ✅ A `policies.resolve` call returns the **effective** guardrail set for any given (tenant, agent, request context) tuple.
4. ✅ Skills are registered, versioned, and injected into every chat completion that references them.
5. ✅ MCP servers are registered; tools are discoverable and invokable end-to-end.
6. ✅ Tool calls from the model are dispatched to MCP, results are fed back, and the loop terminates correctly.
7. ✅ All guardrail violations, policy resolutions, MCP invocations, and skill injections are audit-logged.
8. ✅ The full agent loop (Skill + Tools + Guardrails + Policies + Chat) works in <500ms overhead on a 200-token chat.
9. ✅ A misconfigured policy (blocks all models) is caught **before** the chat completes, not after.
10. ✅ Phase 1 acceptance criteria still pass — no regression.

---

## Feature Map

| # | Feature | LiteLLM endpoints | Forge-side module |
|---|---|---|---|
| 6 | **Guardrails** | `/guardrails/list`, `/v2/guardrails/list`, `/guardrails/register`, `/guardrails/info`, `/apply_guardrail`, `/guardrails/apply_guardrail`, `/guardrails/test_custom_code`, `/guardrails/submissions/list`, `/guardrails/ui/list`, `/guardrails/ui/save`, `/guardrails/ui/get` | `forge.guardrails` |
| 7 | **Policies** | `/policies/list`, `/policies/info`, `/policies/status`, `/policies/usage`, `/policies/compare`, `/policies/resolve`, `/policies/test-pipeline`, `/policies/test`, `/policies/attachments/list`, `/policy/list`, `/policy/info`, `/policy/test`, `/policy/validate`, `/policy/templates/list`, `/v1/tool/policy`, `/v1/tool/policy/options`, `/utils/test_policies_and_guardrails` | `forge.policies` |
| 8 | **MCP (Model Context Protocol)** | `/v1/mcp/servers`, `/v1/mcp/tools`, `/v1/mcp/call`, `/mcp-rest/tools`, `/mcp-rest/test`, `/{mcp_server_name}/authorize`, `/{mcp_server_name}/token`, `/{mcp_server_name}/register`, `/{mcp_server_name}/mcp`, `/.well-known/jwks.json`, `/.well-known/oauth-authorization-server/mcp/{name}`, `/.well-known/oauth-protected-resource`, `/public/mcp_hub` | `forge.mcp` |
| 9 | **Skills** | `/v1/skills`, `/v1/skills/{id}`, `/public/agent_hub`, `/utils/dotprompt_json_converter`, `/utils/transform_request` | `forge.skills` |
| 10 | **Tools (broader registry)** | `/v1/tool/list`, `/v1/tool/{name}/detail`, `/v1/tool/{name}/logs`, `/v1/tool/{name}/overrides`, `DELETE /v1/tool/{name}`, `/search_tools/list`, `/search_tools/test_connection`, `/search_tools/ui` | `forge.tools` |

> **Note on observed state:** the live `/health/readiness` response already lists `SkillsInjectionHook` as an active callback. This confirms Phase 2's Skill surface is real and active on the LiteLLM instance; spec assumes it can be exercised.

---

## Feature 6 — Guardrails

### Goal
Forge Backend becomes the **single enforcement point** for every safety rule: PII redaction, profanity blocks, secret scanning, jailbreak detection, output sanitization. Rules are registered in LiteLLM, resolved per request via policies (Feature 7), and applied on both sides of every chat completion.

### Spec

**Guardrail taxonomy (Forge-side classification):**

| Kind | Purpose | Examples |
|---|---|---|
| `pre_call_input` | Validate / sanitize user message before model sees it | PII redaction, secret scanning, prompt-injection detection, profanity |
| `pre_call_llm` | Run a cheap classifier on the input (often a small model) | Topic classifier, jailbreak classifier |
| `post_call_output` | Validate / sanitize model output before user sees it | Toxicity, PII leakage, secret leakage, brand-voice match |
| `during_call` | Stream-check output chunks as they arrive | Token-level PII, streaming toxicity |
| `custom_code` | Arbitrary user-defined Python | Domain validators, regex rule packs |

**Registration:**
- Forge admins call `POST /api/forge/guardrails` to register a guardrail.
- Forge Backend proxies to `POST /guardrails/register` with the full `LitellmParams` payload (`guardrail_name`, `litellm_params.mode`, `litellm_params.default_on`, `litellm_params.pii_entities_config`, etc.).
- Forge stores a `guardrail_id` and a human alias; both are valid identifiers in UI.

**Pre-call pipeline (every chat completion):**

```
input text
   │
   ▼
[pre_call_input guardrails]     ── block / modify / pass
   │
   ▼
[pre_call_llm guardrails]       ── block / modify / pass
   │
   ▼
[chat completion to LiteLLM]
   │
   ▼
[post_call_output guardrails]   ── block / modify / pass
   │
   ▼
[stream chunks to UI]
   │
   ▼
[during_call guardrails per chunk]
```

**Pre-call envelope (Forge Backend):**
1. Resolve effective guardrail set for this request (via Feature 7).
2. For each `pre_call_input` guardrail: `POST /apply_guardrail` with `{ guardrail_name, text: input }`.
   - If response `blocked == true`: emit `forge.guardrails.blocked` audit event with `{ guardrail_name, reason, request_id }`, return typed error `GuardrailViolation` to UI with the guardrail name + policy id that triggered.
   - If response `text != input`: replace text with masked version, log `forge.guardrails.masked`.
3. For each `pre_call_llm` guardrail: same shape, but `text` may be the model-generated classification, not the user text.

**Post-call envelope (Forge Backend):**
1. After every streamed chunk, the accumulated output is checked against `post_call_output` guardrails.
2. If violated: emit `forge.guardrails.blocked`, abort stream, return typed error to UI.
3. If `during_call` guardrails are configured: stream-check every chunk; on hit, replace chunk with `[REDACTED]` and emit audit event.

**Inline apply guardrails (alt path):**
- The alternate endpoint `POST /guardrails/apply_guardrail` is functionally equivalent to `/apply_guardrail`. Forge Backend uses `/apply_guardrail` as primary; the alternate is reserved for legacy clients.

**Custom-code guardrails:**
- Before deploying, Forge Backend calls `POST /guardrails/test_custom_code` with sample text to verify the guardrail returns a valid result (pass/block/mask).
- Failed test = registration rejected with the failure reason.

**Submissions log:**
- `GET /api/forge/guardrails/submissions?since=24h` proxies to `GET /guardrails/submissions/list`.
- Returns every guardrail evaluation: `{ ts, guardrail_name, request_id, decision: pass|block|mask, latency_ms, text_hash }`.

**UI-facing guardrails:**
- `GET /api/forge/guardrails/ui` proxies to `/guardrails/ui/list`.
- `POST /api/forge/guardrails/ui` proxies to `/guardrails/ui/save`.
- `GET /api/forge/guardrails/ui/:id` proxies to `/guardrails/ui/get`.
- These are the rule-builder surfaces admins use to construct guardrails without writing Python.

**v2 list:**
- `GET /v2/guardrails/list` is the canonical listing. Prefer it over `/guardrails/list` going forward.

### LiteLLM endpoints used
- `GET /guardrails/list`, `GET /v2/guardrails/list`
- `POST /guardrails/register`
- `GET /guardrails/info?guardrail_name=…`
- `POST /apply_guardrail` (master key)
- `POST /guardrails/apply_guardrail` (legacy alias)
- `POST /guardrails/test_custom_code`
- `GET /guardrails/submissions/list`
- `GET /guardrails/usage`
- `GET /guardrails/ui/list`
- `POST /guardrails/ui/save`
- `GET /guardrails/ui/get`
- `POST /guardrails/validate_blocked_words_file`

### Forge Backend contract
- `POST /api/forge/guardrails` — admin: register
- `GET /api/forge/guardrails` — list (with effective set for caller's tenant)
- `GET /api/forge/guardrails/:id` — detail
- `POST /api/forge/guardrails/:id/test` — dry-run on sample text
- `POST /api/forge/guardrails/test-custom-code` — admin: validate before deploy
- `GET /api/forge/guardrails/submissions` — audit trail
- `GET /api/forge/guardrails/ui` — UI rule-builder list
- `POST /api/forge/guardrails/ui` — UI rule-builder save

### Acceptance criteria
1. A chat with a registered `pre_call_input` PII guardrail redacts an email before the model sees it (verified by `forge.guardrails.masked` audit event with masked text).
2. A chat with a registered `pre_call_input` jailbreak guardrail is blocked before any LiteLLM call (verified by absence of `/v1/chat/completions` spend record).
3. A `post_call_output` secret-leak guardrail blocks a chat that contains an AWS key in the output (verified by `GuardrailViolation` error reaching UI and stream abort).
4. `during_call` guardrails redact chunks within 50ms of the violating token (streaming test).
5. `/guardrails/register` for a custom-code guardrail that fails `/guardrails/test_custom_code` is rejected with the failure reason.
6. Submission log `/api/forge/guardrails/submissions` includes `latency_ms` for every evaluation.
7. Guardrail registration is idempotent on `(tenant_id, guardrail_name)`.
8. Updating a guardrail via `POST /guardrails/register` (same name) does not require re-running Phase 1 acceptance criteria.
9. Disabling a guardrail at runtime is reflected in the next chat completion within 60 seconds (cache TTL).
10. `forge.guardrails.blocked` audit event includes the policy id that triggered the violation (cross-reference Feature 7).

---

## Feature 7 — Policies

### Goal
Make the **policy** the unit of governance, not the guardrail. A policy composes guardrails, scope, and decision logic; tenants attach policies to agents, teams, requests; the system resolves the **effective** guardrail set at request time via a single `policies.resolve` call.

### Spec

**Policy object:**
```yaml
Policy {
  id, name, description
  scope: { tenant_id?, team_id?, agent_id?, request_tags?[] }
  guardrails: GuardrailRef[]   # ordered, evaluated in sequence
  tool_policy: {
    allowed_tools?: string[]
    denied_tools?: string[]
    requires_approval?: string[]
    rate_limits?: { tool_name -> { rpm, tpm } }
  }
  decision_logic: {
    on_violation: "block" | "warn" | "modify" | "redact"
    on_multiple_violations: "any" | "all" | "majority"
    budget_override?: { max_cost_usd }
  }
  priority: integer             # higher = wins on conflict
  active: boolean
}
```

**Resolution algorithm (`POST /policies/resolve`):**
1. Input: `{ tenant_id, team_id?, agent_id?, request_tags?[], user_id? }`.
2. Forge Backend calls `POST /policies/resolve` (master key).
3. LiteLLM returns the **effective** policies matching the context, ordered by priority.
4. Forge Backend derives the effective guardrail list (ordered, deduplicated, with conflicts resolved by priority).
5. Forge Backend derives the effective tool policy (intersection of allow lists; union of deny lists; etc.).
6. Result is cached in Forge DB for the request lifetime — subsequent guardrail/tool evaluations reuse it.

**Comparison (`POST /policies/compare`):**
- Used by UI to show diff between two policy sets (e.g. "what changes when I switch agent from dev-policy to prod-policy?").
- Returns `{ additions, removals, modifications, conflict_warnings[] }`.

**Templates (`/policy/templates/list`):**
- Forge ships 5 starter templates: `dev-permissive`, `staging-balanced`, `prod-strict`, `pii-only`, `read-only-investigative`.
- Admins clone templates to create custom policies.

**Attachments (`/policies/attachments/list`):**
- Policies can be attached to: tenant, team, agent, request tag, or specific user.
- Attachments carry inheritance rules: `inherit: true|false`, `override_lower_priority: true|false`.

**Tool policy (`/v1/tool/policy`, `/v1/tool/policy/options`):**
- Tool-level policy is separate from guardrail-level policy.
- Lets admins say "agent X can use `github.create_pr` but only with human approval."
- `/v1/tool/policy/options` returns the schema for tool-policy authoring.

**Test pipeline (`/policies/test-pipeline`):**
- Given a policy set + sample chat, run the full guardrail pipeline offline.
- Used by UI's "Test policy" affordance before saving.
- Returns: `{ blocked_by?: guardrail_name, modified_text?: string, decisions: { guardrail_name, decision, latency_ms }[] }`.

**Policy utils (`/utils/test_policies_and_guardrails`):**
- Single endpoint to validate a policy + its guardrails together.
- Forge Backend calls this on every policy save.

**Policy lifecycle:**
- Draft → Review → Active → Archived.
- Status changes emit `forge.policies.status_changed` audit events.
- Active policies cannot be deleted; only archived.

**Composition rules (cross-policy):**
- Multiple policies may apply (tenant + team + agent). Order of evaluation:
  1. Higher priority first.
  2. More specific scope first (agent > team > tenant).
  3. Most recent activation first.
- Conflicting decisions: deny wins over allow. Block wins over warn.

### LiteLLM endpoints used
- `GET /policies/list`
- `GET /policies/info?policy_id=…`
- `GET /policies/status`
- `GET /policies/usage`
- `POST /policies/compare`
- `POST /policies/resolve`
- `POST /policies/test-pipeline`
- `POST /policies/test`
- `GET /policies/attachments/list`
- `POST /policies/resolved-guardrails`
- `GET /policy/list`
- `GET /policy/info`
- `POST /policy/test`
- `POST /policy/validate`
- `GET /policy/templates/list`
- `GET /v1/tool/policy`
- `GET /v1/tool/policy/options`
- `POST /utils/test_policies_and_guardrails`

### Forge Backend contract
- `GET /api/forge/policies` — list
- `POST /api/forge/policies` — create
- `GET /api/forge/policies/:id` — detail
- `PATCH /api/forge/policies/:id` — update
- `POST /api/forge/policies/:id/archive` — archive
- `POST /api/forge/policies/:id/test` — dry-run pipeline on sample chat
- `POST /api/forge/policies/resolve` — get effective set for a context (used internally + exposed to UI)
- `POST /api/forge/policies/compare` — diff two policy sets
- `GET /api/forge/policy/templates` — list starter templates
- `POST /api/forge/policy/templates/:id/clone` — clone to custom
- `GET /api/forge/policies/attachments` — list attachments
- `POST /api/forge/policies/attachments` — attach to scope

### Acceptance criteria
1. Attaching a policy to a tenant affects every chat in that tenant within one request.
2. A tenant + team + agent policy chain resolves deterministically: same input → same output, every time.
3. Higher-priority policy blocks a lower-priority allow (verified by attempting a call the lower policy allows but the higher denies).
4. `POST /policies/resolve` for an invalid context returns a typed error with the missing fields, never a 500.
5. Cloning a template produces a new policy with `policy_id` distinct from the template.
6. `POST /policies/test-pipeline` on a policy with an invalid guardrail returns a per-guardrail error breakdown.
7. Archiving a policy removes it from `POST /policies/resolve` results on the next call (no caching across status changes).
8. `forge.policies.status_changed` audit event fires for every status transition.
9. Policy with `decision_logic.on_violation == "warn"` produces a warning in UI but allows the call to complete.
10. Tool policy `requires_approval` triggers a human-in-the-loop prompt in the UI before dispatching the tool call.

---

## Feature 8 — MCP (Model Context Protocol)

### Goal
Forge Backend becomes the **MCP client/orchestrator**. Agents get tool access via MCP — discoverable, scoped, authenticated, and audited. The model emits `tool_calls`; Forge Backend dispatches them to the right MCP server; results flow back; the loop continues until the model emits `finish_reason: stop`.

### Spec

**MCP server registry:**
- Forge Backend maintains a registry of MCP servers per tenant.
- A server entry: `{ server_id, name, transport: stdio|sse|websocket, url, auth: { kind: none|oauth|api_key|jwt, … }, tools_allowlist?, tools_denylist?, healthcheck_url? }`.
- Registration is admin-only via `POST /api/forge/mcp/servers`.

**Discovery (per request):**
- For an agent run, Forge Backend:
  1. Reads the agent's MCP server allowlist.
  2. Calls `GET /v1/mcp/servers` (master key) and filters.
  3. Calls `GET /v1/mcp/tools?server_ids=[...]` to enumerate tools.
  4. Merges with the agent's static tool list and the broader Tools registry (Feature 10).
  5. Translates to OpenAI `tools[]` format and attaches to chat completion request.

**Invocation (during chat):**
- When the model emits a `tool_call` chunk:
  1. Parse `tool_call.function.name` and `tool_call.function.arguments`.
  2. Look up which MCP server owns the tool (from the registry).
  3. If `requires_approval` (from tool policy, Feature 7) → pause stream, surface approval prompt to UI.
  4. On approval (or if auto-allowed): `POST /v1/mcp/call` with `{ server_id, tool_name, arguments }`.
  5. Receive `{ result, is_error }`. If `is_error`, treat as a tool-side error and feed back to model.
  6. Append `{ role: "tool", tool_call_id, content: result }` to messages.
  7. Continue chat completion loop.

**Loop termination:**
- Loop terminates when `finish_reason == "stop"` or `finish_reason == "length"` or max-iterations reached (default 10, configurable per agent).
- On max iterations: emit `forge.chat.max_iterations` audit event, abort with typed error.

**OAuth flow (for MCP servers that require it):**
- UI clicks "Connect GitHub" → Forge Backend redirects to `/{mcp_server_name}/authorize?…`.
- User completes OAuth at the upstream provider.
- Provider redirects back to `/{mcp_server_name}/token` (handled by Forge Backend).
- Forge Backend stores the refresh token encrypted; exchanges for access tokens at call time.
- Token state visible at `/api/forge/mcp/servers/:id/auth/status` — never returns the token, only `connected | expired | needs_reauth | not_connected`.

**JWT signing (`/.well-known/jwks.json`):**
- Forge Backend caches LiteLLM's JWKS for outbound MCP JWT verification.
- Refresh on key rotation event.

**Public MCP hub (`/public/mcp_hub`):**
- Forge UI's "Browse MCP servers" panel reads this list.
- No auth required; rate-limited at the Forge layer.

**Connection test:**
- `POST /api/forge/mcp/servers/:id/test` proxies to `/mcp-rest/test` and returns `{ reachable, latency_ms, tool_count, sample_tools[] }`.

**MCP tools via REST alt (`/mcp-rest/tools`):**
- Used when an MCP server doesn't support the streaming protocol; Forge Backend falls back to REST tool enumeration.

**Auth scope:**
- MCP-level auth is per-tenant. Two tenants cannot share MCP server credentials.
- One MCP server can be registered by multiple tenants; each tenant has its own auth.

**Reliability:**
- MCP tool calls have a 60-second default timeout (configurable per tool).
- On timeout: retry once with exponential backoff; if still failing, abort with typed error `MCPToolTimeout`.
- All MCP calls are wrapped in audit events with `{ server_id, tool_name, request_id, duration_ms, status }`.

### LiteLLM endpoints used
- `GET /v1/mcp/servers`
- `GET /v1/mcp/tools`
- `POST /v1/mcp/call`
- `GET /mcp-rest/tools`
- `POST /mcp-rest/test`
- `GET /{mcp_server_name}/authorize`
- `POST /{mcp_server_name}/token`
- `POST /{mcp_server_name}/register`
- `POST /{mcp_server_name}/mcp`
- `GET /.well-known/jwks.json`
- `GET /.well-known/oauth-authorization-server/mcp/{name}`
- `GET /.well-known/oauth-protected-resource`
- `GET /public/mcp_hub`

### Forge Backend contract
- `GET /api/forge/mcp/servers` — list (tenant-scoped)
- `POST /api/forge/mcp/servers` — admin: register
- `DELETE /api/forge/mcp/servers/:id` — admin: unregister
- `GET /api/forge/mcp/servers/:id` — detail (no secrets)
- `POST /api/forge/mcp/servers/:id/test` — connection test
- `GET /api/forge/mcp/servers/:id/tools` — enumerated tools
- `GET /api/forge/mcp/servers/:id/auth/status` — OAuth status (no tokens)
- `POST /api/forge/mcp/servers/:id/auth/refresh` — force token refresh
- `GET /api/forge/mcp/hub` — public hub browsing
- `POST /api/forge/mcp/call` — internal: dispatch a tool call (used by chat loop)

### Acceptance criteria
1. An agent with access to an MCP server receives `tool_calls` with the right OpenAI-format `tools[]` definition.
2. A model emitting `tool_call(github.create_pr, {...})` results in exactly one `POST /v1/mcp/call` to the GitHub MCP server.
3. Tool results are appended to the message thread as `{role: "tool", tool_call_id, content}` and the chat loop continues.
4. A `requires_approval` tool call pauses the stream and surfaces an approval UI affordance before dispatching.
5. An MCP server in `expired` auth state blocks tool calls with typed error `MCPAuthExpired` and offers a reauth flow in UI.
6. OAuth flow (`authorize → token`) completes end-to-end and stores encrypted refresh tokens (never plaintext in DB).
7. `POST /mcp-rest/test` on an unreachable server returns `{ reachable: false }` with latency error, not a 500.
8. `forge.mcp.tool_called` audit event fires for every MCP tool invocation with duration + status.
9. Max-iterations reached (default 10) emits `forge.chat.max_iterations` and aborts cleanly.
10. Public MCP hub `GET /api/forge/mcp/hub` returns within 500ms.

---

## Feature 9 — Skills

### Goal
A **Skill** is a reusable, versioned, composable unit of agent capability: a prompt template + a set of tools + a configuration block. Forge Backend manages the skill registry and **injects** the skill into every chat completion that references it (via the `SkillsInjectionHook` already observed in `/health/readiness`).

### Spec

**Skill object:**
```yaml
Skill {
  id, name, description, version
  status: draft | active | archived
  prompt_template: string         # Jinja2-style, supports {{variables}}
  tools: ToolRef[]                # references to MCP / Tools registry entries
  config: {
    default_model?: string
    temperature?: number
    max_tokens?: number
    response_format?: json | text
    reasoning_effort?: low | medium | high
  }
  metadata: {
    forge_tenant_id, created_by, created_at, updated_at
    category: code | review | test | docs | ops | custom
    tags: string[]
  }
}
```

**Registration:**
- `POST /api/forge/skills` (admin) → proxied to `POST /v1/skills`.
- Idempotent on `(tenant_id, name, version)`.
- Version auto-incremented if `name` exists without version.

**Listing:**
- `GET /api/forge/skills?category=code&status=active` → filtered list.
- Cached for 60s per tenant.

**Public catalog (`/public/agent_hub`):**
- Forge UI's "Skill marketplace" panel reads from this.
- Allows one-click import of public skills into a tenant.

**Dotprompt conversion (`/utils/dotprompt_json_converter`):**
- Skills authored in `.prompt` format are auto-converted to JSON schema on save.
- This is the canonical format for cross-platform skill portability.

**Request transformation (`/utils/transform_request`):**
- Before each chat completion, Forge Backend calls `/utils/transform_request` with the skill + raw request.
- The response is the **effective** request: skills injected, tools merged, config defaults applied.
- This is the integration point with the `SkillsInjectionHook`.

**Injection flow (per chat):**
1. Agent specifies `skill_ids: [...]` (from agent config).
2. Forge Backend loads each skill.
3. For each skill, call `/utils/transform_request` to merge into the chat request.
4. Final chat request goes to `/v1/chat/completions` with the merged system prompt + tools + config.
5. `SkillsInjectionHook` on LiteLLM side additionally validates the skill is registered.

**Versioning:**
- Skill versions are immutable once active.
- Updating a skill creates a new version; previous versions remain accessible.
- Agent configs pin to a specific version (no auto-upgrade).

**Lifecycle:**
- Draft → Active (admin approves) → Archived.
- Archived skills cannot be referenced by new agents but existing references continue to work.

**Composition:**
- An agent can reference multiple skills; their prompts are concatenated in order.
- Tool conflicts resolved by priority (later skill wins).
- Validation: if two skills define the same tool with conflicting schemas, Forge Backend returns a typed error at agent-save time.

**Audit:**
- Every skill injection emits `forge.skills.injected` with `{ skill_id, version, request_id }`.
- Skill registry changes emit `forge.skills.created | updated | archived`.

### LiteLLM endpoints used
- `GET /v1/skills`
- `POST /v1/skills`
- `GET /v1/skills/{id}`
- `DELETE /v1/skills/{id}`
- `GET /public/agent_hub`
- `POST /utils/dotprompt_json_converter`
- `POST /utils/transform_request`
- `GET /utils/supported_openai_params`
- `POST /utils/token_counter`

### Forge Backend contract
- `GET /api/forge/skills` — list (tenant-scoped, filterable)
- `POST /api/forge/skills` — admin: create
- `GET /api/forge/skills/:id` — detail (specific version)
- `PATCH /api/forge/skills/:id` — update (creates new version)
- `POST /api/forge/skills/:id/archive` — archive
- `GET /api/forge/skills/hub` — public marketplace
- `POST /api/forge/skills/hub/import` — import a public skill
- `POST /api/forge/skills/preview` — render a skill's prompt with sample variables (no chat call)

### Acceptance criteria
1. Creating a skill via `POST /api/forge/skills` results in exactly one `POST /v1/skills` call.
2. A skill with a `prompt_template` referencing `{{language}}` renders correctly with `{"language": "TypeScript"}` via `/api/forge/skills/preview`.
3. An agent referencing 2 skills receives a chat completion where the system prompt contains both skills' content in order.
4. Skill tool conflicts (same tool, different schema) are detected at agent-save time, not at chat time.
5. Archived skills still resolve for agents that pinned to them before archival.
6. Public skill import creates a tenant-local copy with `forge_tenant_id` set.
7. `forge.skills.injected` audit event fires for every chat that references a skill.
8. Skill version bump is reflected in the next chat completion without restarting Forge Backend.
9. `/utils/transform_request` is called **once per skill per chat**, never per chunk.
10. A skill with broken Jinja returns a typed error at save time, not at first chat use.

---

## Feature 10 — Tools (broader registry)

### Goal
A **broader Tools registry** that goes beyond MCP: native LiteLLM tools (file system, code execution, retrieval), custom tools, and tools proxied from external services. Tools are first-class objects with their own audit trail, overrides, and logs.

### Spec

**Tool taxonomy (Forge-side):**

| Kind | Source | Examples |
|---|---|---|
| `mcp` | MCP gateway (Feature 8) | `github.create_pr`, `slack.send_message` |
| `native` | LiteLLM built-in | `code_execution`, `file_search`, `web_search` |
| `function` | Custom OpenAI-format function | `lookup_customer`, `create_ticket` |
| `passthrough` | Provider-specific | Anthropic `computer_use`, OpenAI `image_generation` |

**Listing:**
- `GET /api/forge/tools?kind=mcp&server_id=…` → filtered list.
- Cached for 60s; bust on tool registry change.

**Detail:**
- `GET /api/forge/tools/:name` returns `{ name, kind, description, parameters, server_id?, version, deprecated, requires_approval, cost_estimate_usd }`.

**Logs:**
- `GET /api/forge/tools/:name/logs?since=24h` proxies to `/v1/tool/{name}/logs`.
- Returns every invocation: `{ ts, request_id, agent_id, arguments_hash, result_hash, duration_ms, status }`.
- `arguments_hash` and `result_hash` are SHA-256 — the raw payload is never stored at this level (full payload in spend logs from Phase 1).

**Overrides:**
- Per-tool overrides let admins tweak behavior without re-registering:
  - `{ tool_name, override: { max_calls_per_run, timeout_ms, requires_approval, model_replacement? } }`.
- Stored via `GET /v1/tool/{name}/overrides` and updated via `PUT /v1/tool/{name}/overrides`.

**Deletion:**
- Soft-delete only: `DELETE /v1/tool/{name}` marks archived; existing agent references continue to work until the agent is updated.

**Search tools (`/search_tools/*`):**
- A separate registry of tools that provide search/retrieval semantics (e.g. vector search, web search, code search).
- `GET /search_tools/list` enumerates available search tools.
- `POST /search_tools/test_connection` validates a search tool's reachability.
- `GET /search_tools/ui` returns UI-formatted metadata for the search-tool picker.

**Tool policy integration:**
- Tools from this registry participate in the policy system (Feature 7): a tool can be `allowed`, `denied`, or `requires_approval` per agent/team/tenant.

**Audit:**
- Every tool invocation emits `forge.tools.invoked` with `{ tool_name, kind, request_id, agent_id, duration_ms, status, decision }` where `decision` is `allowed | denied | approval_required | overridden`.

### LiteLLM endpoints used
- `GET /v1/tool/list`
- `GET /v1/tool/{name}/detail`
- `GET /v1/tool/{name}/logs`
- `GET /v1/tool/{name}/overrides`
- `DELETE /v1/tool/{name}`
- `GET /search_tools/list`
- `POST /search_tools/test_connection`
- `GET /search_tools/ui`

### Forge Backend contract
- `GET /api/forge/tools` — list (filterable by kind, server, status)
- `GET /api/forge/tools/:name` — detail
- `GET /api/forge/tools/:name/logs` — invocation log
- `GET /api/forge/tools/:name/overrides` — current overrides
- `PUT /api/forge/tools/:name/overrides` — admin: set overrides
- `DELETE /api/forge/tools/:name` — admin: archive
- `GET /api/forge/search-tools` — search-tool picker
- `POST /api/forge/search-tools/:id/test` — connection test

### Acceptance criteria
1. Listing tools returns the union of MCP tools (Feature 8), native tools, and custom function tools.
2. `GET /api/forge/tools/:name/logs` returns invocations from the last 24h with hashes (no raw payloads).
3. Tool override `{ max_calls_per_run: 1 }` blocks a second call to that tool within the same chat loop.
4. `requires_approval` from a tool override surfaces a UI approval prompt identical to the policy-driven one (Feature 7).
5. Soft-deleted tools are filtered out of `GET /api/forge/tools` default results but remain accessible by id.
6. `forge.tools.invoked` audit event fires for every tool invocation (MCP, native, custom).
7. `search_tools/test_connection` against an unreachable endpoint returns `{ reachable: false }`, not a 500.
8. Tool detail endpoint returns `cost_estimate_usd` for tools that have a registered cost.
9. Tool override changes are reflected in the next chat completion within 60 seconds.
10. Tool list includes both `name` (canonical id) and `display_name` (human label) so UI can render a friendly picker.

---

## Cross-Cutting Concerns

### Audit events (new in Phase 2)
- `forge.guardrails.registered | updated | deleted`
- `forge.guardrails.applied | blocked | masked | redacted`
- `forge.policies.created | updated | archived | status_changed`
- `forge.policies.resolved` (with effective guardrail list)
- `forge.policies.compared`
- `forge.mcp.server_registered | server_unregistered | auth_refreshed | auth_expired`
- `forge.mcp.tool_called`
- `forge.skills.created | updated | archived | injected`
- `forge.tools.invoked | overridden | archived`
- `forge.chat.max_iterations`

### Error envelope (additions)
- `GuardrailViolation` (422) — `{ code, guardrail_name, policy_id, reason }`
- `MCPAuthExpired` (401) — `{ server_id, reauth_url }`
- `MCPToolTimeout` (504) — `{ server_id, tool_name, duration_ms }`
- `PolicyResolutionError` (422) — `{ missing_fields[] }`
- `SkillRenderError` (422) — `{ skill_id, template_error }`
- `ToolApprovalRequired` (409) — `{ tool_name, request_id, approval_url }`

### Rate limits (additions)
- Per-agent tool calls: 60/min (default; configurable per tool via overrides).
- Per-tenant MCP server registrations: 50 max.
- Per-tenant skills: 100 max.

### Composition: agent = skill + tools + guardrails + policies + chat
```
Agent config
├── skill_ids:         [Skill A, Skill B]
├── tool_policy:       { allowed_tools, denied_tools, requires_approval }
├── guardrail_refs:    [G1, G2]
├── policy_refs:       [P1, P2]
├── mcp_servers:       [M1, M2]
├── model:             openai/gpt-4o
└── chat_config:       { temperature, max_tokens, … }

At request time, Forge Backend:
  1. resolvePolicies(agent, context)         → effective policies
  2. resolveGuardrails(policies)              → ordered guardrail list
  3. loadSkills(skill_ids)                    → skill bodies
  4. discoverTools(mcp_servers + tool_policy) → tool palette
  5. transformRequest(skills, request)        → merged request
  6. applyGuardrails('pre_call_input')        → sanitized input
  7. chatCompletion(merged_request)           → model output
  8. applyGuardrails('post_call_output')      → sanitized output
  9. (loop) on tool_call: dispatch → MCP call → append result → goto 7
 10. recordSpend + audit
```

---

## Data Flow (Phase 2)

```
┌─────────────┐                ┌─────────────────┐                  ┌─────────────────┐
│  Forge UI   │  chat request  │  Forge Backend  │  resolvePolicies │  LiteLLM (admin)│
│             │ ─────────────► │                 │ ───────────────► │                 │
│             │                │                 │ ◄─────────────── │                 │
│             │                │                 │                  └─────────────────┘
│             │                │                 │
│             │                │                 │  applyGuardrail  ┌─────────────────┐
│             │                │                 │ ───────────────► │  LiteLLM (chat) │
│             │                │                 │ ◄─────────────── │                 │
│             │                │                 │                  └─────────────────┘
│             │                │                 │
│             │                │                 │  transformReq    ┌─────────────────┐
│             │                │                 │ ───────────────► │  LiteLLM (utils)│
│             │                │                 │ ◄─────────────── │                 │
│             │                │                 │                  └─────────────────┘
│             │                │                 │
│             │ ◄───────────── │                 │  v1/mcp/call     ┌─────────────────┐
│             │  SSE stream    │                 │ ───────────────► │  MCP servers    │
│             │                │                 │ ◄─────────────── │  (GitHub, etc.) │
└─────────────┘                └─────────────────┘                  └─────────────────┘
```

---

## Build Order (within Phase 2)

1. **Feature 6: Guardrails** — load-bearing for everything else; must work before agents can be safe.
2. **Feature 7: Policies** — composes guardrails into a reusable unit.
3. **Feature 9: Skills** — registry + injection (relatively isolated).
4. **Feature 8: MCP** — biggest new surface; needs skills for realistic testing.
5. **Feature 10: Tools registry** — broader surface that depends on MCP for the `mcp` kind.

**Verification gate after each feature:** acceptance criteria met + Phase 1 regression suite still green.

---

## Anti-Patterns (auto-reject if seen)

- ❌ Chat completion called without first resolving policies.
- ❌ Guardrail evaluation that runs post-call only (must also run pre-call).
- ❌ Policy attachment that mutates a higher-priority policy.
- ❌ MCP tool call dispatched without checking `requires_approval`.
- ❌ Skill prompt injected via string concatenation without template validation.
- ❌ Tool invocation without a corresponding `forge.tools.invoked` audit event.
- ❌ Guardrail violation silently passed through with a warning instead of a typed error.
- ❌ Policy resolution cache that survives a status change.
- ❌ MCP auth token ever returned in any API response (only `connected | expired | needs_reauth`).
- ❌ Tool calls looped without a max-iterations safeguard.

---

## Deliverables for Phase 2

1. `forge-guardrails.md` — registration, evaluation pipeline, submissions log, UI rule-builder
2. `forge-policies.md` — policy object, resolution algorithm, comparison, templates
3. `forge-mcp.md` — server registry, OAuth flow, invocation loop, public hub
4. `forge-skills.md` — registry, versioning, injection, marketplace
5. `forge-tools.md` — broader tool registry, overrides, logs
6. `forge-agent-composition.md` — how the 5 features compose into one agent definition
7. `forge-phase2-audit-events.md` — every new audit event with payload schema
8. `forge-phase2-error-codes.md` — every new error type with retry semantics
9. `forge-phase2-verification.md` — acceptance criteria checklist with evidence per feature
10. `forge-phase2-regression-report.md` — Phase 1 acceptance criteria still passing

---

## Out of Scope for Phase 2 (deferred to later phases)

- Prompts (versioned prompt library, separate from skills) — Phase 3
- RAG / vector stores / embeddings — Phase 3
- Files / batches / fine-tuning — Phase 3
- Provider pass-through for Cursor-compat OpenAI — Phase 4
- Realtime / responses / interactions — Phase 4
- OAuth / SCIM / SSO at the Forge layer — Phase 4
- Cache, credentials, CloudZero / Vantage exports — Phase 4

These are listed in `forge-litellm-integration.md` §3 with their LiteLLM endpoints; they are explicitly **not** part of Phase 2's spec.
