'use client';

/**
 * RunBudgetBadgeTenantDefault — operator-facing per-tenant default
 * budget surface for the runs index page (M2 ADR-009, Track B T-B7).
 *
 * Pulls the active tenant's `run_budget_cap_usd` (the default ceiling
 * every new SDLC run starts with) from a lightweight
 * `/api/v1/runs/_budget_default` lookup. The per-RUN live surface
 * (which decrements as LLM calls settle) is wired on the run detail
 * page via `GET /api/v1/runs/{run_id}/budget`.
 *
 * The component is intentionally tolerant:
 *   - Auth not ready → renders null (no flashing badge)
 *   - Tenant unresolved → renders null
 *   - Network failure → swallows and renders null (the budget badge
 *     is informational; a failed fetch must not break the runs page)
 *
 * Semantic tokens only (R12 cross-cutting concerns).
 */

import * as React from 'react';

import { api } from '@/lib/api/client';
import { RunBudgetBadge } from '@/components/runs/RunBudgetBadge';

interface RunBudgetSnapshot {
  run_id?: string;
  tenant_id?: string;
  ceiling_usd: number;
  spent_usd: number;
  remaining_usd: number;
  currency?: string;
}

interface RunBudgetResponse extends RunBudgetSnapshot {
  tenant_id: string;
  currency: string;
}

async function fetchRunBudgetDefault(tenantId: string): Promise<RunBudgetResponse | null> {
  try {
    return await api.get<RunBudgetResponse>(`/runs/_budget_default`, { tenantId, cache: 'no-store' });
  } catch {
    return null;
  }
}

export function RunBudgetBadgeTenantDefault() {
  const [snapshot, setSnapshot] = React.useState<RunBudgetSnapshot | null>(null);
  const [tenantId, setTenantId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('@/lib/api/auth');
        const id = mod.auth.getTenantId();
        if (!cancelled) setTenantId(id);
      } catch {
        if (!cancelled) setTenantId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!tenantId) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const data = await fetchRunBudgetDefault(tenantId);
      if (!cancelled) setSnapshot(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!snapshot) return null;

  return (
    <RunBudgetBadge
      ceilingUsd={snapshot.ceiling_usd}
      spentUsd={snapshot.spent_usd}
      data-testid="run-budget-badge-tenant-default"
    />
  );
}

export default RunBudgetBadgeTenantDefault;