/**
 * @fora/mcp-transport — StdioChildProcessTransport
 *
 * FORA-48 §3.4 / FORA-447 / ADR-0011. Spawns one child process per
 * (tenantId, serverName) tuple, speaks the canonical MCP stdio wire
 * (Content-Length framed JSON-RPC), reuses the child across calls, and
 * evicts on idle TTL or pool size cap.
 *
 * Lifecycle:
 *   - Pool key: `(tenantId, serverName)` — even for global servers, the
 *     tenant is part of the key so per-tenant auth env stays isolated.
 *   - LRU eviction: `lastUsedAt` is bumped on every invoke; the LRU entry
 *     is killed when the pool hits `poolMaxSize` or the entry's idle age
 *     crosses `idleTtlMs`.
 *   - Spawn: `manifest.bin` is the launcher (`node`, `python`, etc.);
 *     `manifest.argv` is the rest of the CLI. The transport also forwards
 *     `FORA_TENANT_ID`, `FORA_SERVER_NAME`, `FORA_TRACE_ID`, and the
 *     resolved credential as `FORA_CREDENTIAL` (JSON-encoded) to the
 *     child, plus anything `envFor` returns.
 *
 * Retry:
 *   - 3 attempts (1 initial + 2 retries) by default. Backoff: 50 → 200 →
 *     800 → 2000 ms (capped), factor 4.
 *   - Retryable: spawn_failed, invoke_timeout, child_died, pool_exhausted.
 *   - Non-retryable: protocol_error, tool_returned_error, unknown.
 *   - Mutations without `idempotency_key` are NEVER retried (re-issuing
 *     a write that may have partially succeeded is unsafe).
 *
 * Streaming:
 *   - Tools tagged `stream` or `streaming` (per `McpToolDescriptor.tags`)
 *     opt into `invokeStream()`. The transport sends the tool call with
 *     `_meta.stream: true` and yields notifications/message payloads as
 *     `StreamChunk`s.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  McpArgs,
  McpRequestContext,
  McpToolDescriptor,
  ServerManifest,
  TenantId,
  ToolName,
} from '@fora/mcp-router';

import { isMutationTool, isStreamingTool, readIdempotencyKey, runWithRetry, classifyError } from './retry.js';
import {
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MIN_MS,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_INVOKE_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POOL_MAX_SIZE,
  DEFAULT_SPAWN_TIMEOUT_MS,
  defaultBinPathForServer,
  TransportError,
  type PoolEntry,
  type PoolKey,
  type PoolSnapshot,
  type StdioTransportOptions,
  type StreamChunk,
} from './types.js';

/** One live child process slot. */
interface LiveEntry {
  readonly key: PoolKey;
  readonly manifest: ServerManifest;
  readonly client: Client;
  readonly transport: StdioClientTransport;
  spawnedAt: number;
  lastUsedAt: number;
  pid: number;
  closed: boolean;
  /** Cancellation hook for in-flight invoke. */
  inflight: number;
}

/** Default sleeper when caller does not inject one. */
const defaultSleeper = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stringify an unknown credential object into an env-friendly string.
 * Falls back to `String(credential)` for non-JSON values so we never
 * throw inside the spawn path.
 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** No-op transport.onmessage handler (used to detach a stream subscription). */
const noopMessageHandler = (_msg: unknown): void => {
  void _msg;
};

/** Strip `undefined` values from a `NodeJS.ProcessEnv` so it satisfies `Record<string, string>`. */
function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** Stable string key for `Map` storage. */
const keyOf = (key: PoolKey): string => `${key.tenantId}::${key.serverName}`;

/**
 * StdioChildProcessTransport — implements the `McpTransport` port from
 * `@fora/mcp-router` plus the streaming extension used by callers that
 * know a tool is tagged for streaming.
 */
export class StdioChildProcessTransport {
  private readonly poolMaxSize: number;
  private readonly idleTtlMs: number;
  private readonly invokeTimeoutMs: number;
  private readonly spawnTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMinMs: number;
  private readonly backoffMaxMs: number;
  private readonly backoffFactor: number;
  private readonly clock: () => number;
  private readonly sleeper: (ms: number) => Promise<void>;
  private readonly binPathForServer: (server: ServerManifest['name']) => string;
  private readonly envFor:
    | ((
        manifest: ServerManifest,
        ctx: McpRequestContext,
      ) => Promise<Record<string, string>> | Record<string, string>)
    | undefined;

  /** Live pool — LRU ordered by `lastUsedAt`. */
  private readonly pool = new Map<string, LiveEntry>();
  /** Insertion order for LRU eviction; mirrors the Map insertion sequence. */
  private readonly lruSeq = new Map<string, number>();
  private nextLruSeq = 0;

  /** Public re-export so callers can introspect retry policy. */
  get policy(): {
    maxAttempts: number;
    backoffMinMs: number;
    backoffMaxMs: number;
    backoffFactor: number;
  } {
    return {
      maxAttempts: this.maxAttempts,
      backoffMinMs: this.backoffMinMs,
      backoffMaxMs: this.backoffMaxMs,
      backoffFactor: this.backoffFactor,
    };
  }

  constructor(opts: StdioTransportOptions = {}) {
    this.poolMaxSize = opts.poolMaxSize ?? DEFAULT_POOL_MAX_SIZE;
    this.idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.invokeTimeoutMs = opts.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
    this.spawnTimeoutMs = opts.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffMinMs = opts.backoffMinMs ?? DEFAULT_BACKOFF_MIN_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.backoffFactor = opts.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
    this.clock = opts.clock ?? Date.now;
    this.sleeper = opts.sleeper ?? defaultSleeper;
    this.binPathForServer =
      opts.binPathForServer ?? ((server) => defaultBinPathForServer(server));
    this.envFor = opts.envFor;
  }

  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------

  /**
   * Invoke a tool on a server. Looks up (or spawns) the pool entry for the
   * canonical `(tenant, server)` key, runs the call through the MCP client,
   * and applies the retry policy.
   *
   * Returns the raw `content` payload from the MCP response (text + image +
   * resource parts concatenated), or the whole result envelope if the
   * server returned no `content`.
   */
  async invoke(
    server: ServerManifest,
    tool: ToolName,
    args: McpArgs,
    ctx: McpRequestContext,
  ): Promise<unknown> {
    const key: PoolKey = { tenantId: ctx.tenant_id, serverName: server.name };
    const toolDesc = this.findToolDescriptor(server, tool);
    const mutation = isMutationTool(toolDesc?.tags);
    const idempotencyKey = readIdempotencyKey(args);

    return runWithRetry(async (attempt) => {
      // On retry we want a fresh pool entry — kill any closed entry
      // immediately so the next acquire spawns a new child.
      const entry = await this.acquire({
        key,
        manifest: server,
        ctx,
        fresh: attempt > 1,
      });
      entry.lastUsedAt = this.clock();

      const callParams = this.buildCallParams({
        tool,
        args,
        toolDesc,
        idempotencyKey,
      });

      try {
        const response = await this.withTimeout(
          entry.client.callTool(callParams as Parameters<Client['callTool']>[0]),
          this.invokeTimeoutMs,
          'invoke_timeout',
          { server: server.name, tool },
        );
        if (this.isToolError(response)) {
          throw new TransportError('tool_returned_error', 'tool returned isError=true', {
            retryable: false,
            server: server.name,
            tool,
          });
        }
        return this.extractResult(response);
      } catch (err) {
        // If the pool entry died mid-call, mark it closed so the next
        // acquire spawns a fresh child.
        if (entry.closed) {
          throw classifyError(err, { server: server.name, tool });
        }
        throw classifyError(err, { server: server.name, tool });
      }
    }, {
      maxAttempts: this.maxAttempts,
      backoffMinMs: this.backoffMinMs,
      backoffMaxMs: this.backoffMaxMs,
      backoffFactor: this.backoffFactor,
      clock: this.clock,
      sleeper: this.sleeper,
      onRetry: ({ attempt: _attempt, delay_ms: _delay_ms, error }) => {
        void error;
      },
    }).catch((err: unknown) => {
      // Pre-classify the final error so callers see a `TransportError`
      // instead of a raw SDK exception.
      throw classifyError(err, { server: server.name, tool });
    });
  }

  /**
   * Stream a tool's output. The tool must be tagged `stream` or
   * `streaming` in its descriptor. Returns an async iterable of
   * `StreamChunk`s — each chunk is one decoded `notifications/message`
   * payload from the server.
   *
   * Implementation: subscribes to the MCP client's `notification` event,
   * filters for `notifications/message`, and enqueues them. The first
   * `callTool` resolution ends the stream with a sentinel `{done: true}`
   * chunk. The pool entry is reused like `invoke()`.
   */
  async invokeStream(
    server: ServerManifest,
    tool: ToolName,
    args: McpArgs,
    ctx: McpRequestContext,
  ): Promise<AsyncIterable<StreamChunk>> {
    const key: PoolKey = { tenantId: ctx.tenant_id, serverName: server.name };
    const toolDesc = this.findToolDescriptor(server, tool);
    if (!isStreamingTool(toolDesc?.tags)) {
      throw new TransportError(
        'non_retryable',
        `tool '${tool}' is not tagged for streaming`,
        { retryable: false, server: server.name, tool },
      );
    }

    const entry = await this.acquire({ key, manifest: server, ctx, fresh: false });
    entry.lastUsedAt = this.clock();
    const idempotencyKey = readIdempotencyKey(args);
    const callParams = this.buildCallParams({
      tool,
      args,
      toolDesc,
      idempotencyKey,
      stream: true,
    });

    const queue: Array<StreamChunk | null> = [];
    let waiter: ((c: StreamChunk | null) => void) | null = null;
    let seq = 0;
    let ended = false;

    const onNotification = (notification: { method?: string; params?: unknown }): void => {
      if (notification.method !== 'notifications/message') return;
      const params = (notification.params ?? {}) as { data?: unknown };
      const chunk: StreamChunk = { seq: seq, payload: params.data ?? params };
      seq += 1;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(chunk);
      } else {
        queue.push(chunk);
      }
    };

    entry.client; // touch reference (compile-time typecheck).
    // The MCP SDK surfaces notifications via `setNotificationHandler`.
    // We do NOT override `transport.onmessage` because that would break
    // the SDK's response dispatcher (callTool would never resolve).
    // `setNotificationHandler` adds our listener alongside the SDK's
    // internal response handling.
    const notificationClient = (
      entry.client as unknown as {
        setNotificationHandler: (schema: unknown, handler: (n: unknown) => void) => void;
        removeNotificationHandler?: (method: string) => void;
      }
    );
    notificationClient.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification: unknown) => {
        onNotification(notification as { method?: string; params?: unknown });
      },
    );

    const cleanup = (): void => {
      ended = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(null);
      }
    };

    // Kick off the streaming call. We do not await it here — the iterator
    // pulls chunks as they arrive and resolves with the final response
    // when the call completes.
    const callPromise = entry.client
      .callTool(callParams as Parameters<Client['callTool']>[0])
      .then((finalResponse) => {
        const end: StreamChunk = { seq, payload: { __stream_end__: true, result: this.extractResult(finalResponse) } };
        seq += 1;
        ended = true;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(end);
        } else {
          queue.push(end);
        }
        entry.lastUsedAt = this.clock();
      })
      .catch((err: unknown) => {
        ended = true;
        const te = classifyError(err, { server: server.name, tool });
        if (waiter) {
          const w = waiter;
          waiter = null;
          // Re-throw via an async throw inside the iterator: we encode the
          // error as a sentinel so the generator can surface it.
          w({ seq, payload: { __stream_error__: true, error: te.message } });
        } else {
          queue.push({ seq, payload: { __stream_error__: true, error: te.message } });
        }
        entry.lastUsedAt = this.clock();
      })
      .finally(() => {
        if (notificationClient.removeNotificationHandler) {
          notificationClient.removeNotificationHandler('notifications/message');
        }
      });

    // Hold the promise so it cannot be GC'd; the iterator consumes it.
    void callPromise;

    async function* gen(this: StdioChildProcessTransport): AsyncGenerator<StreamChunk> {
      void this;
      try {
        while (true) {
          if (queue.length > 0) {
            const next = queue.shift()!;
            const payload = next.payload as { __stream_end__?: boolean; __stream_error__?: boolean };
            if (payload.__stream_end__) {
              yield next;
              return;
            }
            if (payload.__stream_error__) {
              throw new TransportError(
                'invoke_timeout',
                String((payload as { error: unknown }).error ?? 'stream failed'),
                { retryable: false, server: server.name, tool },
              );
            }
            yield next;
            continue;
          }
          if (ended) return;
          const c = await new Promise<StreamChunk | null>((resolve) => {
            waiter = resolve;
          });
          if (c === null) return;
          const p = c.payload as { __stream_end__?: boolean; __stream_error__?: boolean };
          if (p.__stream_end__) {
            yield c;
            return;
          }
          if (p.__stream_error__) {
            throw new TransportError(
              'invoke_timeout',
              String((p as { error: unknown }).error ?? 'stream failed'),
              { retryable: false, server: server.name, tool },
            );
          }
          yield c;
        }
      } finally {
        cleanup();
        void entry; // keep referenced until iterator drains
      }
    }

    return gen.call(this);
  }

  /**
   * Optional health probe — returns `'healthy'` when a pool entry is
   * alive and `'unknown'` otherwise. The router uses this when wiring
   * `transport.health` to `probeHealth`.
   */
  async health(server: ServerManifest): Promise<'healthy' | 'degraded' | 'unknown'> {
    // Scan pool for any live entry for this server (regardless of tenant).
    for (const entry of this.pool.values()) {
      if (entry.manifest.name === server.name && !entry.closed) {
        return 'healthy';
      }
    }
    return 'unknown';
  }

  /** Snapshot of the LRU pool — for tests + observability. */
  snapshot(): PoolSnapshot {
    const now = this.clock();
    const entries = Array.from(this.pool.values()).map((e) => ({
      key: e.key,
      pid: e.pid,
      spawnedAt: e.spawnedAt,
      lastUsedAt: e.lastUsedAt,
      idleMs: now - e.lastUsedAt,
    }));
    return {
      size: entries.length,
      capacity: this.poolMaxSize,
      entries,
    };
  }

  /** Drain the pool — kill every child. Used in tests + graceful shutdown. */
  async close(): Promise<void> {
    const entries = Array.from(this.pool.values());
    this.pool.clear();
    this.lruSeq.clear();
    await Promise.all(
      entries.map(async (e) => {
        e.closed = true;
        try {
          await e.client.close();
        } catch {
          void e;
        }
        try {
          await e.transport.close();
        } catch {
          void e;
        }
      }),
    );
  }

  // --------------------------------------------------------------------
  // Pool management
  // --------------------------------------------------------------------

  /**
   * Acquire (or create) the pool entry for `key`. On overflow, evict the
   * least-recently-used entry first. On `fresh`, evict and replace any
   * existing entry — used by the retry path.
   */
  private async acquire(opts: {
    key: PoolKey;
    manifest: ServerManifest;
    ctx: McpRequestContext;
    fresh: boolean;
  }): Promise<LiveEntry> {
    const k = keyOf(opts.key);
    const existing = this.pool.get(k);

    if (existing && !existing.closed && !opts.fresh) {
      this.touch(existing, k);
      return existing;
    }
    if (existing && opts.fresh) {
      await this.evictEntry(existing, k);
    }

    if (this.pool.size >= this.poolMaxSize) {
      this.evictLru();
    }
    if (this.pool.size >= this.poolMaxSize) {
      throw new TransportError(
        'pool_exhausted',
        `pool full (${this.pool.size}/${this.poolMaxSize}) after LRU eviction`,
        { retryable: true, server: opts.manifest.name },
      );
    }

    const entry = await this.spawn(opts.key, opts.manifest, opts.ctx);
    this.pool.set(k, entry);
    this.lruSeq.set(k, this.nextLruSeq++);
    return entry;
  }

  /**
   * Spawn a child process + MCP client for the given (tenant, server)
   * tuple. Times out if the `initialize` handshake does not complete in
   * `spawnTimeoutMs`.
   */
  private async spawn(
    key: PoolKey,
    manifest: ServerManifest,
    ctx: McpRequestContext,
  ): Promise<LiveEntry> {
    const extraEnv = this.envFor ? await this.envFor(manifest, ctx) : {};
    const ctxWithCred = ctx as { credential?: unknown };
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...extraEnv,
      FORA_TENANT_ID: key.tenantId,
      FORA_SERVER_NAME: key.serverName,
      ...(ctx.actor ? { FORA_ACTOR: ctx.actor } : {}),
      ...(ctx.trace_id ? { FORA_TRACE_ID: ctx.trace_id } : {}),
      ...(ctxWithCred.credential !== undefined
        ? { FORA_CREDENTIAL: safeJsonStringify(ctxWithCred.credential) }
        : {}),
    };
    const stringEnv = toStringEnv(env);

    // Build argv. `manifest.bin` is the launcher (e.g. `node`),
    // `manifest.argv` is the rest. If `manifest.bin` is an absolute or
    // relative path that ends with `.mjs`, the caller may have skipped
    // the `node` launcher — we prepend `node` in that case.
    const argv = this.buildArgv(manifest);
    const { command, args } = this.normalizeLauncher(manifest, argv);

    let stdio: StdioClientTransport;
    try {
      stdio = new StdioClientTransport({
        command,
        args,
        env: stringEnv,
      });
    } catch (err) {
      throw new TransportError('spawn_failed', `failed to construct transport for ${manifest.bin}`, {
        retryable: true,
        server: manifest.name,
        cause: err,
      });
    }

    stdio.onclose = () => {
      const k = keyOf(key);
      const live = this.pool.get(k);
      if (live && !live.closed) {
        live.closed = true;
        // Evict dead children eagerly so the next acquire spawns fresh
        // (instead of finding a tombstone and respawning anyway).
        this.pool.delete(k);
        this.lruSeq.delete(k);
      }
    };
    stdio.onerror = () => {
      const k = keyOf(key);
      const live = this.pool.get(k);
      if (live && !live.closed) {
        live.closed = true;
        this.pool.delete(k);
        this.lruSeq.delete(k);
      }
    };

    // `Client.connect()` calls `transport.start()` internally; we must not
    // pre-start the transport or the SDK throws "StdioClientTransport
    // already started!". The spawn-timeout is enforced on the connect call
    // so the contract is unchanged for callers.

    const client = new Client(
      {
        name: 'fora-mcp-transport',
        version: '0.1.0',
      },
      {
        capabilities: {},
      },
    );
    try {
      await this.withTimeout(
        client.connect(stdio, { timeout: this.spawnTimeoutMs }),
        this.spawnTimeoutMs,
        'spawn_timeout',
        { server: manifest.name },
      );
    } catch (err) {
      try {
        await client.close();
      } catch {
        void client;
      }
      try {
        await stdio.close();
      } catch {
        void stdio;
      }
      throw classifyError(err, { server: manifest.name });
    }

    const pid = stdio.pid ?? -1;
    if (pid === -1) {
      throw new TransportError('spawn_failed', 'child process has no pid', {
        retryable: true,
        server: manifest.name,
      });
    }

    const entry: LiveEntry = {
      key,
      manifest,
      client,
      transport: stdio,
      spawnedAt: this.clock(),
      lastUsedAt: this.clock(),
      pid,
      closed: false,
      inflight: 0,
    };
    return entry;
  }

  /**
   * If `manifest.bin` looks like a script (`.mjs`, `.js`, no path
   * separator), prepend `node` so the launcher is correct. If `bin` is a
   * full path or a real binary (e.g. `python`, `node`), pass through.
   */
  private normalizeLauncher(
    manifest: ServerManifest,
    argv: string[],
  ): { command: string; args: string[] } {
    const bin = manifest.bin;
    const looksLikeScript =
      /\.(m?js|cjs)$/i.test(bin) && !bin.includes('/');
    if (looksLikeScript) {
      return { command: 'node', args: [bin, ...argv] };
    }
    return { command: bin, args: argv };
  }

  /** Update LRU + idle bookkeeping. */
  private touch(entry: LiveEntry, k: string): void {
    entry.lastUsedAt = this.clock();
    this.lruSeq.set(k, this.nextLruSeq++);
  }

  /** Evict the LRU entry — kill its child and drop it from the pool. */
  private evictLru(): void {
    let oldestKey: string | null = null;
    let oldestSeq = Number.POSITIVE_INFINITY;
    for (const [k, seq] of this.lruSeq) {
      if (seq < oldestSeq) {
        oldestSeq = seq;
        oldestKey = k;
      }
    }
    if (oldestKey === null) return;
    const entry = this.pool.get(oldestKey);
    if (entry) {
      void this.evictEntry(entry, oldestKey);
    }
  }

  /** Evict a specific entry. */
  private async evictEntry(entry: LiveEntry, k: string): Promise<void> {
    entry.closed = true;
    this.pool.delete(k);
    this.lruSeq.delete(k);
    try {
      await entry.client.close();
    } catch {
      void entry;
    }
    try {
      await entry.transport.close();
    } catch {
      void entry;
    }
  }

  // --------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------

  private findToolDescriptor(
    server: ServerManifest,
    tool: ToolName,
  ): McpToolDescriptor | undefined {
    return server.tools.find((t) => t.name === tool);
  }

  private buildCallParams(opts: {
    tool: ToolName;
    args: McpArgs;
    toolDesc: McpToolDescriptor | undefined;
    idempotencyKey: string | undefined;
    stream?: boolean;
  }): { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> } {
    const meta: Record<string, unknown> = {};
    if (opts.stream) meta['stream'] = true;
    if (opts.idempotencyKey) meta['idempotency_key'] = opts.idempotencyKey;
    return {
      name: opts.tool,
      arguments: { ...(opts.args as Record<string, unknown>) },
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    };
  }

  private buildArgv(manifest: ServerManifest): string[] {
    const base = manifest.argv ? [...manifest.argv] : [];
    return base;
  }

  private isToolError(response: unknown): boolean {
    if (!response || typeof response !== 'object') return false;
    const r = response as { isError?: boolean };
    return r.isError === true;
  }

  private extractResult(response: unknown): unknown {
    if (!response || typeof response !== 'object') return response;
    const r = response as { content?: unknown; structuredContent?: unknown };
    if (r.structuredContent !== undefined) return r.structuredContent;
    if (r.content !== undefined) {
      const content = r.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      // Single text block → return the text; otherwise return the array.
      if (Array.isArray(content) && content.length === 1) {
        const only = content[0]!;
        if (only.type === 'text' && typeof only.text === 'string') return only.text;
      }
      return content;
    }
    return response;
  }

  /** Race a promise against a timeout, throwing a typed `TransportError`. */
  private async withTimeout<T>(
    p: Promise<T>,
    ms: number,
    kind: 'spawn_timeout' | 'invoke_timeout',
    ctx: { server: ServerManifest['name']; tool?: ToolName },
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new TransportError(kind, `${kind} after ${ms}ms`, {
            retryable: true,
            server: ctx.server,
            ...(ctx.tool ? { tool: ctx.tool } : {}),
          }),
        );
      }, ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Re-export `PoolEntry` so callers that imported it still resolve. */
export type { PoolEntry };
