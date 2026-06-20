/**
 * In-flight OIDC state store.
 *
 * The state, nonce, and code_verifier for an in-progress login are kept
 * server-side, keyed by the `state` parameter. We never trust the state
 * parameter alone — the IdP echoes it back to us, and we look up the
 * matching server-side record. The record is short-lived (10 min).
 */

import { createHash, randomBytes } from 'node:crypto';

export interface PendingLogin {
  state: string;
  nonce: string;
  code_verifier: string;
  code_challenge: string;
  tenant_id: string;
  trace_id: string;
  /** When the state was created (epoch ms). Used for TTL eviction. */
  created_at: number;
}

export interface StateStore {
  create(input: { tenant_id: string; trace_id: string }): Promise<PendingLogin>;
  consume(state: string): Promise<PendingLogin | null>;
  size(): number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export class InMemoryStateStore implements StateStore {
  private readonly byState = new Map<string, PendingLogin>();

  async create(input: { tenant_id: string; trace_id: string }): Promise<PendingLogin> {
    this.evict();
    const state = randomBytes(16).toString('hex');
    const code_verifier = randomBytes(32).toString('base64url');
    const code_challenge = createHash('sha256').update(code_verifier).digest('base64url');
    const pending: PendingLogin = {
      state,
      nonce: randomBytes(16).toString('hex'),
      code_verifier,
      code_challenge,
      tenant_id: input.tenant_id,
      trace_id: input.trace_id,
      created_at: Date.now(),
    };
    this.byState.set(state, pending);
    return pending;
  }

  async consume(state: string): Promise<PendingLogin | null> {
    this.evict();
    const pending = this.byState.get(state);
    if (!pending) return null;
    this.byState.delete(state); // one-shot
    return pending;
  }

  size(): number {
    return this.byState.size;
  }

  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.byState.entries()) {
      if (now - v.created_at > TTL_MS) this.byState.delete(k);
    }
  }
}
