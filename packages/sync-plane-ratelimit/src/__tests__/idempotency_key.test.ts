/**
 * Idempotency-Key (UUID v7) tests (FORA-487.3 / FORA-517).
 *
 * AC coverage:
 *   - UUID v7 layout: 48-bit unix_ts_ms + 4-bit version 0x7 + RFC 4122 variant
 *   - Time-ordered: monotonic timestamps produce lexicographically orderable strings
 *   - Deterministic with injected `now` + `randBytes`
 *   - `uuidV7Timestamp` round-trips the embedded ms timestamp
 *   - Variant rejection: a v4 UUID does not extract as a v7 timestamp
 */

import { describe, it, expect } from 'vitest';
import { uuidV7, uuidV7Timestamp } from '../idempotency_key.js';

function fmt(n: number): string {
  return n.toString(16).padStart(2, '0');
}

describe('uuidV7', () => {
  it('produces an 8-4-4-4-12 hex string with the v7 marker in the right slot', () => {
    const id = uuidV7({ now: () => 1_700_000_000_000, randBytes: () => new Uint8Array(10).fill(0xab) });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The "7" is the version nibble; the variant nibble is 8/9/a/b.
  });

  it('encodes the injected timestamp in the first 48 bits', () => {
    const ts = 1_700_000_000_000;
    const id = uuidV7({ now: () => ts, randBytes: () => new Uint8Array(10).fill(0) });
    // First 12 hex chars (no dashes) encode the 48-bit ms timestamp.
    const hex = id.replace(/-/g, '');
    const recovered = Number.parseInt(hex.slice(0, 12), 16);
    expect(recovered).toBe(ts);
  });

  it('is monotonic — same `now` produces the same prefix', () => {
    const ts = 1_700_000_000_123;
    const a = uuidV7({ now: () => ts, randBytes: () => new Uint8Array(10).fill(0x01) });
    const b = uuidV7({ now: () => ts, randBytes: () => new Uint8Array(10).fill(0xff) });
    // The first 12 hex chars (timestamp) must be equal; the rest can differ.
    expect(a.replace(/-/g, '').slice(0, 12)).toBe(b.replace(/-/g, '').slice(0, 12));
    expect(a).not.toBe(b);
  });

  it('orders lexicographically by timestamp (FIFO in B-tree indexes)', () => {
    const a = uuidV7({ now: () => 1_700_000_000_000, randBytes: () => new Uint8Array(10).fill(0) });
    const b = uuidV7({ now: () => 1_700_000_001_000, randBytes: () => new Uint8Array(10).fill(0) });
    expect(a < b).toBe(true);
  });

  it('produces distinct IDs across many calls (collision check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) seen.add(uuidV7({ now: () => 1_700_000_000_000 + i, randBytes: () => new Uint8Array(10).fill(i & 0xff) }));
    expect(seen.size).toBe(1_000);
  });
});

describe('uuidV7Timestamp', () => {
  it('round-trips the embedded ms timestamp', () => {
    const ts = 1_700_000_000_123;
    const id = uuidV7({ now: () => ts, randBytes: () => new Uint8Array(10).fill(0) });
    expect(uuidV7Timestamp(id)).toBe(ts);
  });

  it('returns null for a v4 UUID', () => {
    const v4 = '00000000-0000-4000-8000-000000000000';
    expect(uuidV7Timestamp(v4)).toBeNull();
  });

  it('returns null for a malformed string', () => {
    expect(uuidV7Timestamp('not-a-uuid')).toBeNull();
    expect(uuidV7Timestamp('')).toBeNull();
  });

  it('round-trips an arbitrary timestamp at the year-2026 boundary', () => {
    const ts = Date.UTC(2026, 5, 20, 11, 30, 0); // 2026-06-20T11:30:00Z
    const id = uuidV7({ now: () => ts, randBytes: () => new Uint8Array(10) });
    expect(uuidV7Timestamp(id)).toBe(ts);
  });
});
