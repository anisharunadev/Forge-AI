# Forge MCP (Phase 2 F8)

> Spec: `docs/goals/step-76.md` §Feature 8
> Module: `app/services/mcp_service.py` + `app/api/v1/mcp.py`
> Proxy: `app/integrations/litellm/mcp_apply.py`

## Per-tenant registry

```http
POST /api/v1/mcp/servers
{
  "name": "github",
  "transport": "stdio",
  "auth_kind": "oauth",
  "tools_allowlist": ["create_pr", "read_issues"],
  "tools_denylist": []
}
```

`DELETE /api/v1/mcp/servers/{name}` removes the registration. Auth tokens never leave the credential vault (anti-pattern).

## Tool enumeration

`GET /api/v1/mcp/servers/{name}/tools` returns the LiteLLM `/v1/mcp/tools` rows filtered by the server's allowlist/denylist.

## Dispatch loop

1. Chat emits `tool_calls`.
2. `MCPService.dispatch_tool_call` honors `requires_approval`, `MCPAuthExpired`, and `MCPToolTimeout`.
3. On success, append `{role: tool, tool_call_id, content}` and continue.
4. Terminate on `finish_reason == stop | length`, or when `iter >= DEFAULT_MAX_ITERATIONS` (default 10).

## OAuth flow

```
UI → GET /api/v1/mcp/servers/{name}/auth/authorize → 302 to upstream
upstream → POST /{name}/token (code, state) → refresh_token stored encrypted
GET /api/v1/mcp/servers/{name}/auth/status → connected | expired | needs_reauth | not_connected
POST /api/v1/mcp/servers/{name}/auth/refresh → force refresh
```

## Public hub

`GET /api/v1/mcp/hub` (≤500ms; cache 60s) lists public MCP servers from `/public/mcp_hub`.

## Connection test

`POST /api/v1/mcp/servers/{name}/test` proxies to `/mcp-rest/test`. Unreachable servers return `{reachable: false}` (AC #7).

## Errors

- `MCPAuthExpired` (401) — `{server_id, reauth_url}`
- `MCPToolTimeout` (504) — `{server_id, tool_name, duration_ms}`