/**
 * Connector Center — shared constants used by all tab components.
 */

import {
  Activity as ActivityIcon,
  Key,
  Plug,
  ShoppingBag,
  Stethoscope,
  History,
  LayoutDashboard,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

import type { ConnectorHealthStatus } from '@/lib/connectors';

export type TabValue =
  | 'overview'
  | 'connected'
  | 'marketplace'
  | 'health'
  | 'activity'
  | 'credentials'
  | 'webhooks';

export interface TabDef {
  readonly value: TabValue;
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Optional badge key — counts rendered inside the tab. */
  readonly badgeKey?: 'connected' | 'marketplace' | 'credentials';
  /** When true, render a small live status dot beside the label. */
  readonly liveDot?: boolean;
}

export const TABS: ReadonlyArray<TabDef> = [
  { value: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { value: 'connected', label: 'Connected', Icon: Plug, badgeKey: 'connected' },
  { value: 'marketplace', label: 'Marketplace', Icon: ShoppingBag, badgeKey: 'marketplace' },
  { value: 'health', label: 'Health', Icon: Stethoscope, liveDot: true },
  { value: 'activity', label: 'Activity', Icon: History },
  { value: 'credentials', label: 'Credentials', Icon: Key, badgeKey: 'credentials' },
  { value: 'webhooks', label: 'Webhooks', Icon: Webhook },
];

/** Status dot — single source of truth for connector health colors. */
export const STATUS_DOT_CLASS: Record<ConnectorHealthStatus, string> = {
  healthy: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  syncing: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]',
  stale: 'bg-[var(--accent-amber)]',
  failed: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  quarantined: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  paused: 'bg-[var(--fg-tertiary)]',
};

export const STATUS_LABEL: Record<ConnectorHealthStatus, string> = {
  healthy: 'Healthy',
  syncing: 'Syncing',
  stale: 'Stale',
  failed: 'Failed',
  quarantined: 'Quarantined',
  paused: 'Paused',
};

export function fmtTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  if (diff < 0) return 'soon';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function maskSecret(len: number): string {
  return '•'.repeat(Math.min(Math.max(len, 6), 12));
}