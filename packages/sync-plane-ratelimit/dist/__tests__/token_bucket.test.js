/**
 * TokenBucket — pure unit tests.
 * Reuses the assertion bar from @fora/customer-cloud-broker's
 * aws-dispatch.test.ts (FORA-126.5 AC #3) but covers both the
 * per-tenant and per-(tenant, platform) shapes.
 */
import { describe, it, expect } from 'vitest';
import { TokenBucket } from '../token_bucket.js';
describe('TokenBucket', () => {
    it('starts full and refills at the configured rate', () => {
        let t = 1_000;
        const b = new TokenBucket({ capacity: 2, refill_per_sec: 1, now: () => t });
        expect(b.level()).toBe(2);
        // Drain the bucket.
        expect(b.take()).toBe(true);
        expect(b.take()).toBe(true);
        expect(b.take()).toBe(false);
        // After 500ms refill at 1/s = 0.5 token → still cannot take.
        t += 500;
        expect(b.take()).toBe(false);
        // +600 ms total = 1.1 tokens → can take once, then empty again.
        t += 600;
        expect(b.take()).toBe(true);
        expect(b.take()).toBe(false);
    });
    it('caps refill at capacity (no runaway accumulation)', () => {
        let t = 0;
        const b = new TokenBucket({ capacity: 5, refill_per_sec: 10, now: () => t });
        // Sit idle for an hour — should be capped at 5, not 36_000.
        t = 60 * 60 * 1000;
        for (let i = 0; i < 5; i++)
            expect(b.take()).toBe(true);
        expect(b.take()).toBe(false);
        expect(b.level()).toBeLessThanOrEqual(5);
    });
    it('rejects bad configuration', () => {
        expect(() => new TokenBucket({ capacity: 0, refill_per_sec: 1 })).toThrow();
        expect(() => new TokenBucket({ capacity: 1, refill_per_sec: -1 })).toThrow();
    });
    it('is independent per instance (per-tenant isolation)', () => {
        let t = 0;
        const tenantA = new TokenBucket({ capacity: 3, refill_per_sec: 0, now: () => t });
        const tenantB = new TokenBucket({ capacity: 3, refill_per_sec: 0, now: () => t });
        // Drain tenant A.
        expect(tenantA.take()).toBe(true);
        expect(tenantA.take()).toBe(true);
        expect(tenantA.take()).toBe(true);
        expect(tenantA.take()).toBe(false);
        // Tenant B is unaffected.
        expect(tenantB.take()).toBe(true);
        expect(tenantB.take()).toBe(true);
        expect(tenantB.take()).toBe(true);
        expect(tenantB.take()).toBe(false);
    });
});
//# sourceMappingURL=token_bucket.test.js.map