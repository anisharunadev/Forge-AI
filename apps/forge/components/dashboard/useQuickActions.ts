'use client';

/**
 * useQuickActions — localStorage-backed hook for the user's Quick
 * Actions grid (Fix 5).
 *
 * The Quick Actions tile now shows 8 actions split across 4 categories
 * (Forge, Navigate, Agents, Workflows). The user can add/remove and
 * reorder actions via the Quick Actions editor (mirrors the Pin
 * Manager pattern).
 *
 * Storage key: `forge.dashboard.quickActions.v1`
 *
 * Skill influence:
 *   - `ux` (Confirmation Messages) — removing an action requires a
 *     confirm() to avoid accidental loss.
 *   - `ux` (Keyboard Navigation) — actions expose their `shortcut`
 *     as a `<kbd>` inside the card.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type QuickActionIcon =
  | 'sparkles'
  | 'wrench'
  | 'terminal'
  | 'lightbulb'
  | 'command'
  | 'bot'
  | 'flask'
  | 'workflow'
  | 'git'
  | 'play'
  | 'cpu'
  | 'shield';

export interface QuickActionItem {
  id: string;
  label: string;
  icon: QuickActionIcon;
  shortcut: string;
  color: 'indigo' | 'emerald' | 'amber' | 'cyan' | 'violet' | 'rose';
  href: string;
  /** Category bucket used for grouped rendering. */
  category: 'forge' | 'navigate' | 'agents' | 'workflows';
}

export const QUICK_ACTION_CATEGORIES: ReadonlyArray<{
  id: QuickActionItem['category'];
  label: string;
}> = [
  { id: 'forge', label: 'Forge' },
  { id: 'navigate', label: 'Navigate' },
  { id: 'agents', label: 'Agents' },
  { id: 'workflows', label: 'Workflows' },
];

const STORAGE_KEY = 'forge.dashboard.quickActions.v1';

const DEFAULT_QUICK_ACTIONS: ReadonlyArray<QuickActionItem> = [
  // Forge (2)
  { id: 'qa-new-feature', label: 'Run "New feature"', icon: 'sparkles', shortcut: '⌘⇧N', color: 'indigo', href: '/copilot?prompt=Plan%20a%20new%20feature', category: 'forge' },
  { id: 'qa-fix-bug', label: 'Run "Fix bug"', icon: 'wrench', shortcut: '⌘⇧B', color: 'amber', href: '/copilot?prompt=Help%20me%20debug', category: 'forge' },
  // Navigate (3)
  { id: 'qa-terminal', label: 'Open Terminal', icon: 'terminal', shortcut: '⌘⇧T', color: 'emerald', href: '/forge-terminal', category: 'navigate' },
  { id: 'qa-command-center', label: 'Open Command Center', icon: 'command', shortcut: '⌘⇧C', color: 'cyan', href: '/forge-command-center', category: 'navigate' },
  { id: 'qa-copilot', label: 'Open Co-pilot', icon: 'sparkles', shortcut: '⌘⇧P', color: 'violet', href: '/copilot', category: 'navigate' },
  // Agents (2)
  { id: 'qa-code-reviewer', label: 'Talk to Code-Reviewer', icon: 'bot', shortcut: '⌘⇧R', color: 'cyan', href: '/copilot?prompt=Act%20as%20code%20reviewer', category: 'agents' },
  { id: 'qa-test-runner', label: 'Talk to Test-Runner', icon: 'flask', shortcut: '⌘⇧X', color: 'emerald', href: '/copilot?prompt=Run%20test%20suite', category: 'agents' },
  // Workflows (1)
  { id: 'qa-ideation-prd', label: 'Run Ideation → PRD pipeline', icon: 'workflow', shortcut: '⌘⇧W', color: 'indigo', href: '/copilot?prompt=Ideation%20to%20PRD', category: 'workflows' },
];

function readStorage(): ReadonlyArray<QuickActionItem> {
  if (typeof window === 'undefined') return DEFAULT_QUICK_ACTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_ACTIONS;
    const parsed = JSON.parse(raw) as Array<Partial<QuickActionItem>>;
    if (!Array.isArray(parsed)) return DEFAULT_QUICK_ACTIONS;
    return parsed.filter((p): p is QuickActionItem => Boolean(p && typeof p.id === 'string' && typeof p.label === 'string'));
  } catch {
    return DEFAULT_QUICK_ACTIONS;
  }
}

function writeStorage(next: ReadonlyArray<QuickActionItem>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* swallow */
  }
}

export function useQuickActions(): {
  actions: ReadonlyArray<QuickActionItem>;
  mounted: boolean;
  isCustomized: boolean;
  reorder: (id: string, targetIndex: number) => void;
  toggle: (id: string) => void;
  reset: () => void;
} {
  const [mounted, setMounted] = useState(false);
  const [actions, setActions] = useState<ReadonlyArray<QuickActionItem>>(DEFAULT_QUICK_ACTIONS);

  useEffect(() => {
    setActions(readStorage());
    setMounted(true);
  }, []);

  const persist = useCallback((next: ReadonlyArray<QuickActionItem>) => {
    setActions(next);
    writeStorage(next);
  }, []);

  const reorder = useCallback(
    (id: string, targetIndex: number) => {
      const current = actions.slice();
      const from = current.findIndex((a) => a.id === id);
      if (from === -1) return;
      current.splice(from, 1);
      const clamped = Math.max(0, Math.min(targetIndex, current.length));
      current.splice(clamped, 0, current.find((a) => a.id === id)!);
      // We just removed "id" — re-insert it manually.
      const item = actions.find((a) => a.id === id);
      if (!item) return;
      const without = current.filter((a) => a.id !== id);
      without.splice(clamped, 0, item);
      persist(without);
    },
    [actions, persist],
  );

  const toggle = useCallback(
    (id: string) => {
      const isOn = actions.some((a) => a.id === id);
      if (isOn) {
        if (!window.confirm('Remove this action?')) return;
        persist(actions.filter((a) => a.id !== id));
      } else {
        // Add back from defaults if the user previously removed it.
        const fromDefault = DEFAULT_QUICK_ACTIONS.find((a) => a.id === id);
        if (!fromDefault) return;
        persist([...actions, fromDefault]);
      }
    },
    [actions, persist],
  );

  const reset = useCallback(() => persist(DEFAULT_QUICK_ACTIONS), [persist]);

  const isCustomized = useMemo(() => {
    if (actions.length !== DEFAULT_QUICK_ACTIONS.length) return true;
    return actions.some((a, i) => a.id !== DEFAULT_QUICK_ACTIONS[i]?.id);
  }, [actions]);

  return useMemo(
    () => ({ actions, mounted, isCustomized, reorder, toggle, reset }),
    [actions, mounted, isCustomized, reorder, toggle, reset],
  );
}