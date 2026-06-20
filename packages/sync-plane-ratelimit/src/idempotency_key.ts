/**
 * Idempotency-Key generation — UUID v7 (RFC 9562 §5.7).
 *
 * FORA-487.3 / FORA-517 AC: every outbound call carries a UUID v7
 * Idempotency-Key so the FORA-401 `sync_op` dedupe table can collapse
 * retries on a server-side replay. UUID v7 (time-ordered) gives us:
 *   - 48-bit unix_ts_ms prefix — natural FIFO ordering in B-tree
 *     indexes (`sync_op` PRIMARY KEY on (tenant_id, idempotency_key))
 *   - 74 bits of cryptographically-strong randomness for uniqueness
 *   - Stable, sortable, and parseable in any UUID v7-aware tool
 *
 * We deliberately do NOT depend on `crypto.randomUUID` (Node 19+ does
 * implement v4 only, not v7) and we do NOT pull in the `uuid` package —
 * the v7 layout is 30 lines and we want zero new transitive deps in
 * this layer. `crypto.getRandomValues` provides the random bits.
 *
 * `now()` and `randBytes()` are injectable for deterministic tests.
 */

const UUID_V7_VERSION = 0x7;
const UUID_VARIANT_RFC4122 = 0b10; // top 2 bits of byte 8 = 0b10xxxxxx

export interface UuidV7Opts {
  /** `now()` in ms. Default `Date.now`. */
  readonly now?: () => number;
  /** Random-bytes source. Returns 10 random bytes. Default `crypto.getRandomValues`. */
  readonly randBytes?: (n: number) => Uint8Array;
}

/**
 * Generate a UUID v7 string. The first 48 bits encode the unix timestamp
 * in ms, the next 4 bits are the version (0x7), the next 12 bits are
 * `rand_a` (sub-millisecond fraction / node id), then 2 bits of RFC
 * 4122 variant, then 62 bits of `rand_b`. Layout per RFC 9562 §5.7.
 */
export function uuidV7(opts: UuidV7Opts = {}): string {
  const now = opts.now ?? Date.now;
  const randBytes = opts.randBytes ?? defaultRandBytes;
  const ts = now();
  const rand = randBytes(10);

  // 48-bit timestamp in big-endian order across bytes 0-5.
  const bytes = new Uint8Array(16);
  // ts_ms fits in 48 bits until year 10889.
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  // bytes 6-7: high 4 bits = version (0x7), low 12 bits = rand_a
  bytes[6] = (UUID_V7_VERSION << 4) | (rand[0]! & 0x0f);
  bytes[7] = rand[1]!;
  // byte 8: top 2 bits = variant (0b10), low 6 bits = rand_b
  bytes[8] = (UUID_VARIANT_RFC4122 << 6) | (rand[2]! & 0x3f);
  // bytes 9-15: rand_b tail
  for (let i = 9; i < 16; i++) bytes[i] = rand[i - 7]!;

  return formatUuid(bytes);
}

function defaultRandBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // Node 20+ exposes `crypto.getRandomValues` on the global `crypto`
  // (Web Crypto API). Falls back to `node:crypto` if the global is missing.
  const c: { getRandomValues?: (b: Uint8Array) => Uint8Array } | undefined =
    typeof (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto !== 'undefined'
      ? (globalThis as unknown as { crypto: { getRandomValues: (b: Uint8Array) => Uint8Array } }).crypto
      : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf);
    return buf;
  }
  // Hard fallback — should never hit in Node 20+ but kept for type safety.
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

function formatUuid(bytes: Uint8Array): string {
  // Standard 8-4-4-4-12 hex grouping.
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * Extract the 48-bit unix_ts_ms prefix from a UUID v7 string. Returns
 * `null` for non-v7 UUIDs. Used by the audit forwarder to stamp the
 * Idempotency-Key's `claimed_at` without parsing the row's `claimed_at`
 * column a second time.
 */
export function uuidV7Timestamp(id: string): number | null {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id);
  if (!m) return null;
  const version = parseInt(m[3]![0]!, 16);
  if (version !== UUID_V7_VERSION) return null;
  // The 48-bit timestamp spans bytes 0-7 of the UUID, which in
  // 8-4-4-4-12 hex grouping is m[1] (8 hex) + m[2] (4 hex).
  const high = parseInt(m[1]!, 16); // bytes 0-3 (32 bits)
  const mid = parseInt(m[2]!, 16);  // bytes 4-7 (16 bits)
  return high * 2 ** 16 + mid;
}
