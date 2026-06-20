# `@fora/mcp-router`

Typed `McpRouter` port + `InMemoryMcpRouter` reference implementation for the FORA MCP framework (sub-goal **0.3 / FORA-48 §3.1**). Lands via **FORA-444**.

## Public surface

```ts
import {
  InMemoryMcpRouter,
  InMemoryAuditSink,
  ScriptedTransport,
  asServerName,
  asTenantId,
  asToolName,
  type McpRouter,
  type McpRequestContext,
  type ServerManifest,
} from '@fora/mcp-router';
```

The package exports:

| Symbol                  | Kind     | Purpose                                                                       |
| ----------------------- | -------- | ----------------------------------------------------------------------------- |
| `McpRouter`             | interface | The typed port (resolve / invoke / listServers / registerServer).           |
| `McpError`              | union    | Discriminated failure envelope (`unavailable \| scope_denied \| tool_not_found \| args_invalid \| upstream_error \| circuit_open`). |
| `ServerManifest`        | type     | Canonical registration record (name, bin, tenantScope, tools, healthcheck).   |
| `InMemoryMcpRouter`     | class    | Pure-logic reference implementation; pluggable transport + audit sink.        |
| `ScriptedTransport`     | class    | Test double — feeds canned responses / errors.                                |
| `InMemoryAuditSink`     | class    | Captures `mcp.*` audit events for assertions.                                 |
| `defaultAuditSink`      | function | `NullAuditSink` factory; wire JSONL or FORA-36 in prod.                       |

## Usage

```ts
const audit = new InMemoryAuditSink();
const router = new InMemoryMcpRouter({ audit });

await router.registerServer({
  name: asServerName('secrets'),
  bin: 'node',
  argv: ['secrets.js'],
  tenantScope: 'global',
  tools: [
    {
      name: asToolName('get'),
      label: 'Get Secret',
      description: 'Fetch a secret by key',
      input_schema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
    },
  ],
});

const ctx: McpRequestContext = {
  tenant_id: asTenantId('tnt_8XQ'),
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: '01HXYZTRACE',
};

const result = await router.invoke(ctx, asServerName('secrets'), asToolName('get'), { key: 'API_KEY' });

if (result.status === 'ok') {
  console.log(result.result);
} else {
  switch (result.error.kind) {
    case 'scope_denied': /* forbidden */ break;
    case 'tool_not_found': /* missing */ break;
    case 'circuit_open': /* back off + retry */ break;
    case 'upstream_error': /* bubble */ break;
    // …
  }
}
```

## Contract

- **Tenant scope gate.** `tenantScope: 'global'` is visible to any caller; `'tenant'` requires the caller's `tenant_id` to match `manifest.tenantId`; `'agent'` additionally requires `manifest.agentType === ctx.agent_type`. Mismatches surface as `scope_denied`.
- **Errors are data.** Every failure path returns a `McpErrorEnvelope`; the router never throws on a contract error. Programmer errors (invalid manifest) do throw.
- **Circuit breaker.** Per-server breaker opens after N consecutive `upstream_error` failures (default 5) and short-circuits subsequent calls with `circuit_open` for a cooldown window (default 30 s). A success resets the failure count; a cooldown elapse half-opens the breaker and lets the next call through.
- **Audit emit.** Every resolve / invoke / register emits one `mcp.*` event with `tenant_id`, `actor`, `server`, optional `tool`, `outcome`, `latency_ms`, and `trace_id`. Emits are best-effort.

## Tests

```bash
pnpm --filter @fora/mcp-router test
pnpm --filter @fora/mcp-router test:coverage   # ≥ 80% lines
pnpm --filter @fora/mcp-router typecheck
```

Coverage targets (vitest v8):

- `lines` ≥ 80
- `functions` ≥ 80
- `branches` ≥ 75
- `statements` ≥ 80

## References

- FORA-48 §3.1 — v0.1 plan (parent epic).
- FORA-444 — this sub-goal (port + result/error types).
- `@fora/cache-broker` — sibling package; same `RequestContext` shape.