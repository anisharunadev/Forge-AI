/**
 * `/runs` index page.
 *
 * Server-rendered shell wrapper around the client component
 * `<RunCenterPage>`. The page exists so the sidebar link resolves
 * to a real route — without it, the global `app/not-found.tsx`
 * takes over and renders misleading copy about the seeded tenant.
 *
 * M2 ADR-009 (Track B T-B7): also surfaces a per-tenant default
 * budget preview via `<RunBudgetBadgeTenantDefault>` so operators
 * see the cap a new run starts with before they click "New run".
 * The badge is wired to `GET /api/v1/runs/{run_id}/budget` via the
 * helper in `lib/workflows/data.ts` once a specific run is selected
 * (the per-RUN surface lives on the run detail page).
 */

import { RunCenterPage } from '@/components/runs/RunCenterPage';
import { RunBudgetBadgeTenantDefault } from '@/components/runs/RunBudgetBadgeTenantDefault';

export const dynamic = 'force-dynamic';

export default function RunsIndexPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end px-1">
        <RunBudgetBadgeTenantDefault />
      </div>
      <RunCenterPage />
    </div>
  );
}
