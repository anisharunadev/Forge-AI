'use client';

/**
 * DemoBanner — sticky amber alert shown on every page when the demo
 * `acme-corp` seed has been applied (Plan G commit 2).
 *
 * UX constraints (from OQ-16 and the plan):
 *   - Always visible while the seed is applied. Non-dismissible —
 *     the user can reset the seed from `/admin/seeds` to remove it.
 *   - `role="status"` + `aria-live="polite"` so assistive tech
 *     announces count / checksum updates without seizing focus.
 *   - `sticky top-0` + `min-h-12` reserved height — never collapses
 *     and never shifts layout (CLS = 0).
 *   - Polls `useSeedStatus` every 60s; a fresh `applied === true`
 *     is enough to render, `applied === false` removes the banner.
 *
 * The banner is mounted at the layout root by Plan G commit 3.
 */

import * as React from 'react';
import { Info } from 'lucide-react';

import { useSeedStatus } from '@/lib/hooks/useSeeds';

export const DEMO_SEED_NAME = 'acme-corp';

export interface DemoBannerProps {
  /** Optional override for the seed name. Defaults to `acme-corp`. */
  seedName?: string;
}

export function DemoBanner({ seedName = DEMO_SEED_NAME }: DemoBannerProps) {
  const { data: status, error } = useSeedStatus(seedName, {
    refetchInterval: 60_000,
  });

  // If the seed hasn't been applied yet there is nothing to show. The
  // banner only appears once `applied === true`, which matches the
  // plan: "visible on every page when tenantSlug==='acme-corp'" AND
  // the seed is in the applied state.
  if (error) return null;
  if (!status?.applied) return null;

  const rowCounts = status.row_counts ?? {};
  const totalRows = Object.values(rowCounts).reduce(
    (sum, n) => sum + (typeof n === 'number' ? n : 0),
    0,
  );
  const checksumLabel = status.checksum_match ? 'verified' : 'drift detected';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-banner"
      className="sticky top-0 z-40 w-full min-h-12 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="container mx-auto flex items-center gap-3">
        <Info
          className="h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        />
        <div className="flex-1" data-testid="demo-banner-message">
          <strong className="font-semibold">Acme Corp Demo Tenant</strong>
          {' · '}
          <span data-testid="demo-banner-row-count">
            {totalRows.toLocaleString()}
          </span>
          {' artifacts loaded'}
          {' · '}
          <span>
            Checksum:{' '}
            <span
              className="font-mono"
              data-testid="demo-banner-checksum"
              data-state={status.checksum_match ? 'match' : 'drift'}
            >
              {checksumLabel}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}