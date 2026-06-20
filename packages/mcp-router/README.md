# `@fora/mcp-router`

Typed `McpRouter` port + `InMemoryMcpRouter` reference implementation for the Forge AI MCP framework (sub-goal **0.3 / Forge AI-48 §3.1**). Lands via **Forge AI-444**.

## Acceptance harness (v0.3.7)

Single-file end-to-end harness that exercises every FORA-48 AC against the
shipped 0.3 surface (`@fora/mcp-schemas` 0.1.0, `@fora/mcp-breaker` 0.1.0,
`@fora/mcp-transport` 0.1.0, `@fora/mcp-router` 0.3.6, `@fora/mcp-jira` 0.3.6).
Closes the FORA-48 epic via **FORA-450**.

```bash
pnpm --filter @fora/mcp-router test:acceptance:router
```

Harness: `packages/mcp-router/test/acceptance.test.ts` (single vitest file).

| AC | Scenario | Test |
| -- | -------- | ---- |
| #1 | register fixture in <10 lines + immediate allow-list visibility | `AC #1 — register fixture in <10 lines + immediate allow-list visibility` |
| #2 | failing fixture trips breaker → `circuit_open` typed error in ≤50ms | `AC #2 — failing fixture trips breaker → circuit_open typed error in ≤50ms` |
| #3 | tenant A vs tenant B cross-tenant isolation (no transport leak) | `AC #3 — tenant A vs tenant B cross-tenant isolation (no transport leak)` |
| #4 | Jira MCP dropped in via router, smoke unchanged | `AC #4 — Jira MCP dropped in via the router port; mcp-jira smoke body unchanged` |

Acceptance:

- `pnpm --filter @fora/mcp-router test:acceptance:router` — 4/4 AC scenarios green.
- `pnpm --filter @fora/mcp-router typecheck` — clean.
- `pnpm --filter @fora/mcp-router test` — pre-existing 215+ tests still green (no regression in `router.test.ts` / `scope_guard.test.ts` / `scope_guard_e2e.test.ts`).
- `pnpm --filter @fora/mcp-jira test` — still 5/5 green (FORA-449 contract preserved).
- `pnpm --filter @fora/mcp-jira smoke` — `mcp-servers/jira/test/smoke.mjs` unchanged, still passes ("all 6 tools smoke-tested green").
- Total harness runtime ≤2s (AC #2 alone has a 50ms budget; full file is comfortably under 2s).

Cross-links:

- Sibling deliverables: FORA-445 (`@fora/mcp-schemas` 0.1.0), FORA-446 (`@fora/mcp-breaker` 0.1.0), FORA-447 (`@fora/mcp-transport` 0.1.0), FORA-448 (`@fora/mcp-router` 0.3.6 scope-guard), FORA-449 (`@fora/mcp-jira` 0.3.6 + router-port smoke).
- Jira router-port smoke (parallel AC #4 cross-check): `mcp-servers/jira/test/router-smoke.test.ts`.
- FORA-48 (parent epic) and FORA-450 (this acceptance harness).

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
| `defaultAuditSink`      | function | `NullAuditSink` factory; wire JSONL or Forge AI-36 in prod.                       |

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

- Forge AI-48 §3.1 — v0.1 plan (parent epic).
- Forge AI-444 — this sub-goal (port + result/error types).
- `@fora/cache-broker` — sibling package; same `RequestContext` shape.