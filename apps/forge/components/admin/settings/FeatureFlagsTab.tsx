'use client';

/**
 * Settings — Feature Flags tab (Step-47 Enterprise section).
 *
 * List of feature flags with toggle states, description, label
 * ("Beta" cyan / "Experimental" amber / "Deprecated" rose), and
 * rollout-percentage slider where applicable.
 *
 * Mock state is persisted to localStorage. Real backend integration
 * lands with sub-plan B (release-management).
 */

import * as React from 'react';
import {
  Mic2,
  Workflow,
  Sparkles,
  BarChart3,
  Image as ImageIcon,
  FlaskConical,
  AlertTriangle,
  Archive,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useFeatureFlags, useUpdateFeatureFlag } from '@/lib/hooks/useSettings';

type Label = 'beta' | 'experimental' | 'deprecated';

interface Flag {
  id: string;
  name: string;
  description: string;
  label: Label | null;
  enabled: boolean;
  rollout?: number; // 0-100
  Icon: LucideIcon;
}

// Per-key icon lookup. Backend returns only `key` — UI keeps the icon
// mapping local. New keys without an entry fall back to Sparkles.
const ICON_BY_KEY: Record<string, LucideIcon> = {
  'flag-voice': Mic2,
  'flag-flow': Workflow,
  'flag-pi': Sparkles,
  'flag-tel': BarChart3,
  'flag-mm': ImageIcon,
  'flag-rollout': FlaskConical,
};

const labelClasses: Record<Label, string> = {
  beta:         'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]',
  experimental: 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]',
  deprecated:   'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]',
};

const labelLabel: Record<Label, string> = {
  beta: 'Beta',
  experimental: 'Experimental',
  deprecated: 'Deprecated',
};

function deriveLabel(key: string): Label | null {
  const k = key.toLowerCase();
  if (k.includes('experimental')) return 'experimental';
  if (k.includes('beta')) return 'beta';
  if (k.includes('deprecated')) return 'deprecated';
  return null;
}

function wireToFlag(wire: {
  key: string;
  value: boolean | number | string;
  description: string;
}): Flag {
  const isBool = typeof wire.value === 'boolean';
  return {
    id: wire.key,
    name: wire.key,
    description: wire.description,
    label: deriveLabel(wire.key),
    enabled: isBool ? (wire.value as boolean) : true,
    rollout: !isBool && typeof wire.value === 'number' ? wire.value : undefined,
    Icon: ICON_BY_KEY[wire.key] ?? Sparkles,
  };
}

export function FeatureFlagsTab() {
  const flagsQ = useFeatureFlags();
  const updateM = useUpdateFeatureFlag();
  const flags: ReadonlyArray<Flag> = (flagsQ.data ?? []).map(wireToFlag);

  return (
    <div className="flex flex-col gap-6" data-testid="feature-flags-tab">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[var(--text-2xl)] font-semibold text-[var(--fg-primary)]">
            Feature flags
          </h2>
          <p className="mt-1 max-w-xl text-[var(--text-sm)] text-[var(--fg-secondary)]">
            Enable beta features or opt out of experimental functionality. Toggling a flag applies
            immediately across the workspace.
          </p>
        </div>
        <Button variant="outline" data-testid="flags-request">
          Request a feature
        </Button>
      </header>

      <section
        className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        data-testid="flags-list"
      >
        {flagsQ.isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {flags.map((f) => (
              <FlagRow
                key={f.id}
                flag={f}
                pending={updateM.isPending && updateM.variables?.key === f.id}
                onToggle={() =>
                  updateM.mutate({ key: f.id, value: !f.enabled })
                }
                onRollout={(v) => updateM.mutate({ key: f.id, value: v })}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------- Flag Row ---------------- */

interface FlagRowProps {
  flag: Flag;
  pending: boolean;
  onToggle: () => void;
  onRollout: (v: number) => void;
}

function FlagRow({ flag, pending, onToggle, onRollout }: FlagRowProps) {
  const Icon = flag.Icon;
  return (
    <li
      className="flex items-start justify-between gap-4 p-5"
      data-testid={`flag-${flag.id}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)]">
          {flag.label === 'deprecated' ? (
            <Archive className="h-4 w-4 text-[var(--accent-rose)]" aria-hidden="true" />
          ) : (
            <Icon className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--text-sm)] font-semibold text-[var(--fg-primary)]">
              {flag.name}
            </span>
            {flag.label ? (
              <span
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider',
                  labelClasses[flag.label],
                )}
                data-testid={`flag-label-${flag.id}`}
              >
                {flag.label === 'experimental' ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                ) : null}
                {labelLabel[flag.label]}
              </span>
            ) : null}
          </div>
          <p className="text-[var(--text-xs)] text-[var(--fg-secondary)]">{flag.description}</p>
          {typeof flag.rollout === 'number' ? (
            <div
              className="mt-2 flex w-full max-w-md flex-col gap-1"
              data-testid={`flag-rollout-${flag.id}`}
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                <span>Rollout</span>
                <span>{flag.rollout}% of users</span>
              </div>
              <Slider
                value={[flag.rollout]}
                min={0}
                max={100}
                step={5}
                disabled={pending}
                onValueChange={(v) => onRollout(v[0] ?? 0)}
              />
            </div>
          ) : null}
        </div>
      </div>
      <Switch
        checked={flag.enabled}
        onCheckedChange={onToggle}
        disabled={pending}
        data-testid={`flag-toggle-${flag.id}`}
      />
    </li>
  );
}
