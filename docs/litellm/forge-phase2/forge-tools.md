# Forge Tools (Phase 2 F10)

> Spec: `docs/goals/step-76.md` §Feature 10
> Module: `app/services/tools_service.py` + `app/api/v1/tools.py`
> Proxy: `app/integrations/litellm/tools_apply.py`

## Taxonomy

| Kind | Source | Examples |
|---|---|---|
| `mcp` | MCP gateway (F8) | `github.create_pr` |
| `native` | LiteLLM built-in | `code_execution`, `web_search` |
| `function` | Custom OpenAI-format | `lookup_customer` |
| `passthrough` | Provider-specific | `computer_use`, `image_generation` |

## Surface

- `GET /api/v1/tools?kind=&server_id=` — filtered list (60s cache; soft-deleted hidden by default).
- `GET /api/v1/tools/{name}` — detail; both `name` and `display_name` present (AC #10).
- `GET /api/v1/tools/{name}/logs?since_hours=24` — invocation log, hashes only (AC #2).
- `GET/PUT /api/v1/tools/{name}/overrides` — `{max_calls_per_run, timeout_ms, requires_approval, model_replacement}`.
- `DELETE /api/v1/tools/{name}` — soft-archive; existing agents keep working until re-saved.

## Search tools

- `GET /api/v1/tools/search-tools/list`
- `POST /api/v1/tools/search-tools/{id}/test` — returns `{reachable, latency_ms, error}`.

## Tool policy integration

Tools participate in the policy system (F7): `allowed_tools`, `denied_tools`, `requires_approval`. Both policy-driven and override-driven approvals surface the same `ToolApprovalRequired` UI affordance (409).

## Audit

Every invocation writes `forge.tools.invoked` with `{tool_name, kind, request_id, agent_id, duration_ms, status, decision}`. `decision ∈ {allowed, denied, approval_required, overridden}`.