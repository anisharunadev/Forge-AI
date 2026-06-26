'use client';

/**
 * Dashboard preferences — per-user customization state for the
 * Mission Control surface (Step 25).
 *
 * Stored in `localStorage` under `forge.dashboard.prefs.v1` so the
 * Customize drawer can persist across reloads without a backend round
 * trip. The shape is intentionally narrow (refresh interval, density,
 * widget visibility, pin set) so the storage payload stays under
 * ~2 KB even when every widget is configured.
 *
 * Skill influence:
 *   - `ux` (Confirmation Messages) — `resetToDefault()` is the only
 *     destructive op and the drawer asks before calling it.
 *   - `ux` (Keyboard Navigation) — focus rings are the consumer's job;
 *     this module just owns state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type RefreshInterval = 'realtime' | '30s' | '5m' | 'manual';
export type Density = 'comfortable' | 'compact';

export const ALL_WIDGETS = [
  'kpi-strip',
  'live-activity',
  'your-agents',
  'today-runs',
  'cost-breakdown',
  'runs-over-time',
  'top-agents',
  'pending-approvals',
  'recent-ideas',
  'ai-insights',
  'personal-stats',
  'pinned',
  'quick-actions',
  'team-activity',
  'recent-alerts',
] as const;

export type WidgetId = (typeof ALL_WIDGETS)[number];

export type WidgetVisibility = Record<WidgetId, boolean>;

export interface DashboardPrefs {
  refresh: RefreshInterval;
  density: Density;
  visibility: WidgetVisibility;
  /** Persisted widget display order (Fix 6). Defaults to ALL_WIDGETS order. */
  widgetOrder: ReadonlyArray<WidgetId>;
  pins: ReadonlyArray<string>;
}

function freshVisibility(): WidgetVisibility {
  return Object.fromEntries(ALL_WIDGETS.map((w) => [w, true])) as WidgetVisibility;
}

const STORAGE_KEY = 'forge.dashboard.prefs.v1';

function allVisible(): WidgetVisibility {
  return freshVisibility();
}

void allVisible; // reserved for future "show all" affordance

export function defaultPrefs(): DashboardPrefs {
  return {
    refresh: 'realtime',
    density: 'comfortable',
    visibility: freshVisibility(),
    widgetOrder: [...ALL_WIDGETS],
    pins: [
      'cmd:new-feature',
      'cmd:fix-bug',
      'agent:atlas',
      'agent:aria',
      'page:runs',
      'page:ideation',
    ],
  };
}

/**
 * Apply a preset layout — toggles visibility to match the preset's
 * curated widget list. Widgets not listed default to OFF.
 */
export function presetLayout(name: 'engineering-lead' | 'product-manager' | 'operator'): DashboardPrefs {
  const base = defaultPrefs();
  const off = (): WidgetVisibility =>
    Object.fromEntries(ALL_WIDGETS.map((w) => [w, false])) as WidgetVisibility;
  const on = (keys: ReadonlyArray<WidgetId>): WidgetVisibility => {
    const v = off();
    for (const k of keys) v[k] = true;
    return v;
  };
  switch (name) {
    case 'engineering-lead':
      return { ...base, visibility: on(['kpi-strip', 'live-activity', 'your-agents', 'today-runs', 'runs-over-time', 'top-agents', 'cost-breakdown', 'recent-alerts']) };
    case 'product-manager':
      return { ...base, visibility: on(['kpi-strip', 'pending-approvals', 'recent-ideas', 'team-activity', 'ai-insights', 'personal-stats', 'recent-alerts']) };
    case 'operator':
      return { ...base, visibility: on(['live-activity', 'today-runs', 'cost-breakdown', 'recent-alerts', 'pending-approvals']) };
    default:
      return base;
  }
}

function readStorage(): DashboardPrefs {
  if (typeof window === 'undefined') return defaultPrefs();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    const base = defaultPrefs();
    const next: WidgetVisibility = { ...base.visibility };
    if (parsed.visibility && typeof parsed.visibility === 'object') {
      for (const [k, v] of Object.entries(parsed.visibility)) {
        if (k in next) next[k as WidgetId] = Boolean(v);
      }
    }
    const order: ReadonlyArray<WidgetId> = Array.isArray(parsed.widgetOrder)
      ? (parsed.widgetOrder.filter((w): w is WidgetId =>
          ALL_WIDGETS.includes(w as WidgetId),
        ) as ReadonlyArray<WidgetId>)
      : base.widgetOrder;
    // Append any new widgets that didn't exist when the order was saved.
    const missing = base.widgetOrder.filter((w) => !order.includes(w));
    return {
      refresh: parsed.refresh ?? base.refresh,
      density: parsed.density ?? base.density,
      visibility: next,
      widgetOrder: [...order, ...missing],
      pins: Array.isArray(parsed.pins) ? parsed.pins.slice(0, 8) : base.pins,
    };
  } catch {
    return defaultPrefs();
  }
}

function writeStorage(prefs: DashboardPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may throw in private mode; swallow silently.
  }
}

/**
 * Subscribes the caller to dashboard prefs and persists every change
 * back to localStorage. SSR-safe — returns defaults until mounted.
 */
export function useDashboardPrefs(): {
  prefs: DashboardPrefs;
  mounted: boolean;
  setRefresh: (r: RefreshInterval) => void;
  setDensity: (d: Density) => void;
  toggleWidget: (w: WidgetId) => void;
  reorderWidgets: (orderedIds: ReadonlyArray<WidgetId>) => void;
  applyPreset: (p: 'engineering-lead' | 'product-manager' | 'operator') => void;
  resetToDefault: () => void;
  togglePin: (pinId: string) => void;
  reorderPin: (pinId: string, targetIndex: number) => void;
} {
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<DashboardPrefs>(defaultPrefs);

  useEffect(() => {
    setPrefs(readStorage());
    setMounted(true);
  }, []);

  const persist = useCallback((next: DashboardPrefs) => {
    setPrefs(next);
    writeStorage(next);
  }, []);

  const setRefresh = useCallback(
    (refresh: RefreshInterval) => persist({ ...prefs, refresh }),
    [prefs, persist],
  );
  const setDensity = useCallback(
    (density: Density) => persist({ ...prefs, density }),
    [prefs, persist],
  );
  const toggleWidget = useCallback(
    (w: WidgetId) =>
      persist({ ...prefs, visibility: { ...prefs.visibility, [w]: !prefs.visibility[w] } }),
    [prefs, persist],
  );
  const reorderWidgets = useCallback(
    (orderedIds: ReadonlyArray<WidgetId>) => {
      const valid = orderedIds.filter((w): w is WidgetId =>
        ALL_WIDGETS.includes(w as WidgetId),
      );
      // Ensure every widget appears exactly once.
      const missing = ALL_WIDGETS.filter((w) => !valid.includes(w));
      persist({ ...prefs, widgetOrder: [...valid, ...missing] });
    },
    [prefs, persist],
  );
  const applyPreset = useCallback(
    (p: 'engineering-lead' | 'product-manager' | 'operator') => persist(presetLayout(p)),
    [persist],
  );
  const resetToDefault = useCallback(() => persist(defaultPrefs()), [persist]);
  const togglePin = useCallback(
    (pinId: string) => {
      const exists = prefs.pins.includes(pinId);
      let nextPins: ReadonlyArray<string>;
      if (exists) {
        nextPins = prefs.pins.filter((p) => p !== pinId);
      } else if (prefs.pins.length >= 8) {
        return; // cap at 8 pins
      } else {
        nextPins = [...prefs.pins, pinId];
      }
      persist({ ...prefs, pins: nextPins });
    },
    [prefs, persist],
  );
  const reorderPin = useCallback(
    (pinId: string, targetIndex: number) => {
      const current = prefs.pins.slice();
      const from = current.indexOf(pinId);
      if (from === -1) return;
      current.splice(from, 1);
      const clamped = Math.max(0, Math.min(targetIndex, current.length));
      current.splice(clamped, 0, pinId);
      persist({ ...prefs, pins: current });
    },
    [prefs, persist],
  );

  return useMemo(
    () => ({
      prefs,
      mounted,
      setRefresh,
      setDensity,
      toggleWidget,
      reorderWidgets,
      applyPreset,
      resetToDefault,
      togglePin,
      reorderPin,
    }),
    [
      prefs,
      mounted,
      setRefresh,
      setDensity,
      toggleWidget,
      reorderWidgets,
      applyPreset,
      resetToDefault,
      togglePin,
      reorderPin,
    ],
  );
}