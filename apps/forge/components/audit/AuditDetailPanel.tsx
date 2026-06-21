'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import type { AuditRecord } from '@/lib/audit/data';

export interface AuditDetailPanelProps {
  record: AuditRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuditDetailPanel({
  record,
  open,
  onOpenChange,
}: AuditDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl"
        data-testid="audit-detail-panel"
      >
        {record ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
            <SheetHeader>
              <SheetTitle>{record.action.replace('_', ' ')}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{record.id}</span> ·{' '}
                {new Date(record.timestamp).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <p className="text-forge-300">Actor</p>
                <p className="font-medium">{record.actor.name}</p>
              </div>
              <div>
                <p className="text-forge-300">Tenant</p>
                <p className="font-medium">{record.tenantName}</p>
              </div>
              <div>
                <p className="text-forge-300">Action</p>
                <Badge variant="outline">{record.action}</Badge>
              </div>
              <div>
                <p className="text-forge-300">Target type</p>
                <Badge variant="outline">{record.target.type}</Badge>
              </div>
              <div className="col-span-2">
                <p className="text-forge-300">Target</p>
                <p className="font-mono text-xs">
                  {record.target.id} — {record.target.label}
                </p>
              </div>
            </div>

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Payload
              </h3>
              <pre className="overflow-x-auto rounded-md border border-forge-700/40 bg-forge-950/70 p-3 text-xs">
                {JSON.stringify(record.payload, null, 2)}
              </pre>
            </section>

            <Separator />

            <section>
              <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                <Link2 className="h-3 w-3" aria-hidden="true" />
                Hash chain
              </h3>
              <div className="space-y-1 font-mono text-xs">
                <p>
                  <span className="text-forge-300">prev:</span> {record.prevHash}
                </p>
                <p>
                  <span className="text-forge-300">this:</span> {record.hash}
                </p>
              </div>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
