'use client';

/**
 * MarketplaceTab — Zone 5 in the Step 31 spec.
 *
 * Featured carousel · New this month · Trending · grid · submit CTA.
 * Reuses the MarketplaceCard design (kept from Step 10) for the grid.
 */

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
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

const TABS = ['All', 'Featured', 'New this month', 'Trending'] as const;
type Tab = (typeof TABS)[number];

export function MarketplaceTab() {
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('All');
  const [carouselIdx, setCarouselIdx] = React.useState(0);

  const all = listMarketplace();
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
              <FeaturedCard key={c.id} connector={c} />
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
          />
        ))}
        {visible.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed border-[var(--border-default)] p-8 text-center">
            <p className="text-sm text-fg-secondary">No connectors match your search.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FeaturedCard({ connector }: { connector: Connector }) {
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
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">
          <Plus className="h-3 w-3" aria-hidden="true" />
          Install
        </Button>
      </div>
    </div>
  );
}