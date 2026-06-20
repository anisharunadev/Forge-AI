/**
 * TierTable — Layer 2 (per-tenant quota, configurable) tests.
 * FORA-487 v0.3 / FORA-516.
 */

import { describe, it, expect } from 'vitest';
import { TierTable, DEFAULT_TIERS } from '../tier_table.js';

describe('TierTable', () => {
  it('default tiers are Trial 30/4, Standard 300/16, Enterprise 3000/64', () => {
    expect(DEFAULT_TIERS.trial).toEqual({ rpm: 30, max_concurrent: 4 });
    expect(DEFAULT_TIERS.standard).toEqual({ rpm: 300, max_concurrent: 16 });
    expect(DEFAULT_TIERS.enterprise).toEqual({ rpm: 3000, max_concurrent: 64 });
  });

  it('unknown tenant falls back to Enterprise (permissive default; call setTenantTier to restrict)', () => {
    const t = new TierTable();
    const r = t.resolve('unknown-tenant', 'jira');
    expect(r.tier).toBe('enterprise');
    expect(r.rpm).toBe(3000);
    expect(r.max_concurrent).toBe(64);
    expect(r.source).toBe('tier');
  });

  it('setTenantTier() makes the effective tier the new default for that tenant', () => {
    const t = new TierTable();
    t.setTenantTier('tenant-A', 'enterprise');
    const r = t.resolve('tenant-A', 'jira');
    expect(r.tier).toBe('enterprise');
    expect(r.rpm).toBe(3000);
    expect(r.max_concurrent).toBe(64);
    expect(r.source).toBe('tier');
  });

  it('setTenantOverride() applies a contract-level override (source: tenant_override)', () => {
    const t = new TierTable();
    t.setTenantOverride('tenant-A', { rpm: 150, max_concurrent: 8 });
    const r = t.resolve('tenant-A', 'jira');
    expect(r.rpm).toBe(150);
    expect(r.max_concurrent).toBe(8);
    expect(r.source).toBe('tenant_override');
  });

  it('setTenantOverride() throws when raised above the enterprise ceiling', () => {
    const t = new TierTable();
    expect(() => t.setTenantOverride('tenant-A', { rpm: 4000, max_concurrent: 8 })).toThrow(/enterprise ceiling/);
    expect(() => t.setTenantOverride('tenant-A', { rpm: 100, max_concurrent: 80 })).toThrow(/enterprise ceiling/);
  });

  it('setProjectOverride() may LOWER the cap but throws when raised', () => {
    const t = new TierTable();
    t.setTenantTier('tenant-A', 'standard'); // 300 RPM
    t.setProjectOverride('tenant-A', 'jira', 'proj-1', { rpm: 30, max_concurrent: 1 });
    const r = t.resolve('tenant-A', 'jira', 'proj-1');
    expect(r.rpm).toBe(30);
    expect(r.max_concurrent).toBe(1);
    expect(r.source).toBe('project_override');
    // Project without an override → tenant tier.
    const r2 = t.resolve('tenant-A', 'jira', 'proj-2');
    expect(r2.rpm).toBe(300);
    expect(r2.source).toBe('tier');
    // Raise → throws.
    expect(() => t.setProjectOverride('tenant-A', 'jira', 'proj-2', { rpm: 600 })).toThrow(/cannot raise/);
  });

  it('setProjectOverride() is scoped per (tenant, connector, project)', () => {
    const t = new TierTable();
    t.setTenantTier('tenant-A', 'standard');
    t.setProjectOverride('tenant-A', 'jira', 'proj-1', { rpm: 30 });
    // github on the same project is NOT overridden.
    const r = t.resolve('tenant-A', 'github', 'proj-1');
    expect(r.rpm).toBe(300);
  });
});
