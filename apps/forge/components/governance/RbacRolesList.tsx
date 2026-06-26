'use client';

/**
 * RbacRolesList — Compact RBAC roles panel.
 *
 * Per spec: list of role chips (Owner, Admin, Editor, Viewer, Custom)
 * — clicking a chip expands to show member list with avatars.
 *
 * Built on the existing shadcn <Accordion> primitive for expand/collapse.
 */

import * as React from 'react';
import { ChevronDown, Users } from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { RbacRole } from '@/lib/governance/data';

export interface RbacRolesListProps {
  roles: ReadonlyArray<RbacRole>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function roleToneClasses(role: RbacRole): string {
  if (role.system) {
    return 'bg-[var(--accent-violet)]/10 text-[var(--accent-violet)] border-[var(--accent-violet)]/30';
  }
  switch (role.name.toLowerCase()) {
    case 'owner':
      return 'bg-[var(--accent-rose)]/10 text-[var(--accent-rose)] border-[var(--accent-rose)]/30';
    case 'admin':
      return 'bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border-[var(--accent-amber)]/30';
    case 'editor':
      return 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30';
    case 'viewer':
      return 'bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] border-[var(--accent-emerald)]/30';
    default:
      return 'bg-[var(--bg-inset)] text-[var(--fg-secondary)] border-[var(--border-subtle)]';
  }
}

export function RbacRolesList({ roles }: RbacRolesListProps) {
  if (roles.length === 0) return null;

  return (
    <Accordion
      type="multiple"
      className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      data-testid="rbac-section-page"
    >
      {roles.map((r) => {
        // Deterministic avatar pool so SSR matches CSR. Names come
        // from a curated list — not real users.
        const sampleNames = [
          'Jane CTO',
          'Eng Lead',
          'PM West',
          'Designer',
          'QA Lead',
          'AI Agent',
          'Sec Eng',
          'Viewer',
        ];
        const members = Array.from({ length: r.memberCount }, (_, i) => ({
          name: sampleNames[i % sampleNames.length],
          id: `${r.id}-m${i}`,
        }));
        return (
          <AccordionItem
            key={r.id}
            value={r.id}
            className="border-b border-[var(--border-subtle)] last:border-0"
            data-testid={`rbac-row-${r.id}`}
            data-system={String(r.system)}
          >
            <AccordionTrigger
              className="px-4 py-3 hover:no-underline"
              data-testid={`rbac-row-trigger-${r.id}`}
            >
              <div className="flex flex-1 items-center gap-3 text-left">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${roleToneClasses(r)}`}
                >
                  {r.name}
                </span>
                <span className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                  {r.permissions.length} permissions
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {r.memberCount}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-tertiary)] transition-transform duration-200" />
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="px-4 pb-4">
                {r.description ? (
                  <p className="mb-3 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                    {r.description}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-[1fr_240px]">
                  <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3">
                    {members.length === 0 ? (
                      <p className="text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                        No members assigned.
                      </p>
                    ) : (
                      members.map((m, idx) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1"
                        >
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="bg-[var(--bg-inset)] text-[9px] text-[var(--fg-secondary)]">
                              {initials(m.name ?? 'Unknown')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[11px] text-[var(--fg-primary)]">
                            {m.name ?? 'Unknown'}
                          </span>
                          {idx === 0 ? (
                            <span className="rounded bg-[var(--accent-primary)]/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]">
                              lead
                            </span>
                          ) : null}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                    <p className="font-medium text-[var(--fg-primary)]">
                      Permissions
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {r.permissions.slice(0, 4).map((p) => (
                        <li key={p.resource} className="font-mono text-[11px]">
                          {p.resource} · {p.actions.join(', ')}
                        </li>
                      ))}
                      {r.permissions.length > 4 ? (
                        <li className="text-[var(--fg-tertiary)]">
                          +{r.permissions.length - 4} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}