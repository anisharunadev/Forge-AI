'use client';

import * as React from 'react';
import { Filter } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type {
  AuditAction,
  AuditActor,
  AuditTargetType,
} from '@/lib/audit/data';

export interface AuditFilterState {
  actorId: string;
  action: AuditAction | 'all';
  targetType: AuditTargetType | 'all';
  from: string;
  to: string;
}

export interface AuditFilterProps {
  actors: ReadonlyArray<AuditActor>;
  actions: ReadonlyArray<AuditAction>;
  targetTypes: ReadonlyArray<AuditTargetType>;
  value: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
}

export function AuditFilter({
  actors,
  actions,
  targetTypes,
  value,
  onChange,
}: AuditFilterProps) {
  return (
    <div
      className="grid grid-cols-1 gap-3 rounded-md border border-forge-700/40 bg-forge-900/40 p-3 md:grid-cols-5"
      data-testid="audit-filter"
    >
      <div className="space-y-1">
        <Label htmlFor="audit-actor" className="flex items-center gap-1 text-xs">
          <Filter className="h-3 w-3" aria-hidden="true" />
          Actor
        </Label>
        <Select
          value={value.actorId}
          onValueChange={(v: string) => onChange({ ...value, actorId: v })}
        >
          <SelectTrigger id="audit-actor" data-testid="audit-filter-actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {actors.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-action" className="text-xs">Action</Label>
        <Select
          value={value.action}
          onValueChange={(v: string) => onChange({ ...value, action: v as AuditAction | 'all' })}
        >
          <SelectTrigger id="audit-action" data-testid="audit-filter-action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-target" className="text-xs">Target type</Label>
        <Select
          value={value.targetType}
          onValueChange={(v: string) =>
            onChange({ ...value, targetType: v as AuditTargetType | 'all' })
          }
        >
          <SelectTrigger id="audit-target" data-testid="audit-filter-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All target types</SelectItem>
            {targetTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-from" className="text-xs">From</Label>
        <Input
          id="audit-from"
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to" className="text-xs">To</Label>
        <Input
          id="audit-to"
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
      <div className="md:col-span-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              actorId: 'all',
              action: 'all',
              targetType: 'all',
              from: '',
              to: '',
            })
          }
          data-testid="audit-filter-reset"
        >
          Reset filters
        </Button>
      </div>
    </div>
  );
}
