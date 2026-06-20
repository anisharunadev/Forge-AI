/**
 * ProviderCeiling — Layer 1 (provider ceiling, hard) tests.
 * FORA-487 v0.3 / FORA-516.
 */

import { describe, it, expect } from 'vitest';
import { ProviderCeiling, defaultCeilingRegistry, ceilingKey } from '../provider_ceiling.js';

describe('ProviderCeiling', () => {
  it('honors built-in static ceilings (GitHub 5000/hr, Jira 100/min, Slack tier-1 1/sec)', () => {
    let t = 0;
    const gh = new ProviderCeiling('github', 'pat', 'rest', { now: () => t });
    // 5000 capacity, 5000/3600 ≈ 1.39/s.
    expect(gh.maxCapacity).toBe(5000);
    // Drain 5000 tokens.
    for (let i = 0; i < 5000; i++) expect(gh.take()).toBe(true);
    expect(gh.take()).toBe(false);
    // Jira: 100/min, 100/60 ≈ 1.67/s.
    const jira = new ProviderCeiling('jira', 'pat', 'rest', { now: () => t });
    expect(jira.maxCapacity).toBe(100);
    for (let i = 0; i < 100; i++) expect(jira.take()).toBe(true);
    expect(jira.take()).toBe(false);
    // Slack tier-1: 1 token, 1/sec.
    const slack = new ProviderCeiling('slack', 'app', 'channel-tier-1', { now: () => t });
    expect(slack.maxCapacity).toBe(1);
    expect(slack.take()).toBe(true);
    expect(slack.take()).toBe(false);
  });

  it('adjust() tightens capacity when provider reports lower remaining', () => {
    let t = 0;
    const p = new ProviderCeiling('jira', 'pat', 'rest', { now: () => t });
    // Provider says "30 of 100 left" → cap our dynamic view at 30.
    p.adjust({ remaining: 30, limit: 100 });
    // We've already taken 0 tokens, but the dynamic reduction kicks in.
    // Take 30 (allowed by the dynamic cap) — 31st should fail.
    for (let i = 0; i < 30; i++) expect(p.take()).toBe(true);
    expect(p.take()).toBe(false);
  });

  it('adjust() honors Retry-After as a temporary drain (1ms floor, 60s ceiling)', () => {
    let t = 0;
    const p = new ProviderCeiling('jira', 'pat', 'rest', { now: () => t });
    p.adjust({ retry_after_sec: 5 });
    expect(p.lastRetryAfterMs).toBe(5_000);
    // Floor: 0.0005s rounds to 0ms at the floor; the actual floor is 1ms.
    p.adjust({ retry_after_sec: 0.0001 });
    expect(p.lastRetryAfterMs).toBe(1);
    // Ceiling: 120s caps at 60s.
    p.adjust({ retry_after_sec: 120 });
    expect(p.lastRetryAfterMs).toBe(60_000);
  });

  it('throws when no ceiling is registered for the (connector, auth, scope) tuple', () => {
    expect(() => new ProviderCeiling('slack', 'app', 'rest' as never)).toThrow(/no ceiling registered/);
  });

  it('ceilingKey is a stable string', () => {
    expect(ceilingKey('github', 'pat', 'rest')).toBe('github|pat|rest');
    expect(defaultCeilingRegistry().has(ceilingKey('github', 'pat', 'rest'))).toBe(true);
  });
});
