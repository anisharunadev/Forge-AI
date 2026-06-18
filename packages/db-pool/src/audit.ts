/**
 * @fora/db-pool — in-memory audit sink for tests.
 *
 * Production wiring reuses the identity-broker's `ForaAuditSink` (or the
 * FORA-36 append-only store). This module is the unit-test default; it
 * is intentionally tiny so the pool's audit calls can be asserted in
 * isolation without binding to a network sink.
 */

import type { AuditSink, TenancyAuditEvent } from './types.js';

export class InMemoryAuditSink implements AuditSink {
  private readonly events: TenancyAuditEvent[] = [];
  /**
   * Optional failure injector — every `append()` throws this error when
   * set. Tests can toggle this to assert that the pool still surfaces
   * the primary signal (the mismatch error) when the audit sink is down.
   */
  public fail_with: Error | null = null;

  async append(event: TenancyAuditEvent): Promise<void> {
    if (this.fail_with) {
      throw this.fail_with;
    }
    this.events.push(event);
  }

  async close(): Promise<void> {
    // no-op
  }

  all(): TenancyAuditEvent[] {
    return [...this.events];
  }
}
