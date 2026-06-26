'use client';

/**
 * PoliciesTable — Policies registry table for the Governance Center
 * (Phase 0.5-08 redesign).
 *
 * Per spec:
 *   - shadcn Table
 *   - Columns: Name | Scope (tenant / project / global) | Enforcement
 *     (strict / advisory / off) | Last edited | Status dot | Actions
 *   - Filter input + "New policy" primary button on the right
 *
 * Scope and Enforcement are derived deterministically from the
 * Policy.title hash so the page is deterministic across SSR + CSR.
 */

import * as React from 'react';
import { MoreHorizontal, Plus, Search, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import type { Policy } from '@/lib/governance/data';

type Scope = 'tenant' | 'project' | 'global';
type Enforcement = 'strict' | 'advisory' | 'off';

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pick<T>(arr: ReadonlyArray<T>, seed: number): T {
  return arr[seed % arr.length] as T;
}

const SCOPES: ReadonlyArray<Scope> = ['tenant', 'project', 'global'];
const ENFORCEMENTS: ReadonlyArray<Enforcement> = ['strict', 'advisory', 'off'];

function scopeFor(p: Policy): Scope {
  return pick(SCOPES, hashSeed(p.id));
}
function enforcementFor(p: Policy): Enforcement {
  return pick(ENFORCEMENTS, hashSeed(`${p.id}:enforcement`));
}

function scopeClasses(scope: Scope): string {
  switch (scope) {
    case 'tenant':
      return 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30';
    case 'project':
      return 'bg-[var(--accent-violet)]/10 text-[var(--accent-violet)] border-[var(--accent-violet)]/30';
    case 'global':
    default:
      return 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border-[var(--accent-primary)]/30';
  }
}

function enforcementClasses(e: Enforcement): string {
  switch (e) {
    case 'strict':
      return 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)] border-[var(--accent-rose)]/30';
    case 'advisory':
      return 'bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border-[var(--accent-amber)]/30';
    case 'off':
    default:
      return 'bg-[var(--bg-inset)] text-[var(--fg-tertiary)] border-[var(--border-subtle)]';
  }
}

export interface PoliciesTableProps {
  policies: ReadonlyArray<Policy>;
}

export function PoliciesTable({ policies }: PoliciesTableProps) {
  const { toast } = useToast();
  const [filter, setFilter] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return policies;
    return policies.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        scopeFor(p).includes(q) ||
        enforcementFor(p).includes(q),
    );
  }, [filter, policies]);

  const handleCreate = React.useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      toast({
        title: 'Policy draft created',
        description: 'Editor is open in draft mode.',
      });
    } catch (err) {
      toast({
        title: 'Could not create policy',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }, [creating, toast]);

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="policies-section-page"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-4 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 md:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-tertiary)]"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Filter policies…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 pl-8"
            data-testid="policies-filter"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleCreate}
          disabled={creating}
          data-testid="policies-new"
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {creating ? 'Creating…' : 'New policy'}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[var(--text-xs)] uppercase tracking-wider">
              Name
            </TableHead>
            <TableHead className="text-[var(--text-xs)] uppercase tracking-wider">
              Scope
            </TableHead>
            <TableHead className="text-[var(--text-xs)] uppercase tracking-wider">
              Enforcement
            </TableHead>
            <TableHead className="text-[var(--text-xs)] uppercase tracking-wider">
              Last edited
            </TableHead>
            <TableHead className="text-[var(--text-xs)] uppercase tracking-wider">
              Status
            </TableHead>
            <TableHead className="w-10 text-right text-[var(--text-xs)] uppercase tracking-wider">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-6 text-center text-[var(--text-sm)] text-[var(--fg-tertiary)]"
              >
                No policies match “{filter}”.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((p) => {
              const scope = scopeFor(p);
              const enforcement = enforcementFor(p);
              const statusTone =
                p.status === 'active'
                  ? 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]'
                  : 'bg-[var(--fg-muted)]';
              return (
                <TableRow
                  key={p.id}
                  data-testid={`policy-row-${p.id}`}
                  data-status={p.status}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                        {p.title}
                      </span>
                      <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                        {p.summary}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${scopeClasses(scope)}`}
                    >
                      {scope}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${enforcementClasses(enforcement)}`}
                    >
                      {enforcement}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-mono text-[var(--text-xs)] text-[var(--fg-primary)]">
                        {p.updatedAt}
                      </span>
                      <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                        {p.updatedBy.displayName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${statusTone}`}
                      />
                      <span className="text-[var(--text-xs)] text-[var(--fg-secondary)]">
                        {p.status}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                        data-testid={`policy-actions-${p.id}`}
                        aria-label={`Open actions for ${p.title}`}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            toast({
                              title: 'Editing policy',
                              description: p.title,
                            })
                          }
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            toast({
                              title: 'Duplicated policy',
                              description: p.title,
                            })
                          }
                        >
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            toast({
                              title: 'Archive requested',
                              description: p.title,
                              variant: 'destructive',
                            })
                          }
                          className="text-[var(--accent-rose)]"
                        >
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}