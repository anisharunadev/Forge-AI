'use client';

import * as React from 'react';
import { ListChecks } from 'lucide-react';

import {
  type AssignableAgent,
  type DetectedStack,
  type SampleRepo,
  type TenantForm,
} from '@/lib/onboarding/data';

export interface StepReviewProps {
  tenant: TenantForm | null;
  repos: ReadonlyArray<SampleRepo>;
  acceptedStacks: ReadonlyArray<string>;
  stacks: ReadonlyArray<DetectedStack>;
  selectedAgents: ReadonlyArray<string>;
  agents: ReadonlyArray<AssignableAgent>;
  intelState: 'idle' | 'running' | 'done' | 'failed';
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 border-b border-forge-800 py-2 text-sm">
      <dt className="text-forge-300">{label}</dt>
      <dd className="text-forge-100">{value}</dd>
    </div>
  );
}

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
    .map((s) =>
      [s.language, s.framework].filter(Boolean).join(' · '),
    );
  const agentNames = agents
    .filter((a) => selectedAgents.includes(a.id))
    .map((a) => a.name);

  return (
    <section
      className="card space-y-4"
      data-testid="step-review"
    >
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          Review and confirm
        </h2>
        <p className="text-sm text-forge-300">
          Final summary before the project is provisioned.
        </p>
      </header>

      <dl data-testid="review-list">
        <Row
          label="Tenant"
          value={
            tenant ? (
              <span>
                {tenant.tenantName}
                <span className="ml-2 text-[10px] text-forge-300">
                  {tenant.region} · {tenant.defaultTimezone} · ${tenant.costCeilingUsd}/day
                </span>
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
                    className="mr-2 inline-block rounded-sm border border-forge-700 bg-forge-800 px-2 py-0.5 font-mono text-[10px]"
                  >
                    {r.url.replace(/^https?:\/\//, '')}
                  </span>
                ))
          }
        />
        <Row
          label="Stacks confirmed"
          value={
            stackNames.length === 0
              ? '—'
              : stackNames.join(', ')
          }
        />
        <Row
          label="Agents"
          value={
            agentNames.length === 0
              ? '—'
              : agentNames.join(', ')
          }
        />
        <Row label="First intel" value={<span className="capitalize">{intelState}</span>} />
      </dl>
    </section>
  );
}
