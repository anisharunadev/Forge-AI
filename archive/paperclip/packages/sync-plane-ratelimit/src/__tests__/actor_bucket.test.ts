/**
 * ActorBucket — per-actor burst control tests.
 * FORA-487 v0.3 / FORA-516.
 */

import { describe, it, expect } from 'vitest';
import { ActorBucket, ActorBucketRegistry } from '../actor_bucket.js';

describe('ActorBucket', () => {
  it('defaults to size=10, refill=5/sec (FORA-487 charter)', () => {
    const b = new ActorBucket();
    expect(b.maxCapacity).toBe(10);
    expect(b.refillRatePerSec).toBe(5);
  });

  it('takes tokens up to capacity then refuses', () => {
    let t = 0;
    const b = new ActorBucket({ capacity: 3, refill_per_sec: 0, now: () => t });
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it('refills at the configured rate', () => {
    let t = 0;
    const b = new ActorBucket({ capacity: 2, refill_per_sec: 1, now: () => t });
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    t += 1_100;
    expect(b.take()).toBe(true);
  });
});

describe('ActorBucketRegistry', () => {
  it('isolates per (actor, connector) keying', () => {
    const reg = new ActorBucketRegistry({ capacity: 1, refill_per_sec: 0 });
    expect(reg.take('agent-x', 'jira')).toBe(true);
    expect(reg.take('agent-x', 'jira')).toBe(false);
    // Same actor, different connector — fresh bucket.
    expect(reg.take('agent-x', 'github')).toBe(true);
    // Different actor, same connector — fresh bucket.
    expect(reg.take('agent-y', 'jira')).toBe(true);
  });

  it('inspect() exposes capacity + refill rate', () => {
    const reg = new ActorBucketRegistry({ capacity: 7, refill_per_sec: 3 });
    const i = reg.inspect('agent-x', 'jira');
    expect(i.capacity).toBe(7);
    expect(i.refill_per_sec).toBe(3);
  });
});
