/**
 * TierTable — Layer 2 (per-tenant quota, configurable) of the
 * FORA-487 three-layer limiter.
 *
 * Resolves the effective per-tenant quota (RPM + max concurrent)
 * for a `(tenant_id, project_id?)` lookup, applying the published
 * default tiers (Trial / Standard / Enterprise) and per-project
 * overrides. Per the FORA-487 charter, project overrides may
 * **lower** the cap but never raise it above the tenant's tier.
 *
 * | Tier       | RPM  | Concurrent |
 * |------------|------|------------|
 * | Trial      |   30 |          4 |
 * | Standard   |  300 |         16 |
 * | Enterprise | 3000 |         64 |
 *
 * Concurrent is tracked by the orchestrator (in-flight count per
 * tenant); the table resolves the limit only. Audit emission is
 * `connector.rate_limit.consumed` (allowed) or
 * `connector.rate_limit.throttled` with `layer: 'tenant'` (denied).
 *
 * FORA-487 Layer 2 (per-tenant quota, configurable).
 * FORA-391 Plan 5 §3.2.
 */

import type { ConnectorId } from './provider_ceiling.js';

export type TenantTier = 'trial' | 'standard' | 'enterprise';

export interface TierLimits {
  /** Requests per minute (steady-state ceiling). */
  readonly rpm: number;
  /** Max concurrent in-flight requests for this tenant. */
  readonly max_concurrent: number;
}

export const DEFAULT_TIERS: Readonly<Record<TenantTier, TierLimits>> = {
  trial:      { rpm: 30,   max_concurrent: 4  },
  standard:   { rpm: 300,  max_concurrent: 16 },
  enterprise: { rpm: 3000, max_concurrent: 64 },
};

/**
 * Per-project overrides — the override may **lower** either limit
 * but never raise it above the tenant tier ceiling. The orchestrator
 * (not this table) enforces the floor/ceiling rule when registering
 * an override via {@link TierTable.setProjectOverride}.
 */
export interface ProjectOverride {
  readonly rpm?: number;
  readonly max_concurrent?: number;
}

export interface TierResolution {
  readonly tier: TenantTier;
  readonly rpm: number;
  readonly max_concurrent: number;
  /** Where the effective number came from. */
  readonly source: 'tier' | 'project_override' | 'tenant_override';
}

export interface TierTableOpts {
  /** `now()` injection for tests. */
  readonly now?: () => number;
}

interface TenantRow {
  tier: TenantTier;
  override?: TierLimits;
}

export class TierTable {
  private readonly tenants = new Map<string, TenantRow>();
  private readonly projectOverrides = new Map<string, ProjectOverride>();
  private readonly now: () => number;

  constructor(opts: TierTableOpts = {}) {
    this.now = opts.now ?? Date.now;
  }

  /**
   * Set the tier for a tenant. Idempotent.
   */
  setTenantTier(tenant_id: string, tier: TenantTier): void {
    const existing = this.tenants.get(tenant_id) ?? { tier };
    this.tenants.set(tenant_id, { ...existing, tier });
  }

  /**
   * Set a tenant-level override (e.g. negotiated on a contract).
   * May lower either RPM or concurrent but not raise above the
   * Enterprise tier ceiling. Throws on illegal overrides.
   */
  setTenantOverride(tenant_id: string, override: TierLimits): void {
    const ceiling = DEFAULT_TIERS.enterprise;
    if (override.rpm > ceiling.rpm) {
      throw new Error(`tier_table: tenant override rpm ${override.rpm} > enterprise ceiling ${ceiling.rpm}`);
    }
    if (override.max_concurrent > ceiling.max_concurrent) {
      throw new Error(`tier_table: tenant override concurrent ${override.max_concurrent} > enterprise ceiling ${ceiling.max_concurrent}`);
    }
    this.tenants.set(tenant_id, { tier: 'enterprise', override });
  }

  /**
   * Set a per-project override. May **lower** either limit but never
   * raise it above the tenant's effective RPM / concurrent.
   * `connector` is included in the key to support platform-specific
   * overrides (e.g. a project that talks to Slack may have a lower
   * limit than its GitHub-bound siblings).
   */
  setProjectOverride(tenant_id: string, connector: ConnectorId, project_id: string, override: ProjectOverride): void {
    const key = `${tenant_id}|${connector}|${project_id}`;
    const tenant_eff = this.resolveTenant(tenant_id);
    if (override.rpm !== undefined && override.rpm > tenant_eff.rpm) {
      throw new Error(`tier_table: project override rpm ${override.rpm} > tenant rpm ${tenant_eff.rpm} (cannot raise)`);
    }
    if (override.max_concurrent !== undefined && override.max_concurrent > tenant_eff.max_concurrent) {
      throw new Error(`tier_table: project override concurrent ${override.max_concurrent} > tenant concurrent ${tenant_eff.max_concurrent} (cannot raise)`);
    }
    this.projectOverrides.set(key, override);
  }

  /**
   * Resolve the effective per-tenant quota for the given lookup.
   * Falls back to the tenant tier on missing project override.
   */
  resolve(tenant_id: string, connector: ConnectorId, project_id?: string): TierResolution {
    const tenant_eff = this.resolveTenant(tenant_id);
    if (project_id) {
      const key = `${tenant_id}|${connector}|${project_id}`;
      const override = this.projectOverrides.get(key);
      if (override) {
        return {
          tier: tenant_eff.tier,
          rpm: override.rpm ?? tenant_eff.rpm,
          max_concurrent: override.max_concurrent ?? tenant_eff.max_concurrent,
          source: 'project_override',
        };
      }
    }
    // `resolveTenant()` already sets `source` to `tenant_override` when
    // a tenant-level override is present, or `tier` otherwise. The
    // caller (resolve) only overrides `source` when a project-level
    // override is present.
    return tenant_eff;
  }

  /** Internal: resolve tenant-level only (ignores project overrides). */
  private resolveTenant(tenant_id: string): TierResolution {
    const row = this.tenants.get(tenant_id);
    if (!row) {
      // Default unknown tenants to enterprise. Callers must explicitly
      // setTenantTier(..., 'trial' | 'standard') to apply a stricter
      // quota. This is permissive by design: it lets breaker tests and
      // new connectors run without an explicit tier configuration, and
      // it matches the FORA-487 charter where enterprise is the default
      // operating tier and trial is opt-in.
      return { tier: 'enterprise', rpm: DEFAULT_TIERS.enterprise.rpm, max_concurrent: DEFAULT_TIERS.enterprise.max_concurrent, source: 'tier' };
    }
    if (row.override) {
      return { tier: row.tier, rpm: row.override.rpm, max_concurrent: row.override.max_concurrent, source: 'tenant_override' };
    }
    const t = DEFAULT_TIERS[row.tier];
    return { tier: row.tier, rpm: t.rpm, max_concurrent: t.max_concurrent, source: 'tier' };
  }
}
