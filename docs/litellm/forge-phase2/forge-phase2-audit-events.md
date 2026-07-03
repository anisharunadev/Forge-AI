# Phase 2 Audit Events

> Every event written via `audit_service.record(...)` AND/OR `bus.publish(EventType.LITELLM_*)` in Phase 2.

## Guardrails

| Event | Payload |
|---|---|
| `forge.guardrails.registered` | `{guardrail_name, params}` |
| `forge.guardrails.updated` | `{guardrail_name, params}` |
| `forge.guardrails.deleted` | `{guardrail_name}` |
| `forge.guardrails.applied` | `{guardrail_name, kind, decision, latency_ms, request_id}` |
| `forge.guardrails.blocked` | `{guardrail_name, kind, reason, request_id, policy_id?}` |
| `forge.guardrails.masked` | `{guardrail_name, kind, request_id}` |
| `forge.guardrails.redacted` | `{guardrail_name, kind, request_id}` |

## Policies

| Event | Payload |
|---|---|
| `forge.policies.created` | `{policy_id, policy}` |
| `forge.policies.updated` | `{policy_id, policy}` |
| `forge.policies.archived` | `{policy_id}` |
| `forge.policies.status_changed` | `{policy_id, new_status}` |
| `forge.policies.resolved` | `{effective_policies[], effective_guardrails[], tool_policy, context}` |
| `forge.policies.compared` | `{left, right, result}` |

## MCP

| Event | Payload |
|---|---|
| `forge.mcp.server_registered` | `{server_id, name, transport, auth_kind}` |
| `forge.mcp.server_unregistered` | `{server_id, name}` |
| `forge.mcp.auth_refreshed` | `{server_name}` |
| `forge.mcp.auth_expired` | `{server_id}` |
| `forge.mcp.tool_called` | `{server_id, tool_name, duration_ms, status}` |

## Skills

| Event | Payload |
|---|---|
| `forge.skills.created` | `{skill_id, version}` |
| `forge.skills.updated` | `{skill_id, new_version}` |
| `forge.skills.archived` | `{skill_id}` |
| `forge.skills.injected` | `{skill_id, version}` |

## Tools

| Event | Payload |
|---|---|
| `forge.tools.invoked` | `{tool_name, kind, request_id, agent_id, duration_ms, status, decision}` |
| `forge.tools.overridden` | `{tool_name, overrides}` |
| `forge.tools.archived` | `{tool_name}` |

## Chat loop

| Event | Payload |
|---|---|
| `forge.chat.max_iterations` | `{iterations, max_iterations, agent_id}` |

## Conventions

- `target_type` per event: `litellm_guardrail | litellm_policy | litellm_mcp | litellm_skill | litellm_tool | chat_loop`.
- `actor_id` is the principal user_id (or null for system events).
- `project_id` is the project under the tenant; null for tenant-scoped events.
- Every audit row carries `tenant_id` (Rule 2).