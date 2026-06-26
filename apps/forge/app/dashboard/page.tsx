/**
 * Step 25 — Mission Control dashboard.
 *
 * Replaces the previous FORA-514 §3 "two-card + runs list" layout
 * with the curated Mission Control surface defined in
 * `components/dashboard/`. The page stays a server component so
 * the data fetch (when the orchestrator is reachable) can be SSR'd,
 * but the heavy interaction lives in the client MissionControl
 * component to keep the bundle small.
 *
 * The legacy `DashboardShell` (which used to render two CTA cards
 * pointing at Command Center / Terminal Center) has been retired
 * because the Quick Command Bar and Quick Actions tile cover both
 * entry points directly on the dashboard surface.
 */

import { MissionControl } from '@/components/dashboard/MissionControl';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <div className="px-4 py-6 md:px-6 lg:px-8" data-testid="dashboard-page">
      <MissionControl />
    </div>
  );
}