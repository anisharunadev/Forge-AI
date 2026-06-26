'use client';

import * as React from 'react';
import { ShieldCheck, Users, ScrollText, Wallet } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface GovernanceSettings {
  requireArchitectureApproval: boolean;
  requireSecurityApproval: boolean;
  requireDeploymentApproval: boolean;
  auditRetentionDays: number;
  notifyOnCostSpike: boolean;
  costSpikeThresholdPct: number;
  maxConcurrentAgents: number;
}

export const GOVERNANCE_DEFAULTS: GovernanceSettings = {
  requireArchitectureApproval: true,
  requireSecurityApproval: true,
  requireDeploymentApproval: true,
  auditRetentionDays: 90,
  notifyOnCostSpike: true,
  costSpikeThresholdPct: 25,
  maxConcurrentAgents: 4,
};

export interface StepGovernanceProps {
  value: GovernanceSettings;
  onChange: (next: GovernanceSettings) => void;
}

/**
 * Step 8 — Governance. Approval gates (Architecture / Security /
 * Deployment), audit retention, and cost-spike alerts. Every value
 * has a sensible default so the user can accept and move on without
 * ever touching this screen.
 */
export function StepGovernance({ value, onChange }: StepGovernanceProps) {
  return (
    <section
      className="space-y-6"
      data-testid="step-governance"
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
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Governance defaults
        </h2>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          Set the approval gates and audit posture for the project.
          These defaults match the constitution&apos;s
          mandatory-approval rule — tighten them per project later.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          icon={Users}
          title="Approval gates"
          description="Require human sign-off before agents can cross each boundary."
        >
          <ToggleRow
            id="gov-arch"
            label="Architecture approvals"
            helper="Block agents from creating or modifying ADRs without review."
            checked={value.requireArchitectureApproval}
            onChange={(c) =>
              onChange({ ...value, requireArchitectureApproval: c })
            }
          />
          <ToggleRow
            id="gov-sec"
            label="Security approvals"
            helper="Block agents from changing IAM, secrets, or network policies."
            checked={value.requireSecurityApproval}
            onChange={(c) => onChange({ ...value, requireSecurityApproval: c })}
          />
          <ToggleRow
            id="gov-deploy"
            label="Deployment approvals"
            helper="Block agents from pushing to production environments."
            checked={value.requireDeploymentApproval}
            onChange={(c) =>
              onChange({ ...value, requireDeploymentApproval: c })
            }
          />
        </Card>

        <Card
          icon={ScrollText}
          title="Audit & retention"
          description="Capture every agent action for review and compliance."
        >
          <Field
            label="Audit retention"
            htmlFor="gov-retention"
            helper="Days of audit history kept before archival."
            suffix="days"
          >
            <Input
              id="gov-retention"
              type="number"
              min={7}
              max={3650}
              step={1}
              value={value.auditRetentionDays}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  onChange({ ...value, auditRetentionDays: n });
                }
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
              data-testid="gov-retention"
            />
          </Field>
          <Field
            label="Max concurrent agents"
            htmlFor="gov-concurrency"
            helper="Soft cap on parallel agent runs."
            suffix="agents"
          >
            <Input
              id="gov-concurrency"
              type="number"
              min={1}
              max={64}
              step={1}
              value={value.maxConcurrentAgents}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  onChange({ ...value, maxConcurrentAgents: n });
                }
              }}
              style={{ fontFamily: 'var(--font-mono)' }}
              data-testid="gov-concurrency"
            />
          </Field>
        </Card>

        <Card
          icon={Wallet}
          title="Cost controls"
          description="Get notified when spend deviates from the baseline."
          className="md:col-span-2"
        >
          <ToggleRow
            id="gov-cost"
            label="Notify on cost spikes"
            helper="Trigger an alert when hourly spend jumps above the rolling average."
            checked={value.notifyOnCostSpike}
            onChange={(c) => onChange({ ...value, notifyOnCostSpike: c })}
          />
          {value.notifyOnCostSpike ? (
            <Field
              label="Spike threshold"
              htmlFor="gov-threshold"
              helper="Trigger when spend exceeds the baseline by this percentage."
              suffix="%"
            >
              <Input
                id="gov-threshold"
                type="number"
                min={5}
                max={500}
                step={5}
                value={value.costSpikeThresholdPct}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) {
                    onChange({ ...value, costSpikeThresholdPct: n });
                  }
                }}
                style={{ fontFamily: 'var(--font-mono)' }}
                data-testid="gov-threshold"
              />
            </Field>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Local building blocks. Mirrors the shape used in StepTenantSetup so the
 * wizard stays visually consistent without dragging in a shared file.
 * ------------------------------------------------------------------------- */

function Card({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('rounded-[var(--radius-lg)] border p-5 space-y-4', className)}
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="inline-flex h-8 w-8 items-center justify-center rounded-md"
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
          }}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            {title}
          </p>
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
              lineHeight: 'var(--leading-base)',
            }}
          >
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  helper,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  helper: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label
          htmlFor={id}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--fg-primary)',
            cursor: 'pointer',
          }}
        >
          {label}
        </Label>
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-tertiary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          {helper}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        data-testid={id}
      />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  helper,
  suffix,
  children,
}: {
  label: string;
  htmlFor: string;
  helper?: string;
  suffix?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={htmlFor}
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--fg-secondary)',
        }}
      >
        {label}
      </Label>
      <div className="relative">
        {children}
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
            }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {helper ? (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-tertiary)',
          }}
        >
          {helper}
        </p>
      ) : null}
    </div>
  );
}