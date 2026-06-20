/**
 * OutboundReliability — end-to-end tests of the FORA-487 v0.3
 * three-layer model + per-actor burst control. Replaces the v0.1
 * FORA-256 test fixture set with the v0.3 layered semantics:
 *
 *  AC#1  Layer 1 provider ceiling takes priority over Layer 2.
 *  AC#2  Layer 2 per-tenant tier (Trial/Standard/Enterprise) governs RPM + max_concurrent.
 *  AC#3  Project overrides may LOWER the cap (never raise).
 *  AC#4  Layer 3 per-(connector, tenant) circuit breaker trips on
 *        failure_ratio (default `mode: 'both'`).
 *  AC#5  Repeated half-open failures drive exponential backoff
 *        30s → 60s → 120s → 240s → 300s cap.
 *  AC#6  Per-actor burst control throttles an actor at the
 *        (actor_id, connector_id) bucket.
 *  AC#7  `connector.rate_limit.consumed` is emitted on every allow-path consume.
 *  AC#8  Coalescer still works on the happy path.
 *  AC#9  One tenant bursting does NOT exhaust another tenant tokens.
 *  AC#10 `connector.circuit.half_open` is emitted on the open → half_open transition.
 *  AC#11 Legacy platform pause (< 10% remaining) is preserved.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OutboundReliability,
  InMemoryAuditSink,
  TierTable,
  type PlatformCall,
  type PlatformCallResult,
  type OutboundExtendedEdit,
} from '../index.js';

function edit(i: number, overrides: Partial<OutboundExtendedEdit> = {}): OutboundExtendedEdit {
  return {
    event_id: `e${i}`,
    tenant_id: 'tenant-A',
    platform: 'jira',
    remote_issue_id: 'JIRA-100',
    edit_kind: 'comment',
    body: `body ${i}`,
    enqueued_at_ms: i * 10,
    actor_id: 'tenant-A',
    ...overrides,
  };
}

interface MakeOpts {
  platformCall?: PlatformCall;
  failureThreshold?: number;
  cooldownMs?: number;
  cooldownMaxMs?: number;
  ratioWindow?: number;
  ratioThreshold?: number;
  coalesceWindowMs?: number;
  failureWindowMs?: number;
  clock?: { t: number };
  tierTable?: TierTable;
  actorCapacity?: number;
  actorRefillPerSec?: number;
  breakerMode?: 'consecutive' | 'failure_ratio' | 'both';
}

function makeOutbound(opts: MakeOpts = {}) {
  const audit = new InMemoryAuditSink();
  const clock = opts.clock ?? { t: 0 };
  const platformCall: PlatformCall =
    opts.platformCall ??
    (async () => ({ status: 200, headers: {}, body: { ok: true } } as PlatformCallResult));
  const r = new OutboundReliability(
    {
      audit,
      now: () => clock.t,
      actor_bucket: { capacity: opts.actorCapacity ?? 100, refill_per_sec: opts.actorRefillPerSec ?? 100 },
      tier_table: opts.tierTable ?? new TierTable({ now: () => clock.t }),
      breaker: {
        failure_threshold: opts.failureThreshold ?? 5,
        failure_window_ms: opts.failureWindowMs ?? 60_000,
        cooldown_ms: opts.cooldownMs ?? 1000,
        cooldown_max_ms: opts.cooldownMaxMs ?? 300_000,
        ratio_window: opts.ratioWindow ?? 20,
        ratio_threshold: opts.ratioThreshold ?? 0.5,
        mode: opts.breakerMode ?? 'both',
      },
      coalesce_window_ms: opts.coalesceWindowMs ?? 1,
    },
    platformCall,
  );
  return { r, audit, clock, platformCall };
}

describe('OutboundReliability — FORA-487 v0.3 three-layer limiter', () => {
  it('AC#1: Layer 1 provider ceiling throttles after static capacity exhausted', () => {
    const { r, audit, clock } = makeOutbound({});
    r.enqueue(edit(0, { platform: 'slack', auth_method: 'app', scope: 'channel-tier-1' }));
    clock.t += 10;
    const second = r.enqueue(edit(1, { platform: 'slack', auth_method: 'app', scope: 'channel-tier-1' }));
    expect(second.kind).toBe('rejected_rate_limited');
    if (second.kind === 'rejected_rate_limited') expect(second.layer).toBe('provider');
    const throttled = audit.listOfType('connector.rate_limit.throttled');
    expect(throttled.some((e) => e.payload['layer'] === 'provider')).toBe(true);
  });

  it('AC#2: Layer 2 trial tier — 30 RPM, 4 concurrent — enforced per tenant', () => {
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'trial');
    const { r, clock } = makeOutbound({ tierTable: tiers, actorCapacity: 100, actorRefillPerSec: 100 });
    expect(r.enqueue(edit(0)).kind).toBe('coalesced');
    const second = r.enqueue(edit(1));
    expect(second.kind).toBe('rejected_rate_limited');
    if (second.kind === 'rejected_rate_limited') expect(second.layer).toBe('tenant');
    clock.t += 2_100;
    expect(r.enqueue(edit(2)).kind).toBe('coalesced');
  });

  it('AC#3: project override may LOWER the cap but throws when raised', () => {
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'standard');
    tiers.setProjectOverride('tenant-A', 'jira', 'proj-1', { rpm: 30, max_concurrent: 1 });
    const r1 = tiers.resolve('tenant-A', 'jira', 'proj-1');
    expect(r1.rpm).toBe(30);
    expect(r1.max_concurrent).toBe(1);
    expect(r1.source).toBe('project_override');
    expect(() => tiers.setProjectOverride('tenant-A', 'jira', 'proj-2', { rpm: 600 })).toThrow();
  });

  it('AC#4: failure_ratio mode trips on >50% failures over 20 calls', async () => {
    let counter = 0;
    const platformCall: PlatformCall = async () => {
      counter += 1;
      return { status: counter <= 11 ? 500 : 200, headers: {}, body: {} };
    };
    const { r } = makeOutbound({ platformCall, breakerMode: 'failure_ratio', failureThreshold: 100 });
    for (let i = 0; i < 20; i++) {
      r.enqueue(edit(i, { remote_issue_id: `JIRA-${i}` }));
    }
    await r.drain();
    const breaker = r.breakerForConnector('jira', 'tenant-A');
    expect(breaker).not.toBeNull();
    expect(breaker!.state).toBe('open');
  });

  it('AC#5: repeated half-open failures drive exponential backoff', async () => {
    const platformCall: PlatformCall = async () => ({ status: 500, headers: {}, body: {} });
    const { r, clock } = makeOutbound({ platformCall, failureThreshold: 1, cooldownMs: 1000, cooldownMaxMs: 10_000 });
    r.enqueue(edit(0, { remote_issue_id: 'JIRA-0' }));
    await r.drain();
    const breaker = r.breakerForConnector('jira', 'tenant-A')!;
    expect(breaker.state).toBe('open');
    clock.t += 1001;
    expect(breaker.currentCooldown()).toBe(1000);
    r.enqueue(edit(1, { remote_issue_id: 'JIRA-1' }));
    await r.drain();
    expect(breaker.currentCooldown()).toBe(2000);
    clock.t += 2001;
    r.enqueue(edit(2, { remote_issue_id: 'JIRA-2' }));
    await r.drain();
    expect(breaker.currentCooldown()).toBe(4000);
    clock.t += 4001;
    r.enqueue(edit(3, { remote_issue_id: 'JIRA-3' }));
    await r.drain();
    expect(breaker.currentCooldown()).toBe(8000);
    clock.t += 8001;
    r.enqueue(edit(4, { remote_issue_id: 'JIRA-4' }));
    await r.drain();
    expect(breaker.currentCooldown()).toBe(10000);
    clock.t += 10001;
    r.enqueue(edit(5, { remote_issue_id: 'JIRA-5' }));
    await r.drain();
    expect(breaker.currentCooldown()).toBe(10000);
  });

  it('AC#6: per-actor burst control throttles an actor on a runaway loop', () => {
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'enterprise');
    const { r, audit } = makeOutbound({ tierTable: tiers, actorCapacity: 3, actorRefillPerSec: 0 });
    expect(r.enqueue(edit(0, { actor_id: 'agent-x' })).kind).toBe('coalesced');
    expect(r.enqueue(edit(1, { actor_id: 'agent-x' })).kind).toBe('coalesced');
    expect(r.enqueue(edit(2, { actor_id: 'agent-x' })).kind).toBe('coalesced');
    const fourth = r.enqueue(edit(3, { actor_id: 'agent-x' }));
    expect(fourth.kind).toBe('rejected_rate_limited');
    if (fourth.kind === 'rejected_rate_limited') expect(fourth.layer).toBe('actor');
    const throttled = audit.listOfType('connector.rate_limit.throttled');
    expect(throttled.some((e) => e.payload['layer'] === 'actor' && e.payload['actor_id'] === 'agent-x')).toBe(true);
  });

  it('AC#7: connector.rate_limit.consumed is emitted on every allow-path consume', () => {
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'enterprise');
    const { r, audit } = makeOutbound({ tierTable: tiers });
    r.enqueue(edit(0));
    const consumed = audit.listOfType('connector.rate_limit.consumed');
    expect(consumed.length).toBe(3);
    const layers = consumed.map((e) => e.payload['layer']);
    expect(layers).toEqual(expect.arrayContaining(['actor', 'provider', 'tenant']));
  });

  it('AC#8: coalescer still works on the happy path (FORA-256 AC#3 carryover)', async () => {
    const platformCall = vi.fn<PlatformCall>(async () => ({ status: 200, headers: {}, body: { ok: true } }));
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'enterprise');
    const { r } = makeOutbound({ platformCall, tierTable: tiers, coalesceWindowMs: 30_000, actorCapacity: 100, actorRefillPerSec: 100 });
    for (let i = 0; i < 5; i++) r.enqueue(edit(i));
    await r.drain();
    expect(platformCall).toHaveBeenCalledTimes(1);
    const ctx = platformCall.mock.calls[0]![0];
    expect(ctx.composite).toBe(true);
    if (ctx.edit && 'source_count' in ctx.edit) {
      expect(ctx.edit.source_count).toBe(5);
      expect(ctx.edit.source_event_ids).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    } else {
      throw new Error('expected composite body');
    }
  });

  it('AC#9: one tenant bursting does NOT exhaust another tenant tokens', () => {
    const tiers = new TierTable();
    tiers.setTenantTier('tenant-A', 'trial');
    tiers.setTenantTier('tenant-B', 'enterprise');
    const { r, clock } = makeOutbound({ tierTable: tiers, actorCapacity: 100, actorRefillPerSec: 100 });
    r.enqueue(edit(0, { tenant_id: 'tenant-A', actor_id: 'tenant-A' }));
    clock.t += 10;
    const a2 = r.enqueue(edit(1, { tenant_id: 'tenant-A', actor_id: 'tenant-A' }));
    expect(a2.kind).toBe('rejected_rate_limited');
    const b = r.enqueue(edit(2, { tenant_id: 'tenant-B', actor_id: 'tenant-B' }));
    expect(b.kind).toBe('coalesced');
  });

  it('AC#10: connector.circuit.half_open is emitted on the open → half_open transition', async () => {
    const platformCall: PlatformCall = async () => ({ status: 500, headers: {}, body: {} });
    const { r, audit, clock } = makeOutbound({ platformCall, failureThreshold: 1, cooldownMs: 100 });
    r.enqueue(edit(0, { remote_issue_id: 'JIRA-0' }));
    await r.drain();
    clock.t += 101;
    r.enqueue(edit(1, { remote_issue_id: 'JIRA-1' }));
    await r.drain();
    const halfOpen = audit.listOfType('connector.circuit.half_open');
    expect(halfOpen.length).toBeGreaterThanOrEqual(1);
  });

  it('AC#11: legacy platform pause (X-RateLimit-Remaining < 10%) is preserved', async () => {
    const platformCall: PlatformCall = async () => ({
      status: 200,
      headers: { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '5' },
      body: {},
    });
    const { r, clock } = makeOutbound({
      platformCall,
      actorCapacity: 100,
      actorRefillPerSec: 100,
      coalesceWindowMs: 1,
    });
    r.enqueue(edit(0, { event_id: 'e0', remote_issue_id: 'J-0' }));
    r.enqueue(edit(1, { event_id: 'e1', remote_issue_id: 'J-1' }));
    await r.drain();
    const paused = r.enqueue(edit(2, { event_id: 'e2', remote_issue_id: 'J-2' }));
    expect(paused.kind).toBe('rejected_platform_paused');
    if (paused.kind === 'rejected_platform_paused') {
      expect(paused.until_ms).toBeGreaterThan(clock.t);
    }
  });
});
