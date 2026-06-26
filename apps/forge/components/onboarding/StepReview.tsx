'use client';

import * as React from 'react';
import { ListChecks } from 'lucide-react';

import type {
  AssignableAgent,
  DetectedStack,
  SampleRepo,
  TenantForm,
} from '@/lib/onboarding/data';

export interface StepReviewProps {
  tenant: TenantForm | null;
  repos: ReadonlyArray<SampleRepo>;
  acceptedStacks: ReadonlyArray<string>;
  stacks: ReadonlyArray<DetectedStack>;
  selectedAgents: ReadonlyArray<string>;
  agents: ReadonlyArray<AssignableAgent>;
  intelState: 'idle' | 'running' | 'done' | 'failed' | 'skipped';
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="grid grid-cols-[160px_1fr] items-baseline gap-3 border-b py-3"
      style={{
        borderColor: 'var(--border-subtle)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <dt
        style={{
          color: 'var(--fg-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          fontSize: '10px',
          fontWeight: 'var(--font-weight-semibold)',
        }}
      >
        {label}
      </dt>
      <dd style={{ color: 'var(--fg-primary)' }}>{value}</dd>
    </div>
  );
}

/**
 * Step 6 — Review and confirm. Read-only summary of every prior step.
 * The "Confirm & provision" CTA lives in the wizard footer
 * (`WizardNav`) so it stays consistent across the whole flow.
 */
export function StepReview({
  tenant,
  repos,
  acceptedStacks,
  stacks,
  selectedAgents,
  agents,
  intelState,
}: StepReviewProps) {
  const stackNames = stacks
    .filter((s) => acceptedStacks.includes(s.id))
    .map((s) => [s.language, s.framework].filter(Boolean).join(' · '));
  const agentNames = agents
    .filter((a) => selectedAgents.includes(a.id))
    .map((a) => a.name);

  return (
    <section
      className="rounded-[var(--radius-lg)] border p-5 space-y-5"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      data-testid="step-review"
    >
      <header className="space-y-1">
        <h2
          className="flex items-center gap-2"
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          Review &amp; confirm
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Final summary before the project is provisioned. Click any
          completed step in the progress bar to jump back and edit.
        </p>
      </header>

      <dl data-testid="review-list">
        <Row
          label="Tenant"
          value={
            tenant ? (
              <span className="inline-flex flex-wrap items-baseline gap-2">
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {tenant.tenantName}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>
                  {tenant.region} · {tenant.defaultTimezone} · $
                  {tenant.costCeilingUsd}/day
                </span>
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Policies"
          value={
            tenant ? (
              <span
                className="inline-flex flex-wrap gap-2"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                <PolicyPill
                  on={tenant.enableSandbox}
                  label="Sandbox runtimes"
                />
                <PolicyPill
                  on={tenant.enableQuarantine}
                  label="Auto-quarantine connectors"
                />
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Repositories"
          value={
            repos.length === 0
              ? '—'
              : repos.map((r) => (
                  <span
                    key={r.id}
                    className="mr-1.5 mt-1 inline-block rounded-sm border px-2 py-0.5"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: 'var(--bg-inset)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--fg-primary)',
                    }}
                  >
                    {r.url.replace(/^https?:\/\//, '')}
                  </span>
                ))
          }
        />
        <Row
          label="Stacks confirmed"
          value={
            stackNames.length === 0 ? (
              '—'
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                {stackNames.join(', ')}
              </span>
            )
          }
        />
        <Row
          label="Agents"
          value={
            agentNames.length === 0 ? '—' : agentNames.join(', ')
          }
        />
        <Row
          label="First intel"
          value={
            <span
              className="capitalize"
              style={{
                fontSize: 'var(--text-xs)',
                color:
                  intelState === 'done'
                    ? 'var(--accent-emerald)'
                    : intelState === 'failed'
                      ? 'var(--accent-rose)'
                      : 'var(--fg-secondary)',
              }}
            >
              {intelState}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function PolicyPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5"
      style={{
        fontSize: '10px',
        background: on ? 'rgba(16, 185, 129, 0.10)' : 'var(--bg-inset)',
        borderColor: on
          ? 'rgba(16, 185, 129, 0.30)'
          : 'var(--border-subtle)',
        color: on ? 'var(--accent-emerald)' : 'var(--fg-tertiary)',
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: on ? 'var(--accent-emerald)' : 'var(--fg-tertiary)' }}
      />
      {label}
    </span>
  );
}