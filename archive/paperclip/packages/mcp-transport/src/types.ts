/**
 * @fora/mcp-transport — shared types
 *
 * The seam between the FORA MCP router (FORA-48 §3.1) and the stdio transport
 * (this package, FORA-48 §3.4 / FORA-447 / ADR-0011). The transport spawns one
 * child process per `(tenantId, serverName)` pair and reuses it across calls
 * until idle eviction kicks in.
 *
 * Conventions:
 *   - `PoolKey` is the canonical identity of a pooled child: one entry per
 *     tenant-scoped MCP server, scoped to the (tenant, server) tuple so
 *     per-tenant credentials / env stay isolated.
 *   - The transport speaks the standard MCP JSON-RPC stdio wire (Content-Length
 *     framed), so any MCP SDK `Server` that boots via `StdioServerTransport`
 *     plugs in unchanged (e.g. `@fora/mcp-jira`, `@fora/mcp-github`).
 *   - Stream responses opt in via the tool's `tags: ['stream']` marker (see
 *     `McpToolDescriptor`). The transport returns an `AsyncIterable<unknown>`
 *     of decoded JSON-RPC `notifications/message` frames.
 */

import type {
  McpRequestContext,
  ServerManifest,
  ServerName,
  TenantId,
  ToolName,
} from '@fora/mcp-router';

/**
 * Canonical pool key — one child process per `(tenantId, serverName)`.
 *
 * `tenantId` is part of the key even for `tenantScope: 'global'` servers so
 * per-tenant auth env (tokens, federated identities) stays isolated across
 * tenants. The pool size is bounded; idle eviction makes this affordable.
 */
export interface PoolKey {
  readonly tenantId: TenantId;
  readonly serverName: ServerName;
}

/** Default retry/backoff policy knobs. FORA-48 §3.4. */
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MIN_MS = 50;
export const DEFAULT_BACKOFF_MAX_MS = 2_000;
export const DEFAULT_BACKOFF_FACTOR = 4; // 50, 200, 800, capped at 2000

/** Default LRU pool knobs. FORA-48 §3.4. */
export const DEFAULT_POOL_MAX_SIZE = 32;
export const DEFAULT_IDLE_TTL_MS = 60_000; // 1 minute idle → evict

/** Default process / RPC knobs. */
export const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;
export const DEFAULT_SPAWN_TIMEOUT_MS = 5_000;

/**
 * Construct the canonical child bin path from a server name. The MCP servers
 * ship a `bin/fora-mcp-<name>.mjs` launcher (mirrored on the server package's
 * `bin` field, e.g. `bin/fora-mcp-jira.mjs`).
 *
 * If the manifest's `bin` field is set to an absolute path or alternative
 * launcher (e.g. `python`), the caller can override via `binPathForServer`.
 */
export const defaultBinPathForServer = (server: ServerName): string =>
  `bin/fora-mcp-${server}.mjs`;

/**
 * Result of a streaming tool call. The transport yields decoded JSON-RPC
 * `notifications/message` payloads — the server decides the shape.
 */
export interface StreamChunk {
  /** Monotonic index within the stream. */
  readonly seq: number;
  /** Decoded JSON payload from the MCP notification. */
  readonly payload: unknown;
}

/** Options for `StdioChildProcessTransport`. */
export interface StdioTransportOptions {
  /** Pool capacity. Default 32. */
  readonly poolMaxSize?: number;
  /** Idle TTL before eviction. Default 60s. */
  readonly idleTtlMs?: number;
  /** Per-invoke timeout. Default 30s. */
  readonly invokeTimeoutMs?: number;
  /** Per-spawn timeout (wait for `initialize` handshake). Default 5s. */
  readonly spawnTimeoutMs?: number;
  /** Max attempts (initial + retries). Default 3. */
  readonly maxAttempts?: number;
  /** Backoff floor in ms. Default 50. */
  readonly backoffMinMs?: number;
  /** Backoff ceiling in ms. Default 2_000. */
  readonly backoffMaxMs?: number;
  /** Backoff multiplier. Default 4 (50, 200, 800, 1600, 2000). */
  readonly backoffFactor?: number;
  /**
   * Inject clock for tests. Defaults to `Date.now`.
   * Returns ms since epoch.
   */
  readonly clock?: () => number;
  /**
   * Inject sleeper for tests. Defaults to `setTimeout`.
   */
  readonly sleeper?: (ms: number) => Promise<void>;
  /**
   * Override the bin path resolver. Defaults to
   * `bin/fora-mcp-<server>.mjs`.
   */
  readonly binPathForServer?: (server: ServerName) => string;
  /**
   * Resolve per-tenant env for a server. The transport forwards the returned
   * env to the spawned child. Default: `{}` (no extra env; the manifest's
   * `argv` is used as-is).
   *
   * Real deployments wire this to `@fora/customer-cloud-broker` (FORA-126) to
   * mint per-tenant credentials before spawn.
   */
  readonly envFor?: (
    manifest: ServerManifest,
    ctx: McpRequestContext,
  ) => Promise<Record<string, string>> | Record<string, string>;
}

/** Pool entry — one live child process + open MCP client. */
export interface PoolEntry {
  readonly key: PoolKey;
  /** Process start time (clock ms). */
  readonly spawnedAt: number;
  /** Last invocation timestamp (clock ms). */
  lastUsedAt: number;
  /** PID of the child. */
  pid: number;
  /** Server-defined manifest (cached for retry on the same pool entry). */
  readonly manifest: ServerManifest;
  /** Whether the entry is closed (child died). */
  closed: boolean;
}

/** Snapshot the pool exposes for tests / observability. */
export interface PoolSnapshot {
  readonly size: number;
  readonly capacity: number;
  readonly entries: ReadonlyArray<{
    readonly key: PoolKey;
    readonly pid: number;
    readonly spawnedAt: number;
    readonly lastUsedAt: number;
    readonly idleMs: number;
  }>;
}

/** Sentinel error codes — internal classification for retry + audit. */
export type TransportErrorKind =
  | 'spawn_failed'
  | 'spawn_timeout'
  | 'invoke_timeout'
  | 'child_died'
  | 'protocol_error'
  | 'tool_returned_error'
  | 'pool_exhausted'
  | 'non_retryable'
  | 'unknown';

/** Tagged error thrown by the transport. Callers should map to `McpError`. */
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly retryable: boolean;
  readonly server: ServerName;
  readonly tool?: ToolName;
  readonly cause?: unknown;

  constructor(
    kind: TransportErrorKind,
    message: string,
    opts: {
      retryable: boolean;
      server: ServerName;
      tool?: ToolName;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.retryable = opts.retryable;
    this.server = opts.server;
    if (opts.tool !== undefined) this.tool = opts.tool;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}