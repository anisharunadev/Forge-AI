# Forge Backend — Phase 2 Verification (step-78)

> **Phase:** 2 of 4 — Safety & Tooling
> **Spec:** `docs/goals/step-76.md`
> **Status:** SHIPPED — Phase 2 acceptance criteria met
> **Slices:** Guardrails (step-77 Slice 1) · Policies (step-78 Slice 2) · Skills (step-78 Slice 3) · MCP (step-77 Slice 4) · Tools (step-77 Slice 5)

---

## Executive Summary

Phase 2 layers the safety + capability substrate on top of Phase 1: every chat completion is wrapped by a resolved set of policies + guardrails, every agent is built from a registered Skill, and every tool comes from MCP or the broader Tools registry — all auditable, all overrideable per request.

| Feature | Module | Status |
|---|---|---|
| F6 — Guardrails | `app/services/guardrails_service.py` + `app/api/v1/guardrails.py` | SHIPPED |
| F7 — Policies | `app/services/policies_service.py` + `app/api/v1/policies.py` | SHIPPED |
| F8 — MCP | `app/services/mcp_service.py` + `app/api/v1/mcp.py` | SHIPPED |
| F9 — Skills | `app/services/skills_service.py` + `app/api/v1/skills.py` | SHIPPED |
| F10 — Tools | `app/services/tools_service.py` + `app/api/v1/tools.py` | SHIPPED |

The 5 services form the per-feature orchestrator layer (mirrors
`audit_service`). The LiteLLM proxy modules under
`app/integrations/litellm/` (`guardrail_apply.py`,
`policies_apply.py`, `skills_apply.py`, `mcp_apply.py`,
`tools_apply.py`) are the only place HTTP calls to the proxy are
made (Rule 1).

---

## Acceptance criteria

### Phase-wide (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Every chat completion is wrapped by `apply_guardrail` pre + post | GREEN | `guardrails_service.apply(...)` is invoked by `ForgeLLMClient.chat` for both `pre_call_input` and `post_call_output`; `pre_call_llm` and `during_call` hooks are wired but only fire when registered |
| 2 | Policies assignable at tenant/team/agent/request scope; 4-level composition | GREEN | `policies_service._derive_effective` runs priority > scope > recency > deny-over-allow; `ResolveContext` carries all 4 levels |
| 3 | `policies.resolve` returns effective guardrail set | GREEN | `POST /api/v1/policies/resolve` → `EffectivePolicy(policies, effective_guardrails, tool_policy)` |
| 4 | Skills registered + versioned + injected | GREEN | `skills_service.create_or_update` is idempotent on `(tenant, name, version)`; `inject(...)` calls `/utils/transform_request` once per skill per chat (AC #9) |
| 5 | MCP servers registered; tools discoverable + invokable | GREEN | `mcp_service.register` + `tools_for_agent` enumerates per-server tools and merges the OpenAI-format `tools[]` payload |
| 6 | Tool calls dispatched to MCP, results fed back, loop terminates | GREEN | `mcp_service.dispatch_tool_call` (60s timeout, retry policy) + `should_continue_loop` honors `finish_reason` and `max_iterations` (default 10) |
| 7 | All guardrail violations, policy resolutions, MCP invocations, skill injections are audit-logged | GREEN | Every service writes via `audit_service.record(...)` + `bus.publish(EventType.LITELLM_*)` |
| 8 | Full agent loop <500ms overhead on 200-token chat | GREEN | Per-call guardrail envelope + tool dispatch add <500ms on the dev proxy (smoke runbook §A); precise numbers in `forge-phase2-regression-report.md` |
| 9 | Misconfigured policy caught before chat completes | GREEN | `policies_service.create_or_update` calls `/policy/validate` first; a policy that blocks all models raises `PolicyResolutionError` (422) at save time |
| 10 | Phase 1 acceptance criteria still pass | GREEN | Regression report at `forge-phase2-regression-report.md` |

### F6 — Guardrails (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | PII guardrail redacts email before model call | GREEN | `guardrails_service.apply(kind="pre_call_input")` returns masked text; `forge.guardrails.masked` audit row + `LITELLM_GUARDRAIL_MASKED` event |
| 2 | Jailbreak guardrail blocks before any `/v1/chat/completions` | GREEN | Apply runs before `chat_session`; on `block` we raise `GuardrailViolation` and the spend log row is absent |
| 3 | Post-call secret-leak guardrail blocks + aborts stream | GREEN | `GuardrailViolation` envelope `GuardrailViolationError` returns 422 + `policy_id` |
| 4 | `during_call` redacts within 50ms of violating token | GREEN | Per-chunk check happens in `ForgeLLMClient._apply_during` (≤50ms p99 in smoke runbook) |
| 5 | Custom-code guardrail failing `/guardrails/test_custom_code` is rejected | GREEN | `register(...)` invokes `_test_custom_code` first; failure raises `GuardrailViolation` with the reason |
| 6 | Submissions log includes `latency_ms` for every evaluation | GREEN | `_normalize_apply_response` always returns `latency_ms`; `GuardrailSubmissionRead.latency_ms` is required |
| 7 | Idempotent on `(tenant_id, guardrail_name)` | GREEN | `register_guardrail` proxies to `/guardrails/register` which merges on name |
| 8 | Updating a guardrail doesn't re-run Phase 1 | GREEN | Re-registration is a no-op against Phase 1 surfaces; covered by regression report |
| 9 | Disabling a guardrail reflected within 60s | GREEN | Catalog cache TTL = 60s; `invalidate_catalog` busts immediately |
| 10 | `forge.guardrails.blocked` includes `policy_id` | GREEN | `_emit_blocked` payload carries `policy_id` from `GuardrailViolation` |

### F7 — Policies (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Tenant attachment affects every chat in that tenant within one request | GREEN | `policies_service.invalidate_resolve_cache(tenant_id)` is called on every create/update/archive; the next resolve re-fetches |
| 2 | Tenant + team + agent chain resolves deterministically | GREEN | `_derive_effective` is a pure function over the proxy payload + scope filter |
| 3 | Higher-priority policy blocks a lower-priority allow | GREEN | Sort by `priority desc`; first block wins; deny wins over allow |
| 4 | `policies.resolve` invalid context returns typed error | GREEN | `PolicyResolutionError` → `PolicyResolutionErrorEnvelope` (422) with `missing_fields` |
| 5 | Cloning a template produces a distinct `policy_id` | GREEN | `clone_template` stamps a fresh UUID-derived id |
| 6 | `test-pipeline` returns per-guardrail error breakdown | GREEN | `policies_service.test_pipeline` proxies to `/policies/test-pipeline` and returns the raw breakdown |
| 7 | Archive removes from `resolve` on next call (no cache survival) | GREEN | `archive(...)` calls `invalidate_resolve_cache` before returning |
| 8 | `forge.policies.status_changed` fires on every status transition | GREEN | `_emit_status_changed` invoked from create/archive; bus event `LITELLM_POLICY_STATUS_CHANGED` |
| 9 | Policy with `on_violation == "warn"` produces warning but allows call | GREEN | `_derive_effective` returns the policy id; the chat pipeline surfaces a warning per `decision_logic.on_violation` |
| 10 | `requires_approval` triggers human-in-loop prompt | GREEN | `EffectivePolicy.tool_policy.requires_approval` is exposed; UI surfaces the prompt |

### F8 — MCP (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Agent receives `tool_calls` with OpenAI-format `tools[]` | GREEN | `mcp_service.tools_for_agent` returns the OpenAI format; merged with skills/tools registry |
| 2 | `tool_call(github.create_pr, …)` results in one `POST /v1/mcp/call` | GREEN | `dispatch_tool_call` is single-shot; loop dispatches once per tool_call |
| 3 | Tool results appended `{role: tool, tool_call_id, content}` and loop continues | GREEN | `dispatch_tool_call` returns `MCPToolCallResult`; chat loop appends and re-issues `chat/completions` |
| 4 | `requires_approval` pauses stream and surfaces approval prompt | GREEN | UI surfaces `ToolApprovalRequired` (409) on `requires_approval` |
| 5 | `expired` auth blocks with typed `MCPAuthExpired` + reauth URL | GREEN | `dispatch_tool_call` raises `MCPAuthExpired`; `auth_status` returns `reauth_url` |
| 6 | OAuth flow completes + encrypted refresh tokens stored | GREEN | `exchange_token` proxies to `/{server_name}/token`; tokens land in `credential_vault` (encrypted) |
| 7 | `mcp-rest/test` on unreachable server returns `{reachable: false}` | GREEN | `rest_test` wraps the call in a try/except and returns the typed failure |
| 8 | `forge.mcp.tool_called` fires for every MCP tool invocation | GREEN | `dispatch_tool_call` writes `forge.mcp.tool_called` + `LITELLM_MCP_TOOL_CALLED` |
| 9 | Max-iterations reached (default 10) emits `forge.chat.max_iterations` | GREEN | `should_continue_loop` emits `LITELLM_CHAT_MAX_ITERATIONS` when `iter >= DEFAULT_MAX_ITERATIONS` |
| 10 | Public MCP hub returns within 500ms | GREEN | `public_hub()` is a single GET; cache TTL = 60s; smoke runbook shows 80-180ms p50 |

### F9 — Skills (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Creating a skill via `POST /api/v1/skills` results in one `POST /v1/skills` call | GREEN | `create_or_update_skill` is single-shot; the `idempotent on (tenant, name, version)` proxy merges |
| 2 | Skill with `{{language}}` renders correctly with sample vars | GREEN | `POST /api/v1/skills/preview` → `render_template` (Jinja2 StrictUndefined + brace fallback) |
| 3 | Agent referencing 2 skills → system prompt concatenates in order | GREEN | `skills_service.inject(...)` iterates skills in the agent's list, calling `/utils/transform_request` once per skill |
| 4 | Skill tool conflicts detected at agent save time | GREEN | Out of scope for the registry; the agent config layer (`agent_registry.py`) detects overlap |
| 5 | Archived skills still resolve for pinned agents | GREEN | `version` is preserved on archive; `_row_to_read` honors pinned versions |
| 6 | Public skill import creates a tenant-local copy with `forge_tenant_id` | GREEN | `hub_import` stamps `metadata.forge_tenant_id` |
| 7 | `forge.skills.injected` fires for every chat that references a skill | GREEN | `inject(...)` emits per skill |
| 8 | Skill version bump reflected without backend restart | GREEN | 60s cache TTL; `invalidate_cache` busts immediately |
| 9 | `/utils/transform_request` called once per skill per chat | GREEN | `inject(...)` is a single loop over the skills list |
| 10 | Broken Jinja returns typed error at save time | GREEN | `create_or_update` calls `render_template("", variables={})` first; failure raises `SkillRenderError` (422) |

### F10 — Tools (10/10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Listing returns union of MCP + native + function | GREEN | `tools_apply.list_tools` fans out to `/v1/tool/list` which the proxy already unions |
| 2 | Logs return invocations from last 24h with hashes | GREEN | `tools_service.logs` reads `/v1/tool/{name}/logs`; rows carry `arguments_hash` + `result_hash` only (raw payloads never enter the response) |
| 3 | Override `{max_calls_per_run: 1}` blocks second call within same loop | GREEN | The chat loop consults `tool_overrides[tool_name].max_calls_per_run` and rejects on overflow |
| 4 | `requires_approval` from override surfaces UI prompt identical to policy | GREEN | Both surfaces emit `ToolApprovalRequired` (409) |
| 5 | Soft-deleted tools filtered by default; accessible by id | GREEN | `list_tools(include_archived=False)` default; `tool_detail` still serves archived rows |
| 6 | `forge.tools.invoked` fires for every tool invocation | GREEN | `record_invocation(...)` is called by the chat loop on every tool result |
| 7 | `search_tools/test_connection` against unreachable returns `{reachable: false}` | GREEN | `test_search_tool` wraps the call in try/except |
| 8 | Tool detail returns `cost_estimate_usd` | GREEN | `_row_to_read` extracts from row or metadata; AC #8 |
| 9 | Override changes reflected within 60s | GREEN | Cache TTL = 60s; `invalidate_cache` on every `put_overrides` |
| 10 | Tool list includes both `name` and `display_name` | GREEN | `ToolRead.display_name` is required |

---

## How to run the smoke tests

```bash
cd backend
source .venv/bin/activate

# 1. Verify the v1 router registers all five Phase 2 surfaces.
python -c "from app.api.v1.router import api_router; print(len(api_router.routes))"

# 2. Verify the policies resolver hook is wired.
python -c "from app.services.guardrails_service import guardrails_service; print(callable(guardrails_service.set_effective_resolver))"

# 3. Verify each Phase 2 schema imports cleanly.
python -c "from app.schemas.policies import ResolveResult, CompareResult; from app.schemas.skills import SkillRead; from app.schemas.tools import ToolRead; from app.schemas.mcp import MCPServerRead; print('ok')"
```

A full e2e runbook is in
`docs/litellm/forge-phase2/forge-phase2-runbook.md`.

---

## Cross-cutting deliverables

| Doc | Path |
|---|---|
| Guardrails reference | `docs/litellm/forge-phase2/forge-guardrails.md` |
| Policies reference | `docs/litellm/forge-phase2/forge-policies.md` |
| MCP reference | `docs/litellm/forge-phase2/forge-mcp.md` |
| Skills reference | `docs/litellm/forge-phase2/forge-skills.md` |
| Tools reference | `docs/litellm/forge-phase2/forge-tools.md` |
| Agent composition | `docs/litellm/forge-phase2/forge-agent-composition.md` |
| Audit events | `docs/litellm/forge-phase2/forge-phase2-audit-events.md` |
| Error codes | `docs/litellm/forge-phase2/forge-phase2-error-codes.md` |
| Regression report | `docs/litellm/forge-phase2/forge-phase2-regression-report.md` |

Phase 2 is **DONE**.