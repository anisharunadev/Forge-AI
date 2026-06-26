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
import { cn } from '@/lib/utils';

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

const SEED_FLAGS: ReadonlyArray<Flag> = [
  { id: 'flag-voice',   name: 'Beta: New Co-pilot voice mode',          description: 'Talk to Co-pilot instead of typing. Uses your default microphone and sends audio to the speech model.', label: 'beta', enabled: false, Icon: Mic2 },
  { id: 'flag-flow',    name: 'Beta: Workflow visual editor v2',        description: 'Drag-and-drop node editor for assembling multi-agent workflows. Includes undo/redo and live validation.', label: 'beta', enabled: false, Icon: Workflow },
  { id: 'flag-pi',      name: 'Experimental: forge-pi code-aware suggestions', description: 'Inline completions that reference your repository structure and recent diffs.', label: 'experimental', enabled: true, Icon: Sparkles },
  { id: 'flag-tel',     name: 'Telemetry: Anonymous usage stats',      description: 'Help us improve Forge by sharing anonymous usage events. Never includes code or secrets.', label: null, enabled: true, Icon: BarChart3 },
  { id: 'flag-mm',      name: 'AI: Multi-modal Co-pilot (image upload)',description: 'Attach screenshots and diagrams to Co-pilot messages for richer context.', label: null, enabled: true, Icon: ImageIcon },
  { id: 'flag-rollout', name: 'New dashboard rollout',                  description: 'Phased rollout of the redesigned dashboard. Gradually enabled per workspace.', label: 'experimental', enabled: true, rollout: 25, Icon: FlaskConical },
];

const STORAGE_KEY = 'forge.flags.v1';

function loadFlags(): Flag[] {
  if (typeof window === 'undefined') return [...SEED_FLAGS];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...SEED_FLAGS];
    return JSON.parse(raw) as Flag[];
  } catch {
    return [...SEED_FLAGS];
  }
}

function persistFlags(f: Flag[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* noop */
  }
}

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

export function FeatureFlagsTab() {
  const [flags, setFlags] = React.useState<ReadonlyArray<Flag>>(SEED_FLAGS);

  React.useEffect(() => {
    setFlags(loadFlags());
  }, []);

  const toggle = (id: string) => {
    const next = flags.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f));
    setFlags(next);
    persistFlags(next);
  };

  const setRollout = (id: string, value: number) => {
    const next = flags.map((f) => (f.id === id ? { ...f, rollout: value } : f));
    setFlags(next);
    persistFlags(next);
  };

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
        <ul className="divide-y divide-[var(--border-subtle)]">
          {flags.map((f) => (
            <FlagRow
              key={f.id}
              flag={f}
              onToggle={() => toggle(f.id)}
              onRollout={(v) => setRollout(f.id, v)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Flag Row ---------------- */

interface FlagRowProps {
  flag: Flag;
  onToggle: () => void;
  onRollout: (v: number) => void;
}

function FlagRow({ flag, onToggle, onRollout }: FlagRowProps) {
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
                onValueChange={(v) => onRollout(v[0] ?? 0)}
              />
            </div>
          ) : null}
        </div>
      </div>
      <Switch
        checked={flag.enabled}
        onCheckedChange={onToggle}
        data-testid={`flag-toggle-${flag.id}`}
      />
    </li>
  );
}
