'use client';

import * as React from 'react';
import {
  Users,
  Lock,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '../shared/panel';
import { ToneBadge } from '../shared/severity-badge';

const ROLES = [
  { id: 'role-owner', name: 'Owner', description: 'Full access — billing, members, security', perms: 47, members: 2, system: true },
  { id: 'role-admin', name: 'Admin', description: 'Manage members, policies, integrations', perms: 38, members: 5, system: true },
  { id: 'role-editor', name: 'Editor', description: 'Create/edit projects, runs, workflows', perms: 24, members: 23, system: true },
  { id: 'role-viewer', name: 'Viewer', description: 'Read-only access to projects and audit', perms: 8, members: 47, system: true },
  { id: 'role-security', name: 'Security', description: 'Manage policies, guardrails, audit export', perms: 32, members: 4, system: false },
  { id: 'role-finance', name: 'Finance', description: 'Spend caps, invoices, cost reports', perms: 12, members: 3, system: false },
];

const PERMISSIONS = [
  'projects.create', 'projects.read', 'projects.update', 'projects.delete',
  'policies.read', 'policies.update',
  'guardrails.read', 'guardrails.update',
  'standards.read', 'standards.load',
  'llm.models.read', 'llm.models.update',
  'audit.read', 'audit.export',
  'spend.read', 'spend.update',
  'rbac.read', 'rbac.update',
];

function perm(role: { perms: number; name: string }, p: string): boolean {
  // deterministic — derive from role name hash
  const idx = (PERMISSIONS.indexOf(p) + role.name.length * 3) % 7;
  return idx < Math.min(role.perms / 5, 6);
}

export function RbacTab() {
  return (
    <div className="space-y-4" data-testid="rbac-tab">
      <div className="rounded-[var(--radius-md)] border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 p-4" data-testid="rbac-banner">
        <div className="flex items-start gap-3">
          <div className="rounded bg-[var(--accent-primary)]/15 p-2 text-[var(--accent-primary)]" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--fg-primary)]">RBAC Editor ships in v1.1</h3>
            <p className="mt-1 text-[11px] text-[var(--fg-secondary)]">
              Custom roles, granular permission assignment, and role inheritance are coming in v1.1.
              Currently read-only — request early access below.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm"><Lock className="h-3 w-3" />Request early access</Button>
              <Button size="sm" variant="outline">View roadmap</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid={`role-${r.id}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]" aria-hidden>
                <Users className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-[13px] font-semibold text-[var(--fg-primary)]">{r.name}</h4>
                  {r.system ? <ToneBadge tone="indigo">System</ToneBadge> : <ToneBadge tone="violet">Custom</ToneBadge>}
                </div>
                <p className="text-[11px] text-[var(--fg-tertiary)]">{r.description}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-3">
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1.5">
                <p className="text-[9px] text-[var(--fg-tertiary)]">PERMISSIONS</p>
                <p className="font-mono text-[14px] font-semibold tabular-nums text-[var(--fg-primary)]">{r.perms}</p>
              </div>
              <div className="rounded bg-[var(--bg-inset)] px-2 py-1.5">
                <p className="text-[9px] text-[var(--fg-tertiary)]">MEMBERS</p>
                <p className="font-mono text-[14px] font-semibold tabular-nums text-[var(--fg-primary)]">{r.members}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Panel title="Permissions matrix" subtitle="Role × permission grid (read-only)" dataTestId="rbac-matrix">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--bg-surface)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">Permission</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {PERMISSIONS.map((p) => (
                <tr key={p} className="hover:bg-[var(--bg-inset)]" data-testid={`perm-row-${p}`}>
                  <td className="sticky left-0 bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-[var(--fg-secondary)]">{p}</td>
                  {ROLES.map((r) => (
                    <td key={r.id} className="px-3 py-1.5 text-center">
                      {perm(r, p) ? (
                        <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-[var(--accent-emerald)]" aria-hidden />
                      ) : (
                        <XCircle className="mx-auto h-3.5 w-3.5 text-[var(--fg-muted)]" aria-hidden />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}