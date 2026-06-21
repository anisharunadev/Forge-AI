/**
 * forge-ai/mcp-router — audit
 *
 * Minimal audit sink + the canonical `mcp.*` event shape. Mirrors the
 * `ForaAuditEvent` / `AuditSink` pair in `forge-ai/cache-broker`. The router
 * emits one event per resolve/invoke/register; emits are best-effort.
 */

import type { McpAuditEvent } from './types.js';

/** Sink interface — callers wire their own (JsonlAuditSink, FORA-36, etc.). */
export interface McpAuditSink {
  emit(event: McpAuditEvent): Promise<void> | void;
}

/** In-memory sink — captures events for assertions in tests. */
export class InMemoryAuditSink implements McpAuditSink {
  private readonly events: McpAuditEvent[] = [];
  emit(event: McpAuditEvent): void {
    this.events.push(event);
  }
  /** Snapshot of all emitted events (newest last). */
  snapshot(): readonly McpAuditEvent[] {
    return this.events.slice();
  }
  /** Number of events emitted. */
  count(): number {
    return this.events.length;
  }
  /** Filter helper for tests. */
  ofKind(kind: McpAuditEvent['kind']): readonly McpAuditEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }
  clear(): void {
    this.events.length = 0;
  }
}

/** Null sink — drops everything. The default when no sink is configured. */
export class NullAuditSink implements McpAuditSink {
  emit(_event: McpAuditEvent): void {
    // intentional no-op
  }
}

/** Default sink factory — returns NullAuditSink. Real deployments wire JSONL / FORA-36. */
export const defaultAuditSink = (): McpAuditSink => new NullAuditSink();