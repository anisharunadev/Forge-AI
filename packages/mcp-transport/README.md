# @fora/mcp-transport

Forge AI MCP stdio transport — the `StdioChildProcessTransport` that plugs
into [`@fora/mcp-router`](../mcp-router) per Forge AI-48 §3.4 / ADR-0011.

## What it does

Spawns one child process per `(tenantId, serverName)` tuple, speaks the
MCP stdio wire protocol via `@modelcontextprotocol/sdk`, reuses the child
across calls, evicts on idle TTL or pool size cap, and retries transient
failures with exponential backoff.

| Knob | Default | Purpose |
| --- | --- | --- |
| `poolMaxSize` | `32` | LRU pool capacity |
| `idleTtlMs` | `60_000` | Idle eviction TTL |
| `invokeTimeoutMs` | `30_000` | Per-invoke timeout |
| `spawnTimeoutMs` | `5_000` | Per-spawn (handshake) timeout |
| `maxAttempts` | `3` | 1 initial + N retries |
| `backoffMinMs` | `50` | Backoff floor |
| `backoffMaxMs` | `2_000` | Backoff ceiling |
| `backoffFactor` | `4` | Schedule: 50 → 200 → 800 → 2000 (capped) |

The schedule is per the spec: retryable failures (spawn_failed,
invoke_timeout, child_died, pool_exhausted) are retried with exponential
backoff. Non-retryable failures (protocol_error, tool_returned_error,
unknown) bubble immediately. Mutations without an `idempotency_key` are
**never** retried — re-issuing a write that may have partially succeeded
is unsafe.

## Wire format

The transport uses the `@modelcontextprotocol/sdk` `StdioClientTransport`
under the hood, which speaks **newline-delimited JSON-RPC 2.0**
(`JSON.stringify(msg) + '\n'`). It is NOT LSP-style Content-Length
framing (despite what older MCP docs may say). Any MCP SDK-compliant
server (`StdioServerTransport`) plugs in unchanged.

## Public API

```ts
import {
  StdioChildProcessTransport,
  TransportError,
  type ServerManifest,
  type McpRequestContext,
} from '@fora/mcp-transport';
```

```ts
const transport = new StdioChildProcessTransport({
  envFor: async (manifest, ctx) => {
    // Mint per-tenant credentials. Returned values are injected into
    // the child's environment.
    return { Forge AI_CREDENTIAL: JSON.stringify(await mintCredential(manifest, ctx)) };
  },
});

const result = await transport.invoke(server, tool, args, ctx);
const stream = await transport.invokeStream(server, tool, args, ctx);
for await (const chunk of stream) {
  // chunk.seq is monotonic, chunk.payload is the notification's `data`
}

const health = await transport.health(server); // 'healthy' | 'degraded' | 'unknown'
const snap = transport.snapshot();              // for tests + observability
await transport.close();                        // kill every child
```

## Envs forwarded to the child

| Env var | Source | Notes |
| --- | --- | --- |
| `Forge AI_TENANT_ID` | `ctx.tenant_id` | always set |
| `Forge AI_SERVER_NAME` | `manifest.name` | always set |
| `Forge AI_ACTOR` | `ctx.actor` | when present |
| `Forge AI_TRACE_ID` | `ctx.trace_id` | when present |
| `Forge AI_CREDENTIAL` | `ctx.credential` | when present, JSON-encoded |
| (custom) | `envFor(manifest, ctx)` | whatever the resolver returns |

The transport only forwards the whitelisted `Forge AI_*` vars and whatever
`envFor` returns; the rest of `process.env` is intentionally **not**
inherited. Use `envFor` to mint and inject per-tenant credentials.

## Streaming tools

Tools opt into streaming via the `tags: ['stream']` (or `'streaming'`)
marker on the `McpToolDescriptor`. The transport sends the call with
`_meta.stream: true` and yields decoded `notifications/message` payloads
as `StreamChunk`s.

## Acceptance

`pnpm --filter @fora/mcp-transport test` must be green. Tests cover:

- `retry` — backoff schedule, retry/no-retry classification,
  `runWithRetry` semantics, error classification, idempotency-key
  extraction, mutation/streaming tag detection.
- `frame_io` — Content-Length framed JSON-RPC read/write round-trip
  (provided for non-SDK interop; the production transport does NOT go
  through this module).
- `stdio_transport` — end-to-end with the in-repo fake fixture
  (`test/fixtures/fake-mcp-server.mjs`): happy path, tool-returned
  `isError`, child-died retry with fresh spawn, mutation+idempotency
  retry, streaming, LRU eviction, per-tenant pool isolation, health
  probe.

A standalone manual smoke is also shipped: `pnpm --filter
@fora/mcp-transport smoke` (after `pnpm build`) exercises invoke /
retry / streaming / health / LRU end-to-end against the same fixture.

## See also

- Plan: [Forge AI-48 §3.4](/Forge AI/issues/Forge AI-48#document-plan)
- ADR: ADR-0011 (stdio transport)
- Sub-goal: [Forge AI-447](/Forge AI/issues/Forge AI-447)
- Sibling: [@fora/mcp-router](../mcp-router) — port + in-memory router
- Sibling: [@fora/mcp-jira](../mcp-jira) — Jira MCP (drop-in server)
