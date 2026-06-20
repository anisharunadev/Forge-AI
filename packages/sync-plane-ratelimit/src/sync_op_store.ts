/**
 * sync_op store interface — Idempotency-Key dedupe primitive.
 *
 * FORA-487.3 / FORA-517 AC: the backoff scheduler persists every
 * outbound call's `(connector_id, idempotency_key) → {result, status}`
 * mapping in the FORA-401 `sync_op` table. A replay of the same
 * (connector_id, idempotency_key) short-circuits with the cached
 * result — at-most-once semantics for non-idempotent HTTP verbs
 * (POST / DELETE / mutation) and at-least-zero replays for idempotent
 * verbs (GET / list / read).
 *
 * The FORA-401 spine (`apps/jira-adapter/src/idempotency.ts`) lives in
 * the jira-adapter package; this interface is the dependency-inversion
 * seam that lets `@fora/sync-plane-ratelimit` reuse the pattern without
 * importing the jira-adapter directly (which would invert the
 * FORA-487 / FORA-200 dependency direction).
 *
 * Production wiring: implement this against the FORA-401 `sync_op`
 * table (`migrations/0008_jira_adapter.sql`). Test wiring: the
 * `InMemorySyncOpStore` below is what the property tests assert on.
 */

export interface SyncOpRecord {
  readonly result: unknown;
  readonly status: number;
  /** Wall-clock claim time (ms since epoch). */
  readonly claimed_at_ms: number;
}

export interface SyncOpStore {
  /**
   * Return the cached record for `(connector_id, idempotency_key)`, or
   * `null` if no such row exists. The backoff scheduler calls this
   * BEFORE invoking the platform adapter so a replay short-circuits.
   */
  getIfPresent(connector_id: string, idempotency_key: string): Promise<SyncOpRecord | null>;

  /**
   * Persist `(connector_id, idempotency_key) → {result, status}`. Called
   * AFTER a successful platform response (or a deterministic final
   * failure) so the next replay returns the cached outcome.
   */
  put(
    connector_id: string,
    idempotency_key: string,
    record: SyncOpRecord,
  ): Promise<void>;
}

/**
 * In-memory `SyncOpStore` for unit + integration tests. Not safe for
 * production (no persistence, no RLS, no cross-tenant boundary). The
 * production wiring is a `PgSyncOpStore` adapter against the
 * `migrations/0008_jira_adapter.sql` `sync_op` table — out of scope
 * for this package per the FORA-200.5 / FORA-401 ownership line.
 */
export class InMemorySyncOpStore implements SyncOpStore {
  private readonly rows = new Map<string, SyncOpRecord>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  async getIfPresent(connector_id: string, idempotency_key: string): Promise<SyncOpRecord | null> {
    return this.rows.get(this.keyOf(connector_id, idempotency_key)) ?? null;
  }

  async put(connector_id: string, idempotency_key: string, record: SyncOpRecord): Promise<void> {
    this.rows.set(this.keyOf(connector_id, idempotency_key), { ...record, claimed_at_ms: record.claimed_at_ms || this.now() });
  }

  /** Test seam: number of cached rows. */
  size(): number {
    return this.rows.size;
  }

  /** Test seam: clear all rows. */
  clear(): void {
    this.rows.clear();
  }

  private keyOf(connector_id: string, idempotency_key: string): string {
    return `${connector_id}|${idempotency_key}`;
  }
}
