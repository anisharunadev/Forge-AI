/**
 * `/runs` index page.
 *
 * Server-rendered shell wrapper around the client component
 * `<RunCenterPage>`. The page exists so the sidebar link resolves
 * to a real route — without it, the global `app/not-found.tsx`
 * takes over and renders misleading copy about the seeded tenant.
 */

import { RunCenterPage } from '@/components/runs/RunCenterPage';

export const dynamic = 'force-dynamic';

export default function RunsIndexPage() {
  return <RunCenterPage />;
}
