/**
 * Tenant-scoped AuditFetcher wrapper — FORA-393 Plan 1 §3.12 + memory/security.md §6.
 *
 * Wraps any {@link AuditFetcher} so every node returned carries a
 * `tenant_id` attribute that matches the configured `tenantId`. This is the
 * single point that enforces the "no cross-tenant leak" AC: if the upstream
 * fetcher returns a node for a different tenant, we drop it on the floor
 * before it reaches the provider / canvas / DOM.
 *
 * The runtime AuditFetcher impl is the source of truth for tenant scope.
 * This wrapper is a defense-in-depth layer that catches a misbehaving
 * fetcher at the renderer boundary — and is unit-testable in isolation
 * without a real backend.
 */

import type { AuditFetcher } from "../graph/providers/audit";
import type { AuditEdge, AuditNode } from "../graph/nodes";

export interface TenantScopedAuditFetcherOptions {
  readonly tenantId: string;
}

export class TenantScopedAuditFetcher implements AuditFetcher {
  readonly #inner: AuditFetcher;
  readonly #tenantId: string;

  constructor(inner: AuditFetcher, opts: TenantScopedAuditFetcherOptions) {
    if (!opts.tenantId) {
      throw new Error("TenantScopedAuditFetcher requires a non-empty tenantId");
    }
    this.#inner = inner;
    this.#tenantId = opts.tenantId;
  }

  /** Read-only accessor for the configured tenant (used by tests + the center composer). */
  get tenantId(): string {
    return this.#tenantId;
  }

  async listEntries(): Promise<ReadonlyArray<AuditNode>> {
    return filterByTenant(await this.#inner.listEntries(), this.#tenantId);
  }

  async listActors(): Promise<ReadonlyArray<AuditNode>> {
    return filterByTenant(await this.#inner.listActors(), this.#tenantId);
  }

  async listTenants(): Promise<ReadonlyArray<AuditNode>> {
    return filterByTenant(await this.#inner.listTenants(), this.#tenantId);
  }

  async listTimeBuckets(): Promise<ReadonlyArray<AuditNode>> {
    return filterByTenant(await this.#inner.listTimeBuckets(), this.#tenantId);
  }

  async listEdges(): Promise<ReadonlyArray<AuditEdge>> {
    const allowed = new Set<string>([
      ...(await this.listEntries()).map((n) => n.id),
      ...(await this.listActors()).map((n) => n.id),
      ...(await this.listTenants()).map((n) => n.id),
      ...(await this.listTimeBuckets()).map((n) => n.id),
    ]);
    const edges = await this.#inner.listEdges();
    return edges.filter((e) => allowed.has(e.source) && allowed.has(e.target));
  }
}

/**
 * Drop any node whose `subtitle` does not include `tenant:<tenantId>`.
 *
 * The runtime AuditFetcher encodes the tenant on each node's subtitle as
 * `tenant:<tenantId>` (Plan 4 §3.9 reference + memory/security.md §6 audit
 * log). The substring match is intentional: nodes with no tenant subtitle
 * (e.g. global actors) are dropped, since the Audit Center is a per-tenant
 * surface and the AC is "no cross-tenant leak."
 */
function filterByTenant(
  nodes: ReadonlyArray<AuditNode>,
  tenantId: string,
): ReadonlyArray<AuditNode> {
  const tag = `tenant:${tenantId}`;
  return nodes.filter((n) => typeof n.subtitle === "string" && n.subtitle.includes(tag));
}
