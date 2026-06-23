'use client';

import * as React from 'react';
import { Shield } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { AuditFilter, type AuditFilterState } from '@/components/audit/AuditFilter';
import { AuditTimelineVirtualized } from '@/components/audit/AuditTimelineVirtualized';
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel';
import { AuditHashChain } from '@/components/audit/AuditHashChain';
import { AuditExportButton } from '@/components/audit/AuditExportButton';
import { useApiData } from '@/hooks/use-api-data';
import { PageHeader } from '@/components/shell';
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
        <PageHeader
          eyebrow="Center"
          title="Audit Center"
          icon={<Shield className="h-4 w-4" aria-hidden="true" />}
          description="Append-only, tamper-evident audit trail. Click any record for the full payload and hash chain link."
          action={<AuditExportButton records={filtered} />}
        />

        <AuditFilter
          actors={actors}
          actions={actions}
          targetTypes={targetTypes}
          value={filter}
          onChange={setFilter}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section data-testid="audit-timeline-section">
            <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Audit Timeline (virtualized) ({filtered.length} of {all.length})
            </h2>
            <AuditTimelineVirtualized
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