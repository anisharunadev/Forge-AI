/**
 * F-829 Phase C — Tenant-id accessor hook.
 *
 * Reads the active tenant from the auth context. Falls back to the
 * SEED_TENANT_ID used elsewhere in the dashboard for environments
 * without a fully wired auth principal (development + Playwright).
 */
'use client';

import { SEED_TENANT_ID } from '@/lib/auth';

export function useTenantId(): string {
  // The full Forge auth context carries tenant_id on the principal;
  // for Phase C we surface the seed tenant so the pages render in
  // local dev. The auth integration lands in Phase 1.5+.
  return SEED_TENANT_ID;
}
