'use client';

import * as React from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AuditRecord } from '@/lib/audit/data';

export interface AuditExportButtonProps {
  records: ReadonlyArray<AuditRecord>;
}

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toJson(records: ReadonlyArray<AuditRecord>): string {
  return JSON.stringify(records, null, 2);
}

function toCsv(records: ReadonlyArray<AuditRecord>): string {
  const headers = [
    'id',
    'timestamp',
    'tenant_id',
    'tenant_name',
    'actor_id',
    'actor_name',
    'action',
    'target_type',
    'target_id',
    'target_label',
    'hash',
    'prev_hash',
  ];
  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of records) {
    lines.push(
      [
        r.id,
        r.timestamp,
        r.tenantId,
        r.tenantName,
        r.actor.id,
        r.actor.name,
        r.action,
        r.target.type,
        r.target.id,
        r.target.label,
        r.hash,
        r.prevHash,
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function AuditExportButton({ records }: AuditExportButtonProps) {
  const handleJson = () => {
    download(
      `audit-export-${new Date().toISOString()}.json`,
      'application/json',
      toJson(records),
    );
  };
  const handleCsv = () => {
    download(
      `audit-export-${new Date().toISOString()}.csv`,
      'text/csv',
      toCsv(records),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="audit-export-trigger">
          <Download className="h-4 w-4" aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleJson} data-testid="audit-export-json">
          Export as JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCsv} data-testid="audit-export-csv">
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
