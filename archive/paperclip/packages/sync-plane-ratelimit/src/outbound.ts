/**
 * Outbound — orchestrator that wires the FORA-487 three-layer limiter
 * + per-actor burst + composite-edit coalescer + per-platform call.
 *
 * Order of checks (each layer must pass before the next):
 *   1. Per-actor burst control       → (actor_id, connector_id) bucket, size=10, refill=5/s
 *   2. Layer 1 — Provider ceiling    → (connector_id, auth_method, scope) bucket
 *   3. Layer 2 — Per-tenant quota    → tier table (Trial/Standard/Enterprise) + project overrides
 *   4. Layer 3 — Circuit breaker     → per (connector_id, tenant_id), failure-driven
 *   5. Coalescer                     → R-SYNC-03 (comment storm DoS)
 *   6. platformCall (injected)
 *
 * v0.3 (FORA-487.2 / FORA-516):
 *   - 3-layer model + per-actor burst control as Layer 0
 *   - `connector.rate_limit.consumed` on every allow-path consume (Plan 3 §6)
 *   - Failure-ratio breaker mode (50% over 20)
 *   - Exponential backoff on repeated half-open failures (30s → 60s → 120s → 240s → 300s cap)
 *   - `connector.circuit.half_open` emitted on the open → half_open transition
 */

import { TokenBucket } from './token_bucket.js';
import { CircuitBreaker, type BreakerMode } from './circuit_breaker.js';
import { Coalescer, type OutboundEdit, type CoalesceFlushResult, type PlatformId } from './coalescer.js';
import { InMemoryAuditSink, NoopAuditSink, makeEvent, type AuditSink } from './audit.js';
import {
  ProviderCeiling,
  defaultCeilingRegistry,
  type AuthMethod,
  type ConnectorId,
  type Scope,
  type CeilingRegistry,
} from './provider_ceiling.js';
import { TierTable, type TenantTier, type ProjectOverride } from './tier_table.js';
import { ActorBucketRegistry } from './actor_bucket.js';

export type { ConnectorId, AuthMethod, Scope };
export type { TenantTier, ProjectOverride };

export interface OutboundConfig {
  /** Layer 1 — provider ceiling registry. Defaults to built-in. */
  readonly ceiling_registry?: CeilingRegistry;
  /** Default auth method when the edit does not specify one. */
  readonly default_auth?: AuthMethod;
  /** Default scope when the edit does not specify one. */
  readonly default_scope?: Scope;
  /** Layer 2 — tier table. Defaults to an empty table (all unknown tenants get Trial). */
  readonly tier_table?: TierTable;
  /** Layer 3 — circuit breaker defaults. */
  readonly breaker?: {
    failure_threshold?: number;
    failure_window_ms?: number;
    cooldown_ms?: number;
    cooldown_max_ms?: number;
    ratio_window?: number;
    ratio_threshold?: number;
    mode?: BreakerMode;
  };
  /** Per-actor burst defaults. */
  readonly actor_bucket?: { capacity?: number; refill_per_sec?: number };
  /** Composite-edit coalesce window. Default 30s. */
  readonly coalesce_window_ms?: number;
  /** Audit sink. Defaults to a noop. The smoke test uses InMemoryAuditSink. */
  readonly audit?: AuditSink;
  /** `now()` injection for tests. */
  readonly now?: () => number;
}

export interface OutboundPlatformCallContext {
  readonly tenant_id: string;
  readonly platform: PlatformId;
  readonly edit: OutboundEdit | CompositeBody;
  /** True if this call is a coalesced composite of N source events. */
  readonly composite: boolean;
}

export interface CompositeBody {
  readonly source_event_ids: readonly string[];
  readonly source_count: number;
  readonly body: string;
}

export interface PlatformCallResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export type PlatformCall = (ctx: OutboundPlatformCallContext) => Promise<PlatformCallResult>;

export type EnqueueDisposition =
  | { kind: 'sent'; result: PlatformCallResult; composite: false }
  | { kind: 'coalesced'; key: string; composite_event_ids: readonly string[] }
  | { kind: 'rejected_rate_limited'; layer: 'actor' | 'provider' | 'tenant' }
  | { kind: 'rejected_circuit_open' }
  | { kind: 'rejected_platform_paused'; until_ms: number };

export interface OutboundExtendedEdit extends OutboundEdit {
  /** Actor (the entity that initiated the edit). Required for Layer 0 per-actor burst. */
  readonly actor_id?: string;
  /** Project id (for Layer 2 project overrides). */
  readonly project_id?: string;
  /** Auth method (Layer 1). Defaults to config.default_auth. */
  readonly auth_method?: AuthMethod;
  /** Scope (Layer 1). Defaults to config.default_scope. */
  readonly scope?: Scope;
}

export class OutboundReliability {
  private readonly tenantBuckets = new Map<string, TokenBucket>();
  private readonly providerCeilings = new Map<string, ProviderCeiling>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  /** Per-breaker cursor into its `transitions` list — tracks the last
   *  transition we've already emitted as an audit event, so we don't
   *  re-emit on subsequent calls to `handleResult` / `handleError`. */
  private readonly breakerEmitCursor = new Map<string, number>();
  private readonly pausedUntil = new Map<PlatformId, number>();
  private readonly coalescer: Coalescer;
  private readonly audit: AuditSink;
  private readonly now: () => number;
  private readonly cfg: {
    ceiling_registry: CeilingRegistry;
    default_auth: AuthMethod;
    default_scope: Scope;
    tier_table: TierTable;
    actor_bucket: { capacity: number; refill_per_sec: number };
    breaker: {
      failure_threshold: number;
      failure_window_ms: number;
      cooldown_ms: number;
      cooldown_max_ms: number;
      ratio_window: number;
      ratio_threshold: number;
      mode: BreakerMode;
    };
    coalesce_window_ms: number;
  };
  private readonly actorBuckets: ActorBucketRegistry;
  /** In-flight counter per tenant for Layer 2 max_concurrent. */
  private readonly tenantInFlight = new Map<string, number>();

  constructor(opts: OutboundConfig, private readonly platformCall: PlatformCall) {
    this.audit = opts.audit ?? new NoopAuditSink();
    this.now = opts.now ?? Date.now;
    this.cfg = {
      ceiling_registry: opts.ceiling_registry ?? defaultCeilingRegistry(),
      default_auth: opts.default_auth ?? 'pat',
      default_scope: opts.default_scope ?? 'rest',
      tier_table: opts.tier_table ?? new TierTable({ now: this.now }),
      actor_bucket: {
        capacity: opts.actor_bucket?.capacity ?? 10,
        refill_per_sec: opts.actor_bucket?.refill_per_sec ?? 5,
      },
      breaker: {
        failure_threshold: opts.breaker?.failure_threshold ?? 5,
        failure_window_ms: opts.breaker?.failure_window_ms ?? 60_000,
        cooldown_ms: opts.breaker?.cooldown_ms ?? 30_000,
        cooldown_max_ms: opts.breaker?.cooldown_max_ms ?? 5 * 60_000,
        ratio_window: opts.breaker?.ratio_window ?? 20,
        ratio_threshold: opts.breaker?.ratio_threshold ?? 0.5,
        mode: opts.breaker?.mode ?? 'both',
      },
      coalesce_window_ms: opts.coalesce_window_ms ?? 30_000,
    };
    this.actorBuckets = new ActorBucketRegistry({
      capacity: this.cfg.actor_bucket.capacity,
      refill_per_sec: this.cfg.actor_bucket.refill_per_sec,
      now: this.now,
    });
    this.coalescer = new Coalescer({
      window_ms: this.cfg.coalesce_window_ms,
      now: this.now,
      flush: (merged) => this.flushComposite(merged),
    });
  }

  /**
   * Enqueue an outbound edit. Returns a synchronous disposition
   * describing what happened. For coalesced edits, the actual platform
   * call is fired by the coalescer's flush handler (W seconds after
   * the first edit), not by `enqueue()`.
   */
  enqueue(edit: OutboundExtendedEdit): EnqueueDisposition {
    const actor_id = edit.actor_id ?? edit.tenant_id;
    const project_id = edit.project_id;
    const auth = edit.auth_method ?? this.cfg.default_auth;
    const scope = edit.scope ?? this.cfg.default_scope;
    const connector: ConnectorId = edit.platform as ConnectorId;

    // 0. Platform pause check (X-RateLimit-Remaining < 10% previously
    //    tripped a pause; inbound keeps flowing).
    const pausedUntil = this.pausedUntil.get(edit.platform);
    if (pausedUntil !== undefined && this.now() < pausedUntil) {
      return { kind: 'rejected_platform_paused', until_ms: pausedUntil };
    }

    // 1. Per-actor burst control.
    if (!this.actorBuckets.take(actor_id, connector)) {
      this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'actor', actor_id }, this.nowDate));
      return { kind: 'rejected_rate_limited', layer: 'actor' };
    }
    this.audit.emit(makeEvent('connector.rate_limit.consumed', edit.tenant_id, edit.platform, { layer: 'actor', actor_id }, this.nowDate));

    // 2. Layer 1 — Provider ceiling.
    const providerCeiling = this.providerCeilingFor(connector, auth, scope);
    if (!providerCeiling.take()) {
      this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'provider', connector, scope, auth }, this.nowDate));
      return { kind: 'rejected_rate_limited', layer: 'provider' };
    }
    this.audit.emit(makeEvent('connector.rate_limit.consumed', edit.tenant_id, edit.platform, { layer: 'provider', connector, scope, auth }, this.nowDate));

    // 3. Layer 3 — Circuit breaker (per connector + tenant). Checked
    //    BEFORE Layer 2 (tenant quota) so a half-open probe can reach
    //    platformCall to determine connector health even when the
    //    tenant is rate-limited — otherwise a back-logged tenant
    //    would indefinitely block recovery of a tripped connector.
    const breaker = this.breakerFor(connector, edit.tenant_id);
    const breakerStateBefore = breaker.state;
    if (!breaker.canPass()) {
      this.audit.emit(makeEvent('connector.circuit.opened', edit.tenant_id, edit.platform, { rejected: true }, this.nowDate));
      return { kind: 'rejected_circuit_open' };
    }
    // canPass() may have transitioned open → half_open; that's a probe.
    const isHalfOpenProbe = breakerStateBefore === 'open' && breaker.state === 'half_open';

    // 4. Layer 2 — Per-tenant quota (RPM via bucket + max_concurrent via counter).
    //    A half-open probe bypasses tenant quota — the probe is testing
    //    the connector, not consuming tenant traffic budget.
    const tier = this.cfg.tier_table.resolve(edit.tenant_id, connector, project_id);
    const in_flight = this.tenantInFlight.get(edit.tenant_id) ?? 0;
    if (in_flight >= tier.max_concurrent) {
      if (!isHalfOpenProbe) {
        this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'tenant', tier: tier.tier, source: tier.source, reason: 'max_concurrent' }, this.nowDate));
        return { kind: 'rejected_rate_limited', layer: 'tenant' };
      }
    } else {
      const tenantBucket = this.tenantBucketFor(edit.tenant_id, tier.rpm);
      if (!tenantBucket.take() && !isHalfOpenProbe) {
        this.audit.emit(makeEvent('connector.rate_limit.throttled', edit.tenant_id, edit.platform, { layer: 'tenant', tier: tier.tier, source: tier.source, reason: 'rpm' }, this.nowDate));
        return { kind: 'rejected_rate_limited', layer: 'tenant' };
      }
      this.audit.emit(makeEvent('connector.rate_limit.consumed', edit.tenant_id, edit.platform, { layer: 'tenant', tier: tier.tier, source: tier.source, rpm: tier.rpm, in_flight }, this.nowDate));
      this.tenantInFlight.set(edit.tenant_id, in_flight + 1);
    }

    // 5. Coalescer — append and return disposition.
    const { coalesced, key } = this.coalescer.enqueue(edit);
    if (coalesced) {
      this.audit.emit(makeEvent('connector.coalesce.applied', edit.tenant_id, edit.platform, { key, event_id: edit.event_id }, this.nowDate));
      return { kind: 'coalesced', key, composite_event_ids: [edit.event_id] };
    }
    return { kind: 'coalesced', key, composite_event_ids: [edit.event_id] };
  }

  /** Force-flush all pending coalesce buffers. Test / shutdown seam. */
  async drain(): Promise<number> {
    return this.coalescer.drain();
  }

  /** Test seam: read the audit sink (works only if it was an InMemoryAuditSink). */
  inspectAudit(): InMemoryAuditSink | null {
    return this.audit instanceof InMemoryAuditSink ? this.audit : null;
  }

  /** Read-only: the tier table for advanced configuration. */
  get tiers(): TierTable {
    return this.cfg.tier_table;
  }

  /** Read-only: the breaker for a (connector, tenant) pair, or null if no calls have hit it yet. */
  breakerForConnector(connector: ConnectorId, tenant_id: string): CircuitBreaker | null {
    return this.breakers.get(`${connector}|${tenant_id}`) ?? null;
  }

  private async flushComposite(merged: import('./coalescer.js').CompositeEdit): Promise<CoalesceFlushResult> {
    try {
      const result = await this.platformCall({
        tenant_id: merged.tenant_id,
        platform: merged.platform,
        edit: {
          source_event_ids: merged.source_event_ids,
          source_count: merged.source_count,
          body: merged.body,
        },
        composite: true,
      });
      this.handleResult(merged.tenant_id, merged.platform, result);
      this.decrementInFlight(merged.tenant_id);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        per_event: merged.source_event_ids.map((event_id) => ({ event_id, ok: result.status >= 200 && result.status < 300 })),
      };
    } catch (err) {
      this.handleError(merged.tenant_id, merged.platform, err);
      this.decrementInFlight(merged.tenant_id);
      return { ok: false, status: 'platform_error', per_event: merged.source_event_ids.map((event_id) => ({ event_id, ok: false })) };
    }
  }

  private handleResult(tenant_id: string, platform: PlatformId, result: PlatformCallResult): void {
    // Update all per-(connector, tenant) breakers for this platform when
    // we see a 5xx — preserves the v0.1 platform-wide breaker behavior
    // for a real outage. The Layer 3 per-(connector, tenant) breaker
    // tracks both the platform signal AND the per-tenant ratio.
    for (const [key, cb] of this.breakers) {
      if (result.status >= 500 && result.status < 600) {
        cb.onFailure();
      } else {
        cb.onSuccess();
      }
      this.emitBreakerStateIfChanged(key, cb);
    }

    // Layer 1 — provider feedback.
    const remaining = parseRateLimitRemaining(result.headers);
    const limit = parseRateLimitLimit(result.headers);
    const retryAfter = parseRetryAfterMs(result.headers);
    if (remaining !== null || limit !== null || retryAfter !== null) {
      for (const ceiling of this.providerCeilings.values()) {
        ceiling.adjust({
          ...(remaining !== null ? { remaining } : {}),
          ...(limit !== null ? { limit } : {}),
          ...(retryAfter !== null ? { retry_after_sec: retryAfter / 1000 } : {}),
        });
      }
    }

    // Legacy platform pause behavior (X-RateLimit-Remaining < 10%): preserved
    // from v0.1 for backwards compatibility — FORA-487 v0.3 keeps it as a
    // platform-wide pause for very-low-water conditions.
    if (remaining !== null && limit !== null && limit > 0) {
      const ratio = remaining / limit;
      if (ratio < 0.1) {
        const until = this.now() + (retryAfter ?? this.cfg.breaker.cooldown_ms);
        const existing = this.pausedUntil.get(platform) ?? 0;
        if (until > existing) this.pausedUntil.set(platform, until);
        this.audit.emit(
          makeEvent('connector.rate_limit.throttled', tenant_id, platform, { layer: 'provider', remaining, limit, paused_until_ms: until, legacy_pause: true }, this.nowDate),
        );
      }
    }
  }

  private handleError(_tenant_id: string, platform: PlatformId, _err: unknown): void {
    for (const [key, cb] of this.breakers) {
      cb.onFailure();
      this.emitBreakerStateIfChanged(key, cb);
    }
    void platform;
  }

  /**
   * Emit an audit event for every transition the breaker has recorded
   * since our last emission. Tracks a per-breaker cursor so a single
   * breaker emitting multiple transitions in quick succession (e.g.
   * closed → open → half_open → open in the failure-ratio path) all
   * produce their own audit rows.
   */
  private emitBreakerStateIfChanged(key: string, breaker: CircuitBreaker): void {
    const transitions = breaker.recentTransitions();
    const cursor = this.breakerEmitCursor.get(key) ?? 0;
    for (let i = cursor; i < transitions.length; i++) {
      const tr = transitions[i]!;
      if (tr.to === 'open' && tr.from !== 'open') {
        this.audit.emit(makeEvent('connector.circuit.opened', null, null, { state: 'open', at_ms: tr.at_ms, trigger: tr.trigger }, this.nowDate));
      } else if (tr.to === 'half_open' && tr.from !== 'half_open') {
        this.audit.emit(makeEvent('connector.circuit.half_open', null, null, { state: 'half_open', at_ms: tr.at_ms, trigger: tr.trigger }, this.nowDate));
      } else if (tr.to === 'closed' && tr.from !== 'closed') {
        this.audit.emit(makeEvent('connector.circuit.closed', null, null, { state: 'closed', at_ms: tr.at_ms, trigger: tr.trigger }, this.nowDate));
      }
    }
    this.breakerEmitCursor.set(key, transitions.length);
  }

  private tenantBucketFor(tenant_id: string, rpm: number): TokenBucket {
    let b = this.tenantBuckets.get(tenant_id);
    if (!b) {
      const refill = rpm / 60;
      const capacity = Math.max(1, Math.ceil(rpm / 60));
      b = new TokenBucket({ capacity, refill_per_sec: refill, now: this.now });
      this.tenantBuckets.set(tenant_id, b);
    }
    return b;
  }

  private providerCeilingFor(connector: ConnectorId, auth: AuthMethod, scope: Scope): ProviderCeiling {
    const key = `${connector}|${auth}|${scope}`;
    let p = this.providerCeilings.get(key);
    if (!p) {
      p = new ProviderCeiling(connector, auth, scope, { now: this.now, registry: this.cfg.ceiling_registry });
      this.providerCeilings.set(key, p);
    }
    return p;
  }

  private breakerFor(connector: ConnectorId, tenant_id: string): CircuitBreaker {
    const key = `${connector}|${tenant_id}`;
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({ ...this.cfg.breaker, now: this.now });
      this.breakers.set(key, b);
    }
    return b;
  }

  private decrementInFlight(tenant_id: string): void {
    const cur = this.tenantInFlight.get(tenant_id) ?? 0;
    this.tenantInFlight.set(tenant_id, Math.max(0, cur - 1));
  }

  private get nowDate(): () => Date {
    const nowFn = this.now;
    return () => new Date(nowFn());
  }
}

function parseRateLimitRemaining(headers: Readonly<Record<string, string>>): number | null {
  const v = headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseRateLimitLimit(headers: Readonly<Record<string, string>>): number | null {
  const v = headers['x-ratelimit-limit'] ?? headers['X-RateLimit-Limit'];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseRetryAfterMs(headers: Readonly<Record<string, string>>): number | null {
  const v = headers['retry-after'] ?? headers['Retry-After'];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}
