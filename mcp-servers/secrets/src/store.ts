/**
 * Backing-store interface for the secrets-mcp.
 *
 * Per ADR-0003 §7, the v1 backing store is AWS Secrets Manager.
 * A future ADR will add HashiCorp Vault; the interface below is the
 * contract both backings honour. The interface is intentionally
 * narrow: `read` returns a `SecretVersion` payload (raw value +
 * per-version metadata) and `rotate` writes a new version and
 * returns the version id.
 *
 * The interface does NOT take a `tenant_id` directly — the
 * `SecretRef` carries it, and the backing store is responsible for
 * routing to the right per-tenant secret. That keeps the
 * `tenant_id` claim in the secret_ref as the single source of truth
 * and prevents the model from smuggling a different tenant at the
 * tool boundary.
 *
 * Implementations MUST NOT log the raw value. They MAY log
 * `secret_ref`, `version`, and `fingerprint` for audit. They MUST
 * reject cross-tenant reads: a `SecretRef` whose `tenant_id` does
 * not match the broker's `tenant_id` claim is a programming error
 * and MUST throw `TenantScopeError`.
 */

import type { SecretRef } from "./secret_ref.js";

export interface SecretVersion {
  /** The raw value, byte-for-byte. The store returns this to the
   *  broker only; the broker redacts before returning to the agent. */
  value: string;
  /** The version id assigned by the backing store (e.g. the AWS
   *  Secrets Manager version id, or a Vault KV v2 metadata version). */
  version: string;
  /** ISO-8601 timestamp at which this version was created. */
  created_at: string;
  /** ISO-8601 timestamp at which this version is no longer valid.
   *  Backing-store defined: AWS SM versions do not expire by default
   *  (we set the value at write time); Vault leases do. */
  expires_at: string;
}

export interface SecretStore {
  /** Read a specific version of a secret. Throws on cross-tenant,
   *  not-found, or backing-store error. The broker is responsible
   *  for redaction — the store returns the raw value. */
  read(ref: SecretRef, tenantClaim: string): Promise<SecretVersion>;
  /** Rotate a secret. Writes a new version and returns the new
   *  version id. The old version is NOT removed. */
  rotate(
    ref: SecretRef,
    tenantClaim: string,
    newValue: string,
  ): Promise<{ version: string; created_at: string }>;
}

export class TenantScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on tenant '${requested}' — broker claim is for tenant '${allowed}'.`,
    );
    this.name = "TenantScopeError";
  }
}

export class SecretNotFoundError extends Error {
  constructor(public readonly ref: SecretRef) {
    super(`Secret not found: ${ref.tenant_id}/${ref.name}@${ref.version}`);
    this.name = "SecretNotFoundError";
  }
}

/**
 * In-memory store used by the smoke test and by unit tests. It is
 * NEVER the production backing store — production is AWS Secrets
 * Manager, behind a future FORA-128 child issue. The in-memory
 * store is here to prove the redacted-envelope contract and the
 * per-tenant boundary without depending on AWS.
 */
export class InMemorySecretStore implements SecretStore {
  private readonly data: Map<string, SecretVersion[]> = new Map();

  constructor(seed: Record<string, SecretVersion[]> = {}) {
    for (const [key, versions] of Object.entries(seed)) {
      this.data.set(key, [...versions]);
    }
  }

  async read(ref: SecretRef, tenantClaim: string): Promise<SecretVersion> {
    this.assertTenant(ref, tenantClaim);
    const versions = this.data.get(this.key(ref)) ?? [];
    const v = this.pickVersion(versions, ref.version);
    if (!v) throw new SecretNotFoundError(ref);
    return v;
  }

  async rotate(
    ref: SecretRef,
    tenantClaim: string,
    newValue: string,
  ): Promise<{ version: string; created_at: string }> {
    this.assertTenant(ref, tenantClaim);
    const key = this.key(ref);
    const versions = this.data.get(key) ?? [];
    const nextVersionId = String(versions.length + 1);
    const now = new Date().toISOString();
    const next: SecretVersion = {
      value: newValue,
      version: nextVersionId,
      created_at: now,
      expires_at: "9999-12-31T23:59:59.000Z",
    };
    versions.push(next);
    this.data.set(key, versions);
    return { version: nextVersionId, created_at: now };
  }

  private assertTenant(ref: SecretRef, tenantClaim: string): void {
    if (ref.tenant_id !== tenantClaim) {
      throw new TenantScopeError(ref.tenant_id, tenantClaim);
    }
  }

  private key(ref: SecretRef): string {
    return `${ref.tenant_id}/${ref.name}`;
  }

  private pickVersion(versions: SecretVersion[], want: string): SecretVersion | null {
    if (versions.length === 0) return null;
    if (want === "latest") return versions[versions.length - 1] ?? null;
    return versions.find((v) => v.version === want) ?? null;
  }
}
