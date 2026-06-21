'use client';

import * as React from 'react';
import { Shield } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AuditFilter, type AuditFilterState } from '@/components/audit/AuditFilter';
import { AuditTimeline } from '@/components/audit/AuditTimeline';
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel';
import { AuditHashChain } from '@/components/audit/AuditHashChain';
import { AuditExportButton } from '@/components/audit/AuditExportButton';
import { useApiData } from '@/hooks/use-api-data';
import {
  listAuditActions,
  listAuditTargetTypes,
  type AuditActor,
  type AuditRecord,
} from '@/lib/audit/data';

export default function AuditCenterPage() {
  const recordsQ = useApiData<AuditRecord[]>('/v1/audit/records');
  const actorsQ = useApiData<AuditActor[]>('/v1/audit/actors');

  // The hash chain is built client-side from the records (see
  // `lib/audit/data.ts`). Empty state is an empty array.
  const all: ReadonlyArray<AuditRecord> = recordsQ.data ?? [];
  const actors: ReadonlyArray<AuditActor> = actorsQ.data ?? [];
  const actions = React.useMemo(() => listAuditActions(), []);
  const targetTypes = React.useMemo(() => listAuditTargetTypes(), []);

  const [filter, setFilter] = React.useState<AuditFilterState>({
    actorId: 'all',
    action: 'all',
    targetType: 'all',
    from: '',
    to: '',
  });
  const [selected, setSelected] = React.useState<AuditRecord | null>(null);
  const [open, setOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const fromTs = filter.from ? Date.parse(filter.from) : -Infinity;
    const toTs = filter.to ? Date.parse(filter.to) + 86_400_000 : Infinity;
    return all.filter((r) => {
      if (filter.actorId !== 'all' && r.actor.id !== filter.actorId) return false;
      if (filter.action !== 'all' && r.action !== filter.action) return false;
      if (filter.targetType !== 'all' && r.target.type !== filter.targetType)
        return false;
      const t = Date.parse(r.timestamp);
      if (t < fromTs || t > toTs) return false;
      return true;
    });
  }, [all, filter]);

  const handleSelect = (r: AuditRecord) => {
    setSelected(r);
    setOpen(true);
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="audit-center">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Shield className="h-5 w-5" aria-hidden="true" />
              Audit Center
            </h1>
            <AuditExportButton records={filtered} />
          </div>
          <p className="text-sm text-muted-foreground">
            Append-only, tamper-evident audit trail. Click any record for the
            full payload and hash chain link.
          </p>
        </header>

        <AuditFilter
          actors={actors}
          actions={actions}
          targetTypes={targetTypes}
          value={filter}
          onChange={setFilter}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section data-testid="audit-timeline-section">
            <h2 className="mb-2 text-xs uppercase tracking-wider text-forge-300">
              Timeline ({filtered.length} of {all.length})
            </h2>
            <AuditTimeline
              records={filtered}
              selectedId={selected?.id}
              onSelect={handleSelect}
              emptyMessage="No audit records match the current filters."
            />
          </section>

          <aside className="flex flex-col gap-3" data-testid="audit-side-panel">
            <AuditHashChain records={filtered} />
          </aside>
        </div>

        <AuditDetailPanel
          record={selected}
          open={open}
          onOpenChange={setOpen}
        />
      </div>
    </AdminShell>
  );
}
