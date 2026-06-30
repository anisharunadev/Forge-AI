'use client';

/**
 * MarketplaceTab — Zone 5 in the Step 31 spec.
 *
 * Featured carousel · New this month · Trending · grid · submit CTA.
 * Reuses the MarketplaceCard design (kept from Step 10) for the grid.
 *
 * Step 55 wires the "Install" button to the real backend:
 *   - OAuth connectors redirect through `useStartOAuth` → provider
 *     consent screen → callback page → `useCompleteOAuth`.
 *   - API-key / PAT connectors collect the secret in a dialog, then
 *     call `useInstallConnector` with the slug + config.
 */

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  KeyRound,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarketplaceCard } from '@/components/connector-center/MarketplaceCard';
import { listMarketplace, resolveIcon, type Connector } from '@/lib/connectors';
import { fmtCompact } from '../constants';
import { cn } from '@/lib/utils';
import { useMarketplace, useInstallConnector, useStartOAuth } from '@/lib/hooks/useConnectors';

const TABS = ['All', 'Featured', 'New this month', 'Trending'] as const;
type Tab = (typeof TABS)[number];

export function MarketplaceTab() {
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('All');
  const [carouselIdx, setCarouselIdx] = React.useState(0);
  const [pendingInstall, setPendingInstall] = React.useState<Connector | null>(null);

  // Step 55: prefer live marketplace data; fall back to mock.
  const liveMarketplace = useMarketplace();
  const mockMarketplace = listMarketplace();
  const all = (liveMarketplace.data && liveMarketplace.data.length > 0)
    ? liveMarketplace.data.map((m) => ({
        id: m.slug,
        name: m.slug,
        displayName: m.display_name,
        publisher: 'Forge',
        tagline: m.description.split('\n')[0]?.slice(0, 88) ?? '',
        description: m.description,
        category: m.category,
        scope: 'project' as const,
        tier: 1 as const,
        status: 'healthy' as const,
        connectedAs: '',
        lastSyncAt: new Date().toISOString(),
        capabilities: m.capabilities as Connector['capabilities'],
        health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
        credential: {
          id: `cred-${m.slug}`,
          name: `${m.display_name} credential`,
          type: (m.auth_type === 'oauth' ? 'oauth' : 'api_key') as Connector['credential']['type'],
          status: 'active' as const,
          fingerprint: '',
          lastRotatedAt: new Date().toISOString(),
          rotatedBy: '',
          owner: { name: '', initials: '' },
          scopes: m.required_scopes,
          lengthChars: 0,
        },
        usage: {
          workflows: 0,
          destinations: 0,
          ideationSources: 0,
          agentContexts: 0,
          apiCallsToday: 0,
          rateLimitUsed: 0,
          monthlyCostUsd: 0,
        },
        recentEvents: [],
        usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
        installed: false,
        available: true,
        featured: m.is_featured,
        newThisMonth: false,
      }))
    : mockMarketplace;
  const featured = all.filter((c) => c.featured);
  const newThisMonth = all.filter((c) => c.newThisMonth);
  const trending = all.slice(0, 6);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.tagline.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [all, query]);

  const visible = React.useMemo(() => {
    if (tab === 'Featured') return featured;
    if (tab === 'New this month') return newThisMonth;
    if (tab === 'Trending') return trending;
    return filtered;
  }, [tab, featured, newThisMonth, trending, filtered]);

  return (
    <div className="flex flex-col gap-4" data-testid="connector-marketplace-tab">
      {/* Featured carousel */}
      {featured.length > 0 ? (
        <section
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
          data-testid="marketplace-featured"
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-fg-primary">
              <Sparkles className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
              Featured this week
            </h3>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setCarouselIdx((i) => Math.max(0, i - 1))}
                aria-label="Previous"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <span className="text-[10px] text-fg-tertiary">
                {carouselIdx + 1} / {featured.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setCarouselIdx((i) => Math.min(featured.length - 1, i + 1))}
                aria-label="Next"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </header>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {featured.slice(carouselIdx, carouselIdx + 4).map((c) => (
              <FeaturedCard
                key={c.id}
                connector={c}
                onInstall={() => setPendingInstall(c)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search marketplace…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Filter className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[10px]',
                tab === t
                  ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]'
                  : 'border-[var(--border-subtle)] text-fg-tertiary hover:text-fg-secondary',
              )}
              aria-pressed={tab === t}
            >
              {t}
            </button>
          ))}
        </div>
        <a
          href="#"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-tertiary hover:text-fg-secondary"
          data-testid="marketplace-submit"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Submit a connector
        </a>
      </div>

      {/* Grid (reuses the MarketplaceCard kept from Step 10) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((c) => (
          <MarketplaceCard
            key={c.id}
            connector={{
              id: c.id,
              name: c.name,
              displayName: c.displayName,
              category: c.category,
              publisher: c.publisher,
              shortDescription: c.tagline,
              rating: 4.0 + ((c.id.length * 7) % 10) / 10,
              installs: c.usage.apiCallsToday * 3,
            }}
            onInstall={c.installed ? undefined : () => setPendingInstall(c)}
          />
        ))}
        {visible.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed border-[var(--border-default)] p-8 text-center">
            <p className="text-sm text-fg-secondary">No connectors match your search.</p>
          </div>
        ) : null}
      </div>

      {pendingInstall ? (
        <InstallDialog connector={pendingInstall} onClose={() => setPendingInstall(null)} />
      ) : null}
    </div>
  );
}

/**
 * FeaturedCard — featured carousel tile. Step 55 wires the Install
 * button to the parent's pendingInstall state.
 */
function FeaturedCard({ connector, onInstall }: { connector: Connector; onInstall: () => void }) {
  const Icon = resolveIcon(connector.id);
  return (
    <div className="flex flex-col rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
      <div className="flex items-start gap-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] text-fg-secondary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-fg-primary">{connector.displayName}</h4>
          <p className="text-[11px] text-fg-tertiary">{connector.tagline}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-fg-secondary">{connector.description.slice(0, 88)}…</p>
      <div className="mt-3 flex items-center justify-between text-[10px] text-fg-tertiary">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 text-[var(--accent-amber)]" aria-hidden="true" />
            {(4.2 + (connector.id.length % 8) / 10).toFixed(1)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {fmtCompact(connector.usage.apiCallsToday * 8)}
          </span>
        </span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onInstall}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Install
        </Button>
      </div>
    </div>
  );
}

/**
 * InstallDialog — Step 55.
 *
 * Branches on connector credential type:
 *   - OAuth → startOAuth() → redirect to provider.
 *   - API key / PAT → collect the secret in a dialog and call
 *     `installConnector({ slug, config })`.
 */
function InstallDialog({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const install = useInstallConnector();
  const startOAuth = useStartOAuth();
  const [secret, setSecret] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const isOAuth = connector.credential.type === 'oauth';
  const slug = connector.slug ?? connector.name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (isOAuth) {
        const result = await startOAuth.mutateAsync({
          slug,
          redirectUri: `${window.location.origin}/connector-center/oauth/callback`,
        });
        // CSRF: stash state for the callback page.
        sessionStorage.setItem('forge.oauth.state', result.state);
        sessionStorage.setItem('forge.oauth.slug', slug);
        window.location.href = result.authorize_url;
      } else {
        await install.mutateAsync({
          slug,
          config: { api_key: secret },
        });
        onClose();
      }
    } catch {
      // toast handled by the hook
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[480px] max-w-[92vw] rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-md)]"
      >
        <h3 className="text-base font-semibold text-fg-primary">
          Install {connector.displayName}
        </h3>
        <p className="mt-1 text-xs text-fg-tertiary">{connector.tagline}</p>

        {isOAuth ? (
          <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-fg-secondary">
            This connector uses OAuth. Clicking <strong>Connect</strong> redirects you to the provider
            consent screen. Forge never sees your password.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-[11px] uppercase tracking-wider text-fg-tertiary">
              API key / token
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="sk_live_…"
                className="h-9 pl-7 font-mono text-xs"
                autoFocus
                required
              />
            </div>
            <p className="text-[10px] text-fg-tertiary">
              Stored encrypted. Reveal/rotate actions are audited.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={busy || (!isOAuth && !secret)}>
            {busy ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Working…
              </>
            ) : isOAuth ? (
              'Connect'
            ) : (
              'Install'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}