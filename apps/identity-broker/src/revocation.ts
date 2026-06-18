/**
 * In-memory revocation store.
 *
 * Two operations:
 *   - revoke_by_jti(jti)  — single access token is dead.
 *   - revoke_by_sub(sub)  — every token issued for this principal is dead.
 *
 * The store is bounded: entries are evicted at `exp`. Because the broker
 * also enforces `exp` on verify, an unrevoked-but-expired token is already
 * dead. The store is the *fast* path; verification is the *correct* path.
 *
 * Acceptance: revoking a user on the IdP side propagates within 60 seconds.
 * The broker calls revoke_by_sub on logout and on IdP-driven revocation
 * webhooks (out of scope for v1, but the API is here).
 */

export interface RevocationStore {
  revoke_by_jti(jti: string, exp: number): Promise<void>;
  revoke_by_sub(sub: string, until: number): Promise<void>;
  is_revoked_jti(jti: string): Promise<boolean>;
  is_revoked_sub(sub: string, now?: number): Promise<boolean>;
  size(): number;
}

export class InMemoryRevocationStore implements RevocationStore {
  private readonly revoked_jti = new Map<string, number>(); // jti → exp
  private readonly revoked_sub = new Map<string, number>(); // sub → until

  async revoke_by_jti(jti: string, exp: number): Promise<void> {
    this.evict();
    this.revoked_jti.set(jti, exp);
  }

  async revoke_by_sub(sub: string, until: number): Promise<void> {
    this.evict();
    this.revoked_sub.set(sub, until);
  }

  async is_revoked_jti(jti: string): Promise<boolean> {
    this.evict();
    return this.revoked_jti.has(jti);
  }

  async is_revoked_sub(sub: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
    this.evict();
    const until = this.revoked_sub.get(sub);
    if (until === undefined) return false;
    return until > now;
  }

  size(): number {
    return this.revoked_jti.size + this.revoked_sub.size;
  }

  private evict(): void {
    // Stored values are Unix seconds (consistent with JWT `exp`).
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.revoked_jti.entries()) {
      if (exp <= now) this.revoked_jti.delete(jti);
    }
    for (const [sub, until] of this.revoked_sub.entries()) {
      if (until <= now) this.revoked_sub.delete(sub);
    }
  }
}
