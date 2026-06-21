/**
 * forge-ai/mcp-router — InMemoryMcpRouter
 *
 * Reference implementation of the `McpRouter` port. Pure logic, no I/O — the
 * router simulates upstream latency via the optional `delay_ms` knob and
 * routes through a pluggable `McpTransport`. Tests use a `ScriptedTransport`
 * to inject canned responses / errors.
 *
 * Components:
 *   - Per-server registry keyed by `ServerName`.
 *   - Tenant-scope gate that rejects cross-tenant resolve/invoke with
 *     `scope_denied`.
 *   - Per-tenant scope guard (FORA-48 §3.5 / FORA-448): pluggable
 *     `TenantValidator` (identity-broker) + `CredentialResolver`
 *     (customer-cloud-broker). Both fail closed.
 *   - Per-server circuit breaker (threshold + cooldown). After `threshold`
 *     consecutive `upstream_error` failures the breaker opens for
 *     `cooldown_ms`; subsequent invocations short-circuit with `circuit_open`.
 *   - Optional `McpAuditSink` for observability.
 *
 * Determinism:
 *   - The router holds a monotonic clock (default `Date.now`) so tests can
 *     pass a `Clock` for time-travel without sleeping.
 *   - All randomness, when needed, is fed via the optional `random` hook.
 */

import { defaultAuditSink, type McpAuditSink } from './audit.js';
import {
  argsInvalid,
  circuitOpen,
  credentialDenied,
  resolverUnreachable,
  scopeDenied,
  tenantInvalid,
  toolNotFound,
  unavailable,
  upstreamError,
  validatorUnreachable,
  type McpErrorEnvelope,
} from './errors.js';
import type {
  CredentialResolutionOutcome,
  CredentialResolver,
  McpArgs,
  McpAuditEvent,
  McpInvocationResult,
  McpRequestContext,
  McpResolution,
  McpResolutionResult,
  McpRouter,
  ServerManifest,
  ServerName,
  TenantId,
  TenantValidationOutcome,
  TenantValidator,
  ToolName,
} from './types.js';

/** Clock hook — returns milliseconds since epoch. Defaults to `Date.now`. */
export type Clock = () => number;

/** Optional sleep hook for the breaker cooldown path. Defaults to no-op. */
export type Sleeper = (ms: number) => Promise<void>;

/** Transport abstraction — the seam a future MCP stdio / HTTP adapter plugs into. */
export interface McpTransport {
  /** Invoke a tool; resolves with the upstream payload or throws. */
  invoke(
    server: ServerManifest,
    tool: ToolName,
    args: McpArgs,
    ctx: McpRequestContext,
  ): Promise<unknown>;
  /** Optional health probe — defaults to `'unknown'` if absent. */
  health?(server: ServerManifest): Promise<'healthy' | 'degraded' | 'unknown'>;
}

/** Per-server breaker state. */
interface BreakerState {
  failure_count: number;
  opened_at_ms: number | null; // null when closed
  last_failure_at_ms: number | null;
}

/** Constructor options. */
export interface InMemoryMcpRouterOptions {
  readonly audit?: McpAuditSink;
  readonly transport?: McpTransport;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  /** Failures before the breaker opens. Default 5. */
  readonly breaker_threshold?: number;
  /** Cooldown window in ms before the breaker half-opens. Default 30 000. */
  readonly breaker_cooldown_ms?: number;
  /** Synthetic latency injected between resolve/invoke and transport — tests use 0. */
  readonly delay_ms?: number;
  /**
   * Optional tenant validator (identity-broker adapter). When set, every
   * `resolve` and `invoke` call begins with `validator.validate(ctx.tenant_id)`.
   * The validator MUST throw on transport failure so the router can fail
   * closed. When omitted, the router skips the validator (FORA-444 default).
   */
  readonly tenant_validator?: TenantValidator;
  /**
   * Optional credential resolver (customer-cloud-broker adapter). When set,
   * `invoke` calls the resolver after the scope gate and before the
   * transport is invoked. Resolver must throw on transport failure.
   */
  readonly credential_resolver?: CredentialResolver;
}

/** Reasons the scope guard can reject. Mirrors audit-event outcomes. */
type ScopeGuardReason =
  | 'tenant_invalid'
  | 'credential_denied'
  | 'validator_unreachable'
  | 'resolver_unreachable';

/**
 * In-memory router. Holds manifests in a Map keyed by server name.
 */
export class InMemoryMcpRouter implements McpRouter {
  private readonly servers = new Map<ServerName, ServerManifest>();
  private readonly breakers = new Map<ServerName, BreakerState>();
  private readonly audit: McpAuditSink;
  private readonly transport: McpTransport;
  private readonly clock: Clock;
  private readonly sleeper: Sleeper;
  private readonly threshold: number;
  private readonly cooldown_ms: number;
  private readonly delay_ms: number;
  private readonly tenant_validator: TenantValidator | null;
  private readonly credential_resolver: CredentialResolver | null;

  constructor(opts: InMemoryMcpRouterOptions = {}) {
    this.audit = opts.audit ?? defaultAuditSink();
    this.transport =
      opts.transport ??
      {
        // Default transport rejects everything with `upstream_error`. Tests must
        // supply a `ScriptedTransport`; production wires an MCP stdio/HTTP
        // adapter (FORA-48 §3.1 follow-up).
        invoke: async () => {
          throw new Error('no transport configured');
        },
      };
    this.clock = opts.clock ?? Date.now;
    this.sleeper = opts.sleeper ?? (async () => undefined);
    this.threshold = opts.breaker_threshold ?? 5;
    this.cooldown_ms = opts.breaker_cooldown_ms ?? 30_000;
    this.delay_ms = opts.delay_ms ?? 0;
    this.tenant_validator = opts.tenant_validator ?? null;
    this.credential_resolver = opts.credential_resolver ?? null;
  }

  // ---------- registration ----------

  /**
   * Idempotent on `server.name` within scope. Re-registering with the same
   * name in the same scope overwrites (used for hot-reload).
   */
  async registerServer(manifest: ServerManifest): Promise<McpInvocationResult> {
    this.assertManifestValid(manifest);
    this.servers.set(manifest.name, manifest);
    if (!this.breakers.has(manifest.name)) {
      this.breakers.set(manifest.name, {
        failure_count: 0,
        opened_at_ms: null,
        last_failure_at_ms: null,
      });
    }
    this.emitAudit({
      kind: 'mcp.register',
      tenant_id: manifest.tenantId ?? ('' as TenantId),
      actor: 'system:router',
      server: manifest.name,
      outcome: 'ok',
      at: this.isoNow(),
    });
    return {
      status: 'ok',
      result: { registered: manifest.name },
      latency_ms: 0,
      server: manifest.name,
      tool: '' as ToolName, // registration is not a tool invocation
    };
  }

  // ---------- scope gate ----------

  /**
   * Returns true when `ctx` is allowed to see `manifest`. Global: anyone.
   * Tenant: same tenant. Agent: same tenant AND same agent_type.
   */
  private scopeAllows(
    manifest: ServerManifest,
    ctx: McpRequestContext,
  ): boolean {
    switch (manifest.tenantScope) {
      case 'global':
        return true;
      case 'tenant':
        return manifest.tenantId === ctx.tenant_id;
      case 'agent':
        return (
          manifest.tenantId === ctx.tenant_id &&
          manifest.agentType !== undefined &&
          manifest.agentType === ctx.agent_type
        );
    }
  }

  // ---------- resolve ----------

  async resolve(
    ctx: McpRequestContext,
    server: ServerName,
    toolName?: ToolName,
  ): Promise<McpResolutionResult> {
    const start = this.clock();

    // Stage 0 — per-tenant scope guard (FORA-48 §3.5). When a tenant
    // validator is configured we MUST consult it before any other work.
    // The validator throws on transport failure (fail closed).
    if (this.tenant_validator !== null) {
      const guard = await this.guardTenant(ctx, server, toolName, 'mcp.resolve');
      if (guard !== null) return guard;
    }

    const manifest = this.servers.get(server);
    if (!manifest) {
      const err = unavailable(server, `server ${server} not registered`, ctx.tenant_id);
      this.emitAudit(this.errorAudit(ctx, 'mcp.resolve', server, undefined, err));
      return err;
    }
    if (!this.scopeAllows(manifest, ctx)) {
      const err = scopeDenied(
        server,
        manifest.tenantScope,
        ctx.tenant_id,
        ctx.agent_type,
      );
      this.emitAudit(this.errorAudit(ctx, 'mcp.resolve', server, undefined, err));
      return err;
    }
    if (toolName !== undefined) {
      const tool = manifest.tools.find((t) => t.name === toolName);
      if (!tool) {
        const err = toolNotFound(server, toolName, manifest.tools.map((t) => t.name));
        this.emitAudit(this.errorAudit(ctx, 'mcp.resolve', server, toolName, err));
        return err;
      }
    }
    const resolution: McpResolution = {
      status: 'resolved',
      manifest,
      health: await this.probeHealth(manifest),
    };
    this.emitAudit({
      kind: 'mcp.resolve',
      tenant_id: ctx.tenant_id,
      actor: ctx.actor,
      server,
      ...(toolName ? { tool: toolName } : {}),
      outcome: 'ok',
      latency_ms: this.clock() - start,
      ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
      at: this.isoNow(),
    });
    return resolution;
  }

  // ---------- invoke ----------

  async invoke(
    ctx: McpRequestContext,
    server: ServerName,
    tool: ToolName,
    args: McpArgs,
  ): Promise<McpInvocationResult> {
    const start = this.clock();

    // Stage 0 — per-tenant scope guard (FORA-48 §3.5). Tenant validation
    // runs before ANY transport call. On validator failure or throw,
    // returns an error WITHOUT spawning the upstream MCP.
    if (this.tenant_validator !== null) {
      const guard = await this.guardTenant(ctx, server, tool, 'mcp.invoke');
      if (guard !== null) return guard;
    }

    const manifest = this.servers.get(server);
    if (!manifest) {
      const err = unavailable(server, `server ${server} not registered`, ctx.tenant_id);
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, err));
      return err;
    }
    if (!this.scopeAllows(manifest, ctx)) {
      const err = scopeDenied(server, manifest.tenantScope, ctx.tenant_id, ctx.agent_type);
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, err));
      return err;
    }
    const toolDesc = manifest.tools.find((t) => t.name === tool);
    if (!toolDesc) {
      const err = toolNotFound(server, tool, manifest.tools.map((t) => t.name));
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, err));
      return err;
    }
    // Validate args against the tool's input_schema. The router only enforces
    // the "top-level object" shape; deep validation is the tool's job.
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      const err = argsInvalid(
        server,
        tool,
        'args must be a plain object',
        toolDesc.input_schema,
      );
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, err));
      return err;
    }

    // Stage 1 — per-tenant credential resolution (FORA-48 §3.5). When a
    // credential resolver is configured we MUST mint per-tenant credentials
    // BEFORE invoking the transport. Resolver throws on transport failure
    // (fail closed — no spawn).
    if (this.credential_resolver !== null) {
      const resolved = await this.resolveCredential(ctx, server, tool);
      if (resolved !== null) {
        // resolved is an error envelope; bail out before any transport call.
        return resolved;
      }
    }

    // Circuit breaker gate. Check before dispatch.
    const breakerErr = this.checkBreaker(server);
    if (breakerErr) {
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, breakerErr));
      return breakerErr;
    }

    if (this.delay_ms > 0) {
      await this.sleeper(this.delay_ms);
    }

    try {
      const result = await this.transport.invoke(manifest, tool, args, ctx);
      const latency_ms = this.clock() - start;
      this.recordSuccess(server);
      this.emitAudit({
        kind: 'mcp.invoke',
        tenant_id: ctx.tenant_id,
        actor: ctx.actor,
        server,
        tool,
        outcome: 'ok',
        latency_ms,
        ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
        at: this.isoNow(),
      });
      return { status: 'ok', result, latency_ms, server, tool };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const upstream = upstreamError(server, tool, message);
      this.recordFailure(server);
      this.emitAudit(this.errorAudit(ctx, 'mcp.invoke', server, tool, upstream));
      return upstream;
    }
  }

  // ---------- listServers ----------

  async listServers(ctx: McpRequestContext): Promise<readonly ServerManifest[]> {
    const out: ServerManifest[] = [];
    for (const manifest of this.servers.values()) {
      if (this.scopeAllows(manifest, ctx)) out.push(manifest);
    }
    return out;
  }

  // ---------- helpers ----------

  /**
   * Stage 0 of resolve/invoke. Consult the tenant validator (identity-broker)
   * and shape any rejection as a first-class `McpErrorEnvelope`. Returns
   * `null` when the validator approves the tenant; the caller proceeds.
   *
   * Fail-closed semantics (FORA-48 §3.5):
   *   - `validator.validate` throws → `validator_unreachable`
   *   - `validator.validate` returns `{ok:false}` → `tenant_invalid`
   *
   * The transport is never called on the rejection path. AC #3: a tenant
   * whose validator returns `ok:false` cannot reach a peer-tenant MCP,
   * and the upstream process for that MCP is never spawned.
   */
  private async guardTenant(
    ctx: McpRequestContext,
    server: ServerName,
    tool: ToolName | undefined,
    kind: 'mcp.resolve' | 'mcp.invoke',
  ): Promise<McpErrorEnvelope | null> {
    // The validator is guaranteed non-null here — guard call site checks.
    const validator = this.tenant_validator as TenantValidator;
    let outcome: TenantValidationOutcome;
    try {
      outcome = await validator.validate(ctx.tenant_id);
    } catch (e: unknown) {
      const reason = errorMessage(e);
      const err = validatorUnreachable(server, ctx.tenant_id, reason);
      this.emitScopeGuardAudit(ctx, server, tool, kind, 'validator_unreachable', reason);
      return err;
    }
    if (outcome.ok) return null;
    const err = tenantInvalid(server, ctx.tenant_id, outcome.reason);
    this.emitScopeGuardAudit(ctx, server, tool, kind, 'tenant_invalid', outcome.reason);
    return err;
  }

  /**
   * Stage 1 of invoke. Consult the credential resolver (customer-cloud-
   * broker) and stamp the resolved credential onto `ctx.credential`. On
   * rejection, returns the error envelope (caller bails); returns `null` on
   * success (caller proceeds with the credential in `ctx.credential`).
   *
   * The credential is opaque to the router — the transport reads it and
   * forwards it to the upstream MCP server.
   */
  private async resolveCredential(
    ctx: McpRequestContext,
    server: ServerName,
    tool: ToolName,
  ): Promise<McpErrorEnvelope | null> {
    const resolver = this.credential_resolver as CredentialResolver;
    let outcome: CredentialResolutionOutcome;
    try {
      outcome = await resolver.resolve(ctx.tenant_id, server);
    } catch (e: unknown) {
      const reason = errorMessage(e);
      const err = resolverUnreachable(server, ctx.tenant_id, reason);
      this.emitScopeGuardAudit(ctx, server, tool, 'mcp.invoke', 'resolver_unreachable', reason);
      return err;
    }
    if (outcome.ok) {
      // Mutate the request envelope so the transport receives the credential.
      // The branded readonly types above only restrict mutation at compile
      // time on `McpRequestContext`; we deliberately widen through `unknown`
      // here because the credential is broker-owned and the transport reads
      // it on the same object reference.
      (ctx as { credential?: unknown }).credential = outcome.credential;
      return null;
    }
    const err = credentialDenied(server, ctx.tenant_id, outcome.reason);
    this.emitScopeGuardAudit(ctx, server, tool, 'mcp.invoke', 'credential_denied', outcome.reason);
    return err;
  }

  /**
   * Best-effort audit emitter for scope-guard rejections. Distinct from
   * the resolve/invoke audit so a Board reviewer can grep for every
   * scope-guard event regardless of the surface they originated on.
   */
  private emitScopeGuardAudit(
    ctx: McpRequestContext,
    server: ServerName,
    tool: ToolName | undefined,
    origin: 'mcp.resolve' | 'mcp.invoke',
    outcome: ScopeGuardReason,
    reason: string,
  ): void {
    this.emitAudit({
      kind: 'mcp.scope_guard',
      tenant_id: ctx.tenant_id,
      actor: ctx.actor,
      server,
      ...(tool ? { tool } : {}),
      outcome,
      reason,
      ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
      at: this.isoNow(),
    });
    // Also stamp the originating audit kind with the same outcome so the
    // `mcp.invoke` / `mcp.resolve` audit trail reflects the rejection.
    this.emitAudit({
      kind: origin,
      tenant_id: ctx.tenant_id,
      actor: ctx.actor,
      server,
      ...(tool ? { tool } : {}),
      outcome,
      latency_ms: 0,
      ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
      at: this.isoNow(),
    });
  }

  private async probeHealth(manifest: ServerManifest): Promise<'healthy' | 'degraded' | 'unknown'> {
    if (this.transport.health) {
      return this.transport.health(manifest);
    }
    return 'unknown';
  }

  private assertManifestValid(manifest: ServerManifest): void {
    if (!manifest.name) throw new Error('manifest.name is required');
    if (!manifest.bin) throw new Error('manifest.bin is required');
    if (manifest.tenantScope === 'tenant' && !manifest.tenantId) {
      throw new Error('tenant-scoped manifest requires tenantId');
    }
    if (manifest.tenantScope === 'agent' && (!manifest.tenantId || !manifest.agentType)) {
      throw new Error('agent-scoped manifest requires tenantId + agentType');
    }
    if (manifest.tenantScope === 'global' && (manifest.tenantId || manifest.agentType)) {
      throw new Error('global manifest must not carry tenantId/agentType');
    }
    if (!Array.isArray(manifest.tools)) {
      throw new Error('manifest.tools must be an array');
    }
    const seen = new Set<string>();
    for (const t of manifest.tools) {
      if (!t.name) throw new Error('tool.name is required');
      if (seen.has(t.name)) throw new Error(`duplicate tool.name ${t.name}`);
      seen.add(t.name);
    }
  }

  private checkBreaker(server: ServerName): McpErrorEnvelope | null {
    const state = this.breakers.get(server);
    if (!state || state.opened_at_ms === null) return null;
    const elapsed = this.clock() - state.opened_at_ms;
    if (elapsed >= this.cooldown_ms) {
      // Half-open: reset failure count and allow the next call through.
      state.opened_at_ms = null;
      state.failure_count = 0;
      return null;
    }
    return circuitOpen(server, new Date(state.opened_at_ms).toISOString(), this.cooldown_ms, state.failure_count);
  }

  private recordSuccess(server: ServerName): void {
    const state = this.breakers.get(server);
    if (!state) return;
    state.failure_count = 0;
    state.opened_at_ms = null;
    state.last_failure_at_ms = null;
  }

  private recordFailure(server: ServerName): void {
    const state = this.breakers.get(server);
    if (!state) return;
    state.failure_count += 1;
    state.last_failure_at_ms = this.clock();
    if (state.failure_count >= this.threshold && state.opened_at_ms === null) {
      state.opened_at_ms = this.clock();
    }
  }

  private errorAudit(
    ctx: McpRequestContext,
    kind: McpAuditEvent['kind'],
    server: ServerName,
    tool: ToolName | undefined,
    err: McpErrorEnvelope,
  ): McpAuditEvent {
    return {
      kind,
      tenant_id: ctx.tenant_id,
      actor: ctx.actor,
      server,
      ...(tool ? { tool } : {}),
      outcome: err.error.kind,
      ...(ctx.trace_id ? { trace_id: ctx.trace_id } : {}),
      at: this.isoNow(),
    };
  }

  private emitAudit(event: McpAuditEvent): void {
    // Best-effort emit; failures are not surfaced.
    void this.audit.emit(event);
  }

  private isoNow(): string {
    return new Date(this.clock()).toISOString();
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Test helper — feed canned transport responses in declaration order. */
export class ScriptedTransport implements McpTransport {
  private readonly queue: Array<
    { kind: 'ok'; result: unknown } | { kind: 'throw'; message: string }
  >;
  private idx = 0;
  public healthCalls = 0;
  public invokeCalls = 0;

  constructor(
    queue: Array<
      { kind: 'ok'; result: unknown } | { kind: 'throw'; message: string }
    >,
  ) {
    this.queue = queue;
  }

  async invoke(): Promise<unknown> {
    this.invokeCalls += 1;
    const item = this.queue[this.idx];
    this.idx += 1;
    if (!item) throw new Error('scripted transport exhausted');
    if (item.kind === 'ok') return item.result;
    throw new Error(item.message);
  }

  async health(): Promise<'healthy' | 'degraded' | 'unknown'> {
    this.healthCalls += 1;
    return 'healthy';
  }

  /** Test helper — number of consumed responses. */
  consumed(): number {
    return this.idx;
  }

  /** Test helper — remaining responses. */
  remaining(): number {
    return this.queue.length - this.idx;
  }
}
