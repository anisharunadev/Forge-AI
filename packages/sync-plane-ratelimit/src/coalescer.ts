/**
 * Composite-edit coalescer — N consecutive outbound edits within a
 * W-second window collapse to a single composite edit.
 *
 * Implements FORA-256 §"Scope" / AC #3 and ADR-0010 §8.2 R-SYNC-03
 * (comment storm DoS). When two human commenters, three CI bots, and
 * a sync reconciliation all try to update the same Jira issue in
 * quick succession, the downstream platform should see ONE composite
 * edit, not six.
 *
 * The coalescer is keyed by
 *   `${tenant_id}|${platform}|${remote_issue_id}|${edit_kind}`
 * so different edit kinds (comment vs. status change) are NOT merged —
 * the audit trail must distinguish them.
 *
 * `W` is configurable per the platform adapter; the default is 30s.
 * `now()` is injectable so the smoke test can compress seconds to ms.
 *
 * The coalescer is pure data + timer logic. No network. The actual
 * `platformCall` is injected by the caller (see `outbound.ts`).
 */

export type PlatformId = 'jira' | 'github' | 'clickup';

export type EditKind = 'comment' | 'status' | 'assignee' | 'field';

export interface OutboundEdit {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly platform: PlatformId;
  readonly remote_issue_id: string;
  readonly edit_kind: EditKind;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly enqueued_at_ms: number;
}

export interface CoalesceConfig {
  /** Coalesce window in ms. Edits within W of the first collapse. */
  readonly window_ms: number;
  /** `now()` injection for tests. */
  readonly now?: () => number;
  /** Caller-supplied flush function. */
  readonly flush: (merged: CompositeEdit) => Promise<CoalesceFlushResult>;
}

export interface CompositeEdit {
  readonly key: string;
  readonly tenant_id: string;
  readonly platform: PlatformId;
  readonly remote_issue_id: string;
  readonly edit_kind: EditKind;
  /** Number of source edits that were merged into this composite. */
  readonly source_count: number;
  /** Original event ids in arrival order. */
  readonly source_event_ids: readonly string[];
  /** Merged body. */
  readonly body: string;
  /** Window the first and last edits fell in (ms). */
  readonly window_first_ms: number;
  readonly window_last_ms: number;
}

export interface CoalesceFlushResult {
  /** True if the platform accepted the composite edit. */
  readonly ok: boolean;
  /** HTTP-style status, or 'coalesced_queued' if the adapter buffered. */
  readonly status: number | string;
  /** Per-source event results, in the same order as `source_event_ids`. */
  readonly per_event?: ReadonlyArray<{ event_id: string; ok: boolean }>;
}

interface PendingBuffer {
  edits: OutboundEdit[];
  deadline_ms: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class Coalescer {
  private readonly buffers = new Map<string, PendingBuffer>();
  private readonly window_ms: number;
  private readonly now: () => number;
  private readonly flush: (merged: CompositeEdit) => Promise<CoalesceFlushResult>;
  /** Stats for the audit / smoke. */
  private stats = { enqueued: 0, coalesced_into: 0, flushed: 0 };

  constructor(cfg: CoalesceConfig) {
    if (cfg.window_ms <= 0) throw new Error('coalescer: window_ms must be > 0');
    this.window_ms = cfg.window_ms;
    this.now = cfg.now ?? Date.now;
    this.flush = cfg.flush;
  }

  /**
   * Enqueue an outbound edit. Returns immediately with
   * `coalesced: true` if the edit was appended to a pending composite,
   * or `coalesced: false` if it is the first of a new composite
   * (which will be flushed after W).
   */
  enqueue(edit: OutboundEdit): { coalesced: boolean; key: string } {
    const key = this.keyOf(edit);
    const existing = this.buffers.get(key);
    this.stats.enqueued += 1;
    if (existing) {
      existing.edits.push(edit);
      // Reset the deadline on each new edit so a steady stream keeps
      // the composite alive. (Equivalent to "trailing-edge debounce".)
      if (existing.timer) clearTimeout(existing.timer);
      existing.deadline_ms = this.now() + this.window_ms;
      existing.timer = this.scheduleFlush(key, existing);
      this.stats.coalesced_into += 1;
      return { coalesced: true, key };
    }
    const buffer: PendingBuffer = {
      edits: [edit],
      deadline_ms: this.now() + this.window_ms,
      timer: null,
    };
    buffer.timer = this.scheduleFlush(key, buffer);
    this.buffers.set(key, buffer);
    return { coalesced: false, key };
  }

  /**
   * Flush a specific key immediately. Returns the composite (whether
   * or not the platform call succeeded). Test / shutdown seam.
   */
  async flushKey(key: string): Promise<CompositeEdit | null> {
    const buf = this.buffers.get(key);
    if (!buf) return null;
    if (buf.timer) clearTimeout(buf.timer);
    this.buffers.delete(key);
    return await this.doFlush(key, buf);
  }

  /**
   * Force-flush all pending buffers. Returns the number of composites
   * that were emitted. Test / shutdown seam.
   */
  async drain(): Promise<number> {
    const keys = Array.from(this.buffers.keys());
    await Promise.all(keys.map((k) => this.flushKey(k)));
    return keys.length;
  }

  /** Read-only stats (for audit / smoke). */
  getStats(): { enqueued: number; coalesced_into: number; flushed: number } {
    return { ...this.stats };
  }

  /** Number of pending buffers (test seam). */
  pendingCount(): number {
    return this.buffers.size;
  }

  private scheduleFlush(key: string, buf: PendingBuffer): ReturnType<typeof setTimeout> {
    const delay = Math.max(0, buf.deadline_ms - this.now());
    return setTimeout(() => {
      // Remove from map first so a re-entrant enqueue during flush
      // starts a fresh composite.
      this.buffers.delete(key);
      void this.doFlush(key, buf);
    }, delay);
  }

  private async doFlush(key: string, buf: PendingBuffer): Promise<CompositeEdit> {
    const edits = buf.edits;
    const composite: CompositeEdit = {
      key,
      tenant_id: edits[0]!.tenant_id,
      platform: edits[0]!.platform,
      remote_issue_id: edits[0]!.remote_issue_id,
      edit_kind: edits[0]!.edit_kind,
      source_count: edits.length,
      source_event_ids: edits.map((e) => e.event_id),
      body: edits.map((e) => e.body).join('\n\n---\n\n'),
      window_first_ms: edits[0]!.enqueued_at_ms,
      window_last_ms: edits[edits.length - 1]!.enqueued_at_ms,
    };
    this.stats.flushed += 1;
    await this.flush(composite);
    return composite;
  }

  private keyOf(edit: OutboundEdit): string {
    return [edit.tenant_id, edit.platform, edit.remote_issue_id, edit.edit_kind].join('|');
  }
}
