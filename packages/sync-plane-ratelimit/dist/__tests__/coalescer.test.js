/**
 * Coalescer — composite-edit coalescing tests.
 * FORA-256 AC #3: N consecutive edits on the same remote issue within
 * W seconds collapse to a single composite edit (audit row shows the
 * original N events).
 */
import { describe, it, expect, vi } from 'vitest';
import { Coalescer } from '../coalescer.js';
function edit(i, overrides = {}) {
    return {
        event_id: `e${i}`,
        tenant_id: 'tenant-A',
        platform: 'jira',
        remote_issue_id: 'JIRA-100',
        edit_kind: 'comment',
        body: `body ${i}`,
        enqueued_at_ms: i * 10,
        ...overrides,
    };
}
describe('Coalescer', () => {
    it('merges N edits within the window into a single composite', async () => {
        vi.useFakeTimers();
        let now = 1_000_000;
        const flush = vi.fn(async (c) => ({ ok: true, status: 200, per_event: c.source_event_ids.map((e) => ({ event_id: e, ok: true })) }));
        const c = new Coalescer({ window_ms: 30_000, now: () => now, flush });
        for (let i = 0; i < 5; i++) {
            const r = c.enqueue(edit(i));
            if (i === 0)
                expect(r.coalesced).toBe(false);
            else
                expect(r.coalesced).toBe(true);
        }
        expect(c.pendingCount()).toBe(1);
        expect(flush).not.toHaveBeenCalled();
        now += 30_001;
        await vi.advanceTimersByTimeAsync(30_001);
        expect(flush).toHaveBeenCalledTimes(1);
        const merged = flush.mock.calls[0][0];
        expect(merged.source_count).toBe(5);
        expect(merged.source_event_ids).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
        expect(merged.body).toContain('body 0');
        expect(merged.body).toContain('body 4');
        expect(merged.body).toContain('---');
        expect(c.pendingCount()).toBe(0);
        vi.useRealTimers();
    });
    it('does NOT merge across edit_kind or remote_issue_id', async () => {
        vi.useFakeTimers();
        let now = 1_000_000;
        const flush = vi.fn(async () => ({ ok: true, status: 200 }));
        const c = new Coalescer({ window_ms: 30_000, now: () => now, flush });
        c.enqueue(edit(0));
        c.enqueue(edit(1, { remote_issue_id: 'JIRA-200' })); // different issue
        c.enqueue(edit(2, { edit_kind: 'status' })); // different kind
        c.enqueue(edit(3, { tenant_id: 'tenant-B' })); // different tenant
        c.enqueue(edit(4, { platform: 'github' })); // different platform
        expect(c.pendingCount()).toBe(5);
        now += 30_001;
        await vi.advanceTimersByTimeAsync(30_001);
        expect(flush).toHaveBeenCalledTimes(5);
        vi.useRealTimers();
    });
    it('debounces — last edit within W resets the deadline', async () => {
        // Use real timers with a small window so the test runs quickly.
        // Inject `now` for predictable deadline math, but rely on the
        // actual setTimeout in the coalescer.
        let now = 0;
        const flush = vi.fn(async () => ({ ok: true, status: 200 }));
        const c = new Coalescer({ window_ms: 50, now: () => now, flush });
        c.enqueue(edit(0, { enqueued_at_ms: 0 }));
        await new Promise((r) => setTimeout(r, 20));
        now = 20;
        c.enqueue(edit(1, { enqueued_at_ms: 20 }));
        await new Promise((r) => setTimeout(r, 20));
        now = 40;
        c.enqueue(edit(2, { enqueued_at_ms: 40 }));
        // Total elapsed ≈ 40ms, well under the 50ms reset window — must
        // not have flushed yet.
        expect(flush).not.toHaveBeenCalled();
        // Wait past the new deadline (50ms after the last enqueue at t=40).
        await new Promise((r) => setTimeout(r, 80));
        expect(flush).toHaveBeenCalledTimes(1);
        const merged = flush.mock.calls[0][0];
        expect(merged.source_count).toBe(3);
    });
    it('drain() flushes all pending composites', async () => {
        const flush = vi.fn(async () => ({ ok: true, status: 200 }));
        const c = new Coalescer({ window_ms: 30_000, flush });
        c.enqueue(edit(0));
        c.enqueue(edit(1, { remote_issue_id: 'JIRA-200' }));
        c.enqueue(edit(2, { edit_kind: 'status' }));
        expect(c.pendingCount()).toBe(3);
        const n = await c.drain();
        expect(n).toBe(3);
        expect(flush).toHaveBeenCalledTimes(3);
        expect(c.pendingCount()).toBe(0);
    });
    it('rejects bad configuration', () => {
        expect(() => new Coalescer({ window_ms: 0, flush: async () => ({ ok: true, status: 200 }) })).toThrow();
    });
});
//# sourceMappingURL=coalescer.test.js.map