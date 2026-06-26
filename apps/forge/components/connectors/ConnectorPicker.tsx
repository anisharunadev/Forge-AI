'use client';

/**
 * ConnectorPicker — context-aware connector selector.
 *
 * Usage:
 *   <ConnectorPicker capability="send_message" onSelect={(c) => ...} />
 *   <ConnectorPicker capability="pull_issues" defaultOpen showSearch />
 *
 * Renders a combobox-style trigger. When opened, lists installed
 * connectors that support the requested capability, with category
 * grouping and search. If no connectors match, falls back to a
 * `ConnectorCredentialsBadge` linking to the marketplace.
 *
 * Always renders inside a `ConnectorProvider` so it can read installed
 * connectors. Outside a provider, it short-circuits to a hint pill.
 */

import * as React from 'react';
import {
  Check,
  ChevronDown,
  Plug,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectorCredentialsBadge } from './ConnectorCredentialsBadge';
import { ConnectorHealthIndicator } from './ConnectorHealthIndicator';
import { cn } from '@/lib/utils';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  resolveIcon,
  useConnectorsOptional,
  type Connector,
  type ConnectorCapability,
} from '@/lib/connectors';

const CAPABILITY_LABEL: Record<ConnectorCapability, string> = {
  pull_issues: 'pull issues',
  pull_prs: 'pull pull requests',
  pull_commits: 'pull commits',
  create_ticket: 'create a ticket',
  update_ticket: 'update a ticket',
  send_message: 'send a message',
  send_email: 'send an email',
  query_database: 'query a database',
  read_warehouse: 'read a warehouse',
  push_metrics: 'push metrics',
  read_alerts: 'read alerts',
  read_design: 'read designs',
  push_design: 'push designs',
  trigger_deploy: 'trigger a deploy',
  read_logs: 'read logs',
  search_docs: 'search docs',
};

export interface ConnectorPickerProps {
  readonly capability: ConnectorCapability;
  readonly onSelect?: (connector: Connector) => void;
  readonly triggerLabel?: string;
  readonly defaultOpen?: boolean;
  readonly showSearch?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly align?: 'left' | 'right';
  readonly className?: string;
}

export function ConnectorPicker({
  capability,
  onSelect,
  triggerLabel,
  defaultOpen = false,
  showSearch = true,
  disabled = false,
  placeholder,
  align = 'left',
  className,
}: ConnectorPickerProps) {
  const ctx = useConnectorsOptional();
  const [open, setOpen] = React.useState(defaultOpen);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<Connector | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const matches = React.useMemo(() => {
    if (!ctx) return [];
    return ctx.byCapability(capability);
  }, [ctx, capability]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.tagline.toLowerCase().includes(q),
    );
  }, [matches, query]);

  // Group by category.
  const grouped = React.useMemo(() => {
    const groups = new Map<string, Connector[]>();
    for (const c of filtered) {
      const arr = groups.get(c.category) ?? [];
      arr.push(c);
      groups.set(c.category, arr);
    }
    return CATEGORY_ORDER
      .filter((cat) => groups.has(cat))
      .map((cat) => ({ category: cat, items: groups.get(cat)! }));
  }, [filtered]);

  if (!ctx) {
    return (
      <ConnectorCredentialsBadge
        connectorId="__provider_missing__"
        displayName="connector provider"
      />
    );
  }

  const handleSelect = (c: Connector) => {
    setSelected(c);
    setOpen(false);
    onSelect?.(c);
  };

  const triggerText = selected
    ? selected.displayName
    : triggerLabel ?? `Pick a connector · ${CAPABILITY_LABEL[capability]}`;

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        data-testid="connector-picker-trigger"
        data-capability={capability}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm transition-colors',
          'hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]',
          disabled && 'cursor-not-allowed opacity-50',
          open && 'border-[var(--accent-cyan)]',
        )}
      >
        {selected ? (
          <>
            {React.createElement(resolveIcon(selected.id), {
              className: 'h-4 w-4 text-fg-secondary',
              'aria-hidden': true,
            })}
            <span className="text-fg-primary">{triggerText}</span>
            <ConnectorHealthIndicator
              connectorId={selected.id}
              status={selected.status}
              size="xs"
            />
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(null);
                }
              }}
              className="ml-1 cursor-pointer text-fg-tertiary hover:text-fg-primary"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </span>
          </>
        ) : (
          <>
            <Plug className="h-4 w-4 text-fg-tertiary" aria-hidden="true" />
            <span className="text-fg-secondary">{triggerText}</span>
            <ChevronDown className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
          </>
        )}
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Choose a connector"
          className={cn(
            'absolute z-50 mt-1 w-[340px] overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          data-testid="connector-picker-list"
        >
          {showSearch ? (
            <div className="border-b border-[var(--border-subtle)] p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={placeholder ?? `Search ${matches.length} connector${matches.length === 1 ? '' : 's'}…`}
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
          ) : null}

          {matches.length === 0 ? (
            <div className="p-3">
              <ConnectorCredentialsBadge
                connectorId="__none__"
                displayName={`a ${CAPABILITY_LABEL[capability]} source`}
                variant="block"
                onConnect={() => setOpen(false)}
              />
              <p className="mt-2 px-1 text-[11px] text-fg-tertiary">
                No installed connectors support this. Browse the marketplace to install one.
              </p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="p-4 text-center text-xs text-fg-tertiary">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {grouped.map(({ category, items }) => (
                <div key={category}>
                  <div className="sticky top-0 z-10 bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                    {CATEGORY_LABEL[category]}
                  </div>
                  <ul role="group">
                    {items.map((c) => {
                      const Icon = resolveIcon(c.id);
                      const isSelected = selected?.id === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleSelect(c)}
                            data-testid="connector-picker-option"
                            data-connector-id={c.id}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                              'hover:bg-[var(--bg-surface)]',
                              isSelected && 'bg-[var(--bg-surface)]',
                            )}
                          >
                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] text-fg-secondary">
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-fg-primary">{c.displayName}</span>
                              <span className="block truncate text-[11px] text-fg-tertiary">{c.tagline}</span>
                            </span>
                            <ConnectorHealthIndicator
                              connectorId={c.id}
                              status={c.status}
                              size="xs"
                            />
                            {isSelected ? (
                              <Check className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[10px] text-fg-tertiary">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {matches.length} installed · {CAPABILITY_LABEL[capability]}
            </span>
            <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[10px]">
              <a href="/connector-center">Manage →</a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}