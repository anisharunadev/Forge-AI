'use client';

/**
 * Connector Center — Step 31 modernization.
 *
 * Replaces the Step 10 page (4 tabs) with a 7-tab experience and
 * delegates all data + capability lookup to `@/lib/connectors`.
 *
 * Zones covered:
 *   - Z1 Hero band + global tools
 *   - Z2 7-tab segmented control
 *   - Z3–Z9 tab bodies (delegated to ./tabs/*)
 *   - Z11 Connections graph (extra view triggered from Overview)
 *   - Z12 Keyboard shortcuts (⌘⇧C picker, ⌘⇧K credential, ⌘⇧W webhook)
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  BookText,
  HelpCircle,
  MoreVertical,
  Plug,
  Plus,
  type LucideIcon,
} from 'lucide-react';

import { PageContainer } from '@/components/shell/PageContainer';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConnectorPicker } from '@/components/connectors/ConnectorPicker';
import { ConnectorProvider, listConnected, listMarketplace, listCredentials, computeRollup } from '@/lib/connectors';
import { cn } from '@/lib/utils';

import { OverviewTab } from '@/components/connector-center/tabs/OverviewTab';
import { ConnectedTab } from '@/components/connector-center/tabs/ConnectedTab';
import { MarketplaceTab } from '@/components/connector-center/tabs/MarketplaceTab';
import { HealthTab } from '@/components/connector-center/tabs/HealthTab';
import { ActivityTab } from '@/components/connector-center/tabs/ActivityTab';
import { CredentialsTab } from '@/components/connector-center/tabs/CredentialsTab';
import { WebhooksTab } from '@/components/connector-center/tabs/WebhooksTab';
import { ConnectionsTab } from '@/components/connector-center/tabs/ConnectionsTab';
import { TABS, type TabValue } from '@/components/connector-center/constants';
import { LiveConnectorDataProvider } from '@/components/connector-center/LiveConnectorDataProvider';

const TAB_LABEL: Record<TabValue, string> = {
  overview: 'Overview',
  connected: 'Connected',
  marketplace: 'Marketplace',
  health: 'Health',
  activity: 'Activity',
  credentials: 'Credentials',
  webhooks: 'Webhooks',
};

function isTabValue(v: string | null): v is TabValue {
  return v === 'overview' || v === 'connected' || v === 'marketplace' || v === 'health' || v === 'activity' || v === 'credentials' || v === 'webhooks';
}

export default function ConnectorCenterPage() {
  const [tab, setTab] = React.useState<TabValue>('overview');
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Sync tab with URL hash for shareable links (#tab=health).
  React.useEffect(() => {
    const fromHash = () => {
      const m = /tab=([a-z]+)/.exec(window.location.hash);
      const v = m?.[1] ?? null;
      if (isTabValue(v)) setTab(v);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const setTabAndHash = (v: TabValue) => {
    setTab(v);
    window.history.replaceState(null, '', `#tab=${v}`);
  };

  // Global shortcuts per Zone 12.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setPickerOpen(true);
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTabAndHash('credentials');
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        setTabAndHash('webhooks');
      }
      if (meta && e.key === '/') {
        e.preventDefault();
        // hint: simple alert so the user sees the binding; would be a popover
        window.alert('Shortcuts\n⌘⇧C · Connector picker\n⌘⇧K · New credential\n⌘⇧W · New webhook\n⌘/ · Show shortcuts');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const rollup = computeRollup();
  const connectedCount = listConnected().length;
  const marketplaceCount = listMarketplace().length;
  const credentialsCount = listCredentials().length;

  const counts: Record<'connected' | 'marketplace' | 'credentials', number> = {
    connected: connectedCount,
    marketplace: marketplaceCount,
    credentials: credentialsCount,
  };

  return (
    <LiveConnectorDataProvider>
      <PageContainer>
        <div className="flex flex-col gap-6" data-testid="connector-center-page">
          <HeroBand
            connected={rollup.connected}
            failing={rollup.failed + rollup.quarantined}
            syncsToday={rollup.syncsToday}
            onAddConnector={() => setTabAndHash('marketplace')}
          />

          <TabBar tab={tab} counts={counts} onChange={setTabAndHash} />

          <div data-testid={`connector-tab-${tab}`}>
            {tab === 'overview' ? <OverviewTab /> : null}
            {tab === 'connected' ? <ConnectedTab /> : null}
            {tab === 'marketplace' ? <MarketplaceTab /> : null}
            {tab === 'health' ? <HealthTab /> : null}
            {tab === 'activity' ? <ActivityTab /> : null}
            {tab === 'credentials' ? <CredentialsTab /> : null}
            {tab === 'webhooks' ? <WebhooksTab /> : null}
          </div>
        </div>
      </PageContainer>

      {/* Global shortcut: ⌘⇧C */}
      {pickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center pt-24"
          onClick={() => setPickerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
          <div
            className="relative w-[420px] max-w-[92vw] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-md)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold text-fg-primary">Pick a connector anywhere</h3>
            <p className="mb-4 text-xs text-fg-tertiary">
              Choose a capability, then a connector that supports it. Used by Ideation sources, Workflow nodes, Co-pilot @mentions and agent contexts.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['send_message', 'pull_issues', 'trigger_deploy', 'query_database'] as const).map((cap) => (
                <div key={cap} className="flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
                  <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">{cap.replace(/_/g, ' ')}</span>
                  <ConnectorPicker capability={cap} defaultOpen />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </LiveConnectorDataProvider>
  );
}

interface HeroBandProps {
  connected: number;
  failing: number;
  syncsToday: number;
  onAddConnector: () => void;
}

function HeroBand({ connected, failing, syncsToday }: HeroBandProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 hero-border"
      data-testid="connector-hero"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-fg-tertiary">Center</p>
          <div className="mt-1 flex items-center gap-2">
            <Plug className="h-7 w-7 text-[var(--accent-cyan)]" aria-hidden="true" />
            <h1 className="text-3xl font-bold tracking-tight text-fg-primary">Connector Center</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
            Manage integrations with external systems, browse the marketplace, review connector health, vault credentials and wire webhooks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Composite health overview pill */}
          <div
            className={cn(
              'inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs',
              failing > 0
                ? 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]'
                : 'border-[var(--accent-emerald)]/40 bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)]',
            )}
            data-testid="connector-hero-health"
            aria-label={`${connected} connected · ${failing} failing · ${syncsToday} syncs today`}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                failing > 0
                  ? 'bg-[var(--accent-amber)] shadow-[0_0_6px_var(--accent-amber)] animate-pulse'
                  : 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
              )}
              aria-hidden="true"
            />
            <span className="font-medium text-fg-primary">{connected} connected</span>
            <span aria-hidden="true">·</span>
            <span className={failing > 0 ? 'font-medium' : 'text-fg-secondary'}>{failing} failing</span>
            <span aria-hidden="true">·</span>
            <span className="text-fg-secondary">{syncsToday} syncs today</span>
          </div>

          <Button size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Connector
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More">
                <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <BookText className="h-3.5 w-3.5" aria-hidden="true" />
                API documentation
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Request new connector
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Help
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}

interface TabBarProps {
  tab: TabValue;
  counts: { connected: number; marketplace: number; credentials: number };
  onChange: (v: TabValue) => void;
}

function TabBar({ tab, counts, onChange }: TabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Connector center tabs"
      className="inline-flex w-fit rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-0.5"
      data-testid="connector-tab-bar"
    >
      {TABS.map((t) => {
        const Icon = t.Icon as LucideIcon;
        const active = t.value === tab;
        const count = t.badgeKey ? counts[t.badgeKey] : null;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--bg-surface)] text-fg-primary'
                : 'text-fg-tertiary hover:text-fg-secondary',
            )}
            data-testid={`connector-tab-${t.value}-tab`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t.label}
            {count !== null ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  active
                    ? 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                    : 'bg-[var(--bg-inset)] text-fg-tertiary',
                )}
              >
                {count}
              </span>
            ) : null}
            {t.liveDot ? (
              <span
                className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)] animate-pulse"
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}