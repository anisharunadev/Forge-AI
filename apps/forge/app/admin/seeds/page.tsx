/**
 * /admin/seeds — Steward seed management surface (Plan H commit 5).
 *
 * Server component shell that composes the Plan H `components/seeds/*`
 * UI: status panel, diff view, run history, and the apply/reset/rollback
 * modals in the header. RBAC is enforced server-side via `hasPermission`
 * (Plan H commit 5 of `lib/auth.ts`); a missing `seeds:view` redirect
 * to `/admin` keeps the page locked down until the FORA-123 broker
 * replaces the dev cookie stub.
 *
 * The page itself is a Server Component so it can call `hasPermission`
 * before any client component mounts. The header buttons are the only
 * mutation surface — apply / reset / rollback — and they each guard
 * their own click handler with the matching `use<Verb>Seed` hook from
 * Plan F.
 *
 * Target seed is pinned to `acme-corp` (the demo seed slug from
 * `SEED_TENANT_SLUG`). A future picker can swap this for the result
 * of `useSeedsList()` once multiple seeds ship.
 */

import { Database, Sprout } from 'lucide-react';
import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader } from '@/components/shell';
import { SeedStatusPanel } from '@/components/seeds/SeedStatusPanel';
import { SeedHistoryTable } from '@/components/seeds/SeedHistoryTable';
import { SeedApplyModal } from '@/components/seeds/SeedApplyModal';
import { SeedResetModal } from '@/components/seeds/SeedResetModal';
import { SeedRollbackModal } from '@/components/seeds/SeedRollbackModal';
import { SeedDiffView } from '@/components/seeds/SeedDiffView';
import { hasPermission, SEED_TENANT_SLUG } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Seed Management — Forge AI',
  description:
    'Apply, reset, rollback, and inspect demo seeds for the current tenant.',
};

export default async function AdminSeedsPage() {
  if (!(await hasPermission('seeds:view'))) {
    redirect('/admin');
  }

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="admin-seeds-page"
        data-page-title="Seed Management"
      >
        <PageHeader
          eyebrow="Admin"
          title="Seed Management"
          icon={<Sprout className="h-4 w-4" aria-hidden="true" />}
          description="Inspect, apply, reset, and rollback demo seeds for the current tenant. All mutations are idempotent and audit-logged."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" aria-hidden="true" />
            Target seed:{' '}
            <span className="font-mono text-foreground">{SEED_TENANT_SLUG}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <SeedApplyModal seedName={SEED_TENANT_SLUG} />
            <SeedResetModal seedName={SEED_TENANT_SLUG} />
            <SeedRollbackModal seedName={SEED_TENANT_SLUG} />
          </div>
        </div>

        <SeedStatusPanel seedName={SEED_TENANT_SLUG} />
        <SeedDiffView seedName={SEED_TENANT_SLUG} />

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Run history</h2>
          <SeedHistoryTable seedName={SEED_TENANT_SLUG} />
        </section>
      </div>
    </AdminShell>
  );
}