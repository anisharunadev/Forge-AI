/**
 * @fora/mcp-router — types
 *
 * The typed shape of an MCP server, its tool descriptors, the request envelope
 * the router binds to every invocation, and the success/failure result unions.
 *
 * Conventions:
 *   - `tenantScope` is the canonical tenancy matrix cell an MCP server occupies
 *     per FORA-48 §3.1; the router refuses any cross-scope resolve/invoke.
 *   - `args` is intentionally `Record<string, unknown>` at the boundary; the
 *     router does NOT validate arg shape — that's the tool's own responsibility
 *     (the broker should reject `args_invalid` upstream via a JSON Schema, but
 *     the contract here is "unknown because we haven't validated yet").
 *   - All identifiers are branded strings; we never accept a raw `string` from
 *     the caller when a typed id is expected.
 */

/** Tenant id; opaque, branded. */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** MCP server name; opaque, branded. Matches `ServerManifest.name`. */
export type ServerName = string & { readonly __brand: 'ServerName' };

/** Tool name inside an MCP server; opaque, branded. Matches `McpToolDescriptor.name`. */
export type ToolName = string & { readonly __brand: 'ToolName' };

/** A free-form tool argument map. Shape validation is the tool's job. */
export type McpArgs = Readonly<Record<string, unknown>>;

/**
 * Tenant scope a server can occupy. Mirrors the canonical matrix in
 * `docs/architecture/tenancy-matrix.md` (FORA-48 §3.1, "scope" column):
 *   - `global`    — shared platform server (e.g. secrets, audit forwarder).
 *   - `tenant`    — single-tenant server, bound to one `TenantId` at register time.
 *   - `agent`     — agent-local server, scoped to a (tenant, agent-type) pair.
 */
export type TenantScope = 'global' | 'tenant' | 'agent';

/** Healthcheck strategy; matches the `healthcheck` block in ServerManifest. */
export type Healthcheck =
  | { readonly kind: 'none' }
  | { readonly kind: 'command'; readonly argv: readonly string[]; readonly timeout_ms: number }
  | { readonly kind: 'http'; readonly url: string; readonly timeout_ms: number };

/** One tool a server exposes. The router uses `name` as the lookup key. */
export interface McpToolDescriptor {
  /** Tool name. Unique within a server. Branded `ToolName`. */
  readonly name: ToolName;
  /** Human-readable label, surfaced in `listServers`. */
  readonly label: string;
  /** Short description (one sentence). */
  readonly description: string;
  /** JSON Schema for `args`. The router does NOT enforce it; the tool does. */
  readonly input_schema: Readonly<Record<string, unknown>>;
  /** Tags used by `resolve` (e.g. `read`, `write`, `mutation`). */
  readonly tags?: readonly string[];
}

/**
 * ServerManifest — the canonical registration record. Returned by `listServers`
 * and embedded in audit events.
 */
export interface ServerManifest {
  /** Server name. Branded `ServerName`. */
  readonly name: ServerName;
  /** Executable to spawn, e.g. `node`, `python`, `/usr/local/bin/mcp-foo`. */
  readonly bin: string;
  /** CLI args appended after `bin`. */
  readonly argv?: readonly string[];
  /** Scope the server occupies. */
  readonly tenantScope: TenantScope;
  /** Tenant id when `tenantScope === 'tenant'` or `'agent'`; ignored otherwise. */
  readonly tenantId?: TenantId;
  /** Agent type when `tenantScope === 'agent'`; ignored otherwise. */
  readonly agentType?: string;
  /** Tools the server exposes. */
  readonly tools: readonly McpToolDescriptor[];
  /** Healthcheck strategy. Default `{ kind: 'none' }` if omitted. */
  readonly healthcheck?: Healthcheck;
}

/**
 * Request envelope. Mirrors `@fora/cache-broker`'s `RequestContext` so the
 * router can be slotted into the same tenancy matrix.
 */
export interface McpRequestContext {
  /** Verified claim. Tenant the caller is bound to. */
  readonly tenant_id: TenantId;
  /** Caller class. */
  readonly principal: 'board_user' | 'agent' | 'cloud_operator';
  /** Actor string (e.g. `agent:developer:run-001`). */
  readonly actor: string;
  /** OTel trace id when available. */
  readonly trace_id?: string;
  /** Agent type when the caller is an agent. */
  readonly agent_type?: string;
}

/** Successful invocation result. */
export interface McpInvocationSuccess {
  readonly status: 'ok';
  /** Result payload from the MCP server. */
  readonly result: unknown;
  /** Latency in ms. */
  readonly latency_ms: number;
  /** Server name that handled the call (always set on `ok`). */
  readonly server: ServerName;
  /** Tool name that was invoked (always set on `ok`). */
  readonly tool: ToolName;
}

/** Discriminated failure result. See `errors.ts` for the union members. */
export type McpInvocationError = {
  readonly status: 'error';
  readonly error: import('./errors.js').McpError;
};

/** Wire result type — every `invoke` returns one of these. */
export type McpInvocationResult = McpInvocationSuccess | McpInvocationError;

/** Resolved server record (manifest + liveness signal). Returned by `resolve`. */
export interface McpResolution {
  readonly status: 'resolved';
  readonly manifest: ServerManifest;
  readonly health: 'healthy' | 'degraded' | 'unknown';
}

export type McpResolutionResult = McpResolution | McpInvocationError;

/** Audit event emitted on every resolve/invoke. */
export interface McpAuditEvent {
  readonly kind: 'mcp.resolve' | 'mcp.invoke' | 'mcp.register' | 'mcp.deny';
  readonly tenant_id: TenantId;
  readonly actor: string;
  readonly server: ServerName;
  readonly tool?: ToolName;
  readonly outcome: 'ok' | McpErrorKind;
  readonly latency_ms?: number;
  readonly trace_id?: string;
  readonly at: string; // ISO 8601
}

/** Subset of `McpError` shape used in audit events. */
export type McpErrorKind =
  | 'unavailable'
  | 'scope_denied'
  | 'tool_not_found'
  | 'args_invalid'
  | 'upstream_error'
  | 'circuit_open';

/**
 * The typed port. Implementations must be deterministic; a fresh
 * `InMemoryMcpRouter` must not leak state between tests.
 */
export interface McpRouter {
  /**
   * Resolve a (server, tool) pair to its manifest + health. Used by callers
   * who want to surface a tool palette before invoking.
   *
   * `toolName` may be omitted to resolve just the server.
   */
  resolve(
    ctx: McpRequestContext,
    server: ServerName,
    toolName?: ToolName,
  ): Promise<McpResolutionResult>;

  /**
   * Invoke a tool on a server. Returns a discriminated result — callers MUST
   * switch on `status` and treat errors as first-class data (never throw).
   */
  invoke(
    ctx: McpRequestContext,
    server: ServerName,
    tool: ToolName,
    args: McpArgs,
  ): Promise<McpInvocationResult>;

  /** List all manifests the caller is allowed to see (scope-filtered). */
  listServers(ctx: McpRequestContext): Promise<readonly ServerManifest[]>;

  /**
   * Register a server. Idempotent on `server` name within a scope; the second
   * call overwrites. Rejected with `scope_denied` if `ctx` cannot register
   * in the target scope.
   */
  registerServer(manifest: ServerManifest): Promise<McpInvocationResult>;
}

// --- Re-exports / helpers -----------------------------------------------

/** Cast a string to `TenantId`. The router MUST verify, but the seam is convenient for tests. */
export const asTenantId = (s: string): TenantId => s as TenantId;
/** Cast a string to `ServerName`. */
export const asServerName = (s: string): ServerName => s as ServerName;
/** Cast a string to `ToolName`. */
export const asToolName = (s: string): ToolName => s as ToolName;