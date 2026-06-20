/**
 * Tenant user provisioning.
 *
 * On first login we materialize a `board_user` row from the IdP's id_token.
 * The row is keyed on (idp_id, id_token.sub) — this is the idempotency key.
 * Subsequent logins update last_login_at and any claim-derived fields
 * (email, name) but never create a second row.
 *
 * v1 keeps this in memory. The persistence target is the platform Postgres
 * with RLS keyed on tenant_id (FORA-124 will own the migration).
 */

import { createHash } from 'node:crypto';

export interface BoardUser {
  idp_id: string;
  idp_sub: string; // The IdP's id_token.sub
  tenant_id: string;
  email: string;
  name: string;
  roles: string[];
  scopes: string[];
  created_at: string;
  last_login_at: string;
}

export interface ProvisioningStore {
  upsert(input: {
    idp_id: string;
    idp_sub: string;
    tenant_id: string;
    email: string;
    name: string;
    roles: string[];
    scopes: string[];
  }): Promise<{ user: BoardUser; created: boolean }>;
  findByIdpSub(idp_id: string, idp_sub: string): Promise<BoardUser | null>;
  findByTenantSub(tenant_id: string, idp_sub: string): Promise<BoardUser | null>;
  allForTenant(tenant_id: string): Promise<BoardUser[]>;
  delete(tenant_id: string, idp_sub: string): Promise<boolean>;
  size(): number;
}

export class InMemoryProvisioningStore implements ProvisioningStore {
  private readonly byIdpSub = new Map<string, BoardUser>();
  private readonly byTenantSub = new Map<string, BoardUser>();
  private readonly byTenant = new Map<string, Set<string>>(); // tenant_id → set of idp_sub

  private key(idp_id: string, idp_sub: string): string {
    return `${idp_id}::${idp_sub}`;
  }

  private tenantKey(tenant_id: string, idp_sub: string): string {
    return `${tenant_id}::${idp_sub}`;
  }

  async upsert(input: {
    idp_id: string;
    idp_sub: string;
    tenant_id: string;
    email: string;
    name: string;
    roles: string[];
    scopes: string[];
  }): Promise<{ user: BoardUser; created: boolean }> {
    const now = new Date().toISOString();
    const existing = this.byIdpSub.get(this.key(input.idp_id, input.idp_sub));
    if (existing) {
      const updated: BoardUser = {
        ...existing,
        email: input.email,
        name: input.name,
        roles: input.roles,
        scopes: input.scopes,
        last_login_at: now,
      };
      this.byIdpSub.set(this.key(input.idp_id, input.idp_sub), updated);
      this.byTenantSub.set(this.tenantKey(input.tenant_id, input.idp_sub), updated);
      return { user: updated, created: false };
    }
    const fresh: BoardUser = {
      idp_id: input.idp_id,
      idp_sub: input.idp_sub,
      tenant_id: input.tenant_id,
      email: input.email,
      name: input.name,
      roles: input.roles,
      scopes: input.scopes,
      created_at: now,
      last_login_at: now,
    };
    this.byIdpSub.set(this.key(input.idp_id, input.idp_sub), fresh);
    this.byTenantSub.set(this.tenantKey(input.tenant_id, input.idp_sub), fresh);
    const bucket = this.byTenant.get(input.tenant_id) ?? new Set<string>();
    bucket.add(input.idp_sub);
    this.byTenant.set(input.tenant_id, bucket);
    return { user: fresh, created: true };
  }

  async findByIdpSub(idp_id: string, idp_sub: string): Promise<BoardUser | null> {
    return this.byIdpSub.get(this.key(idp_id, idp_sub)) ?? null;
  }

  async findByTenantSub(tenant_id: string, idp_sub: string): Promise<BoardUser | null> {
    return this.byTenantSub.get(this.tenantKey(tenant_id, idp_sub)) ?? null;
  }

  async allForTenant(tenant_id: string): Promise<BoardUser[]> {
    const bucket = this.byTenant.get(tenant_id) ?? new Set<string>();
    return Array.from(bucket)
      .map((sub) => this.byTenantSub.get(this.tenantKey(tenant_id, sub)))
      .filter((u): u is BoardUser => u !== undefined);
  }

  async delete(tenant_id: string, idp_sub: string): Promise<boolean> {
    const tk = this.tenantKey(tenant_id, idp_sub);
    const user = this.byTenantSub.get(tk);
    if (!user) return false;
    this.byTenantSub.delete(tk);
    this.byIdpSub.delete(this.key(user.idp_id, idp_sub));
    this.byTenant.get(tenant_id)?.delete(idp_sub);
    return true;
  }

  size(): number {
    return this.byIdpSub.size;
  }
}

/** A stable opaque user id derived from the IdP sub. Not a secret. */
export function userIdFor(idp_id: string, idp_sub: string): string {
  return `usr_${createHash('sha256').update(`${idp_id}::${idp_sub}`).digest('hex').slice(0, 16)}`;
}
