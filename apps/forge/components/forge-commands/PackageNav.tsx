'use client';

import * as React from 'react';
import { Brain, Workflow, Globe } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ForgeCommandPackageId } from '@/lib/forge-commands';

export interface PackageNavProps {
  active: ForgeCommandPackageId;
  onChange: (id: ForgeCommandPackageId) => void;
  /** Counts per package — `null` means the package is not installed. */
  counts: Record<ForgeCommandPackageId, number | null>;
}

/**
 * Step 48 — per-package accent (Tailwind text-* classes).
 * Each package gets its own color so the user can spot at a glance which
 * surface a skill came from. Dark-mode only — colors are tuned for the
 * slate-950 background.
 *   - forge-core    → indigo  (lucide Workflow)
 *   - forge-pi      → violet  (lucide Brain)
 *   - forge-browser → cyan    (lucide Globe)
 */
const PACKAGE_ACCENT: Record<
  ForgeCommandPackageId,
  { icon: string; chip: string; ring: string }
> = {
  'forge-core': {
    icon: 'text-indigo-400',
    chip: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
    ring: 'ring-indigo-500/40',
  },
  'forge-pi': {
    icon: 'text-violet-400',
    chip: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    ring: 'ring-violet-500/40',
  },
  'forge-browser': {
    icon: 'text-cyan-400',
    chip: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    ring: 'ring-cyan-500/40',
  },
};

export function packageAccent(id: ForgeCommandPackageId) {
  return PACKAGE_ACCENT[id];
}

/**
 * Step 45 — 3-Package Spec-Driven Stack.
 *
 * Tabs rendered above the Forge Skill picker:
 *   - Core workflow   (forge-core)
 *   - Product intelligence  (forge-pi)   — optional
 *   - Browser automation    (forge-browser) — optional
 *
 * When a package is not installed (`counts[id] === null`), the tab is
 * still rendered but dimmed and labeled "(not installed)" so the user
 * knows the capability exists. This is the visible half of the
 * "degrades gracefully" guarantee.
 */
export function PackageNav({ active, onChange, counts }: PackageNavProps) {
  const tabs: Array<{
    id: ForgeCommandPackageId;
    label: string;
    description: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'forge-core',
      label: 'Core workflow',
      description: 'Methodology — capture → explore → execute → verify',
      Icon: Workflow,
    },
    {
      id: 'forge-pi',
      label: 'Product intelligence',
      description: 'Scanner, knowledge graph, idea scorer, voice clustering',
      Icon: Brain,
    },
    {
      id: 'forge-browser',
      label: 'Browser automation',
      description: 'Visual tests, UI review, deployment verification',
      Icon: Globe,
    },
  ];

  return (
    <nav
      aria-label="Forge packages"
      className="flex w-full gap-1 border-b border-border px-2 py-2"
    >
      {tabs.map((tab) => {
        const installed = counts[tab.id] !== null;
        const accent = PACKAGE_ACCENT[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex flex-1 items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
              active === tab.id
                ? `bg-accent text-accent-foreground ring-1 ${accent.ring}`
                : 'hover:bg-accent/60',
              !installed && 'opacity-60',
            )}
            data-package={tab.id}
            data-installed={installed}
          >
            <tab.Icon
              className={cn('mt-0.5 h-4 w-4 shrink-0', accent.icon)}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{tab.label}</span>
                <span
                  className={cn(
                    'ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    installed
                      ? accent.chip
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {installed ? counts[tab.id] : 'not installed'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-1">
                {tab.description}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}