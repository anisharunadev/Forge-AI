'use client';

/**
 * Templates tab — grid of template cards (Zone 5).
 *
 * Responsive: 3 cols ≥1440px, 2 cols ≥1024px, 1 col <1024px. Each card
 * shows icon + type, title, author, description, variable count, usage
 * sparkline, and a CTA. Hover reveals a preview thumbnail.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  GitBranch,
  Bug,
  PlayCircle,
  MessageSquare,
  Layers,
  Sparkles,
  Plus,
} from 'lucide-react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
} from 'recharts';

import { cn } from '@/lib/utils';
import type { Template, TemplateKind } from '@/lib/org-knowledge/data';
import { TEMPLATE_KIND_LABEL } from '@/lib/org-knowledge/data';

interface Props {
  templates: ReadonlyArray<Template>;
  onUse: (t: Template) => void;
}

const TYPE_ICON: Record<TemplateKind, React.ComponentType<{ className?: string }>> = {
  prd: FileText,
  adr: GitBranch,
  contract: Layers,
  task: Plus,
  risk: AlertOctagon,
  security: ShieldIcon,
};

const TYPE_COLOR: Record<TemplateKind, string> = {
  prd: 'var(--accent-primary)',
  adr: 'var(--accent-violet)',
  contract: 'var(--accent-cyan)',
  task: 'var(--accent-amber)',
  risk: 'var(--accent-rose)',
  security: 'var(--accent-emerald)',
};

// Inline stub icons — kept inside this file to avoid extra imports.
function AlertOctagon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className} fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ShieldIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function sparkline(seed: number) {
  const data = Array.from({ length: 12 }, (_, i) => ({
    i,
    v: Math.max(2, Math.round(Math.sin((i + seed) / 1.5) * 5 + 8 + (i % 3))),
  }));
  return data;
}

const FILTER_TYPES: ReadonlyArray<{ id: 'all' | TemplateKind | 'custom'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'prd', label: 'PRD' },
  { id: 'adr', label: 'ADR' },
  { id: 'contract', label: 'API' },
  { id: 'task', label: 'Task' },
  { id: 'risk', label: 'Risk' },
  { id: 'security', label: 'Security' },
];

export function TemplateGrid({ templates, onUse }: Props) {
  const [filter, setFilter] = React.useState<(typeof FILTER_TYPES)[number]['id']>('all');
  const [hovered, setHovered] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    if (filter === 'all') return templates;
    return templates.filter((t) => t.kind === filter);
  }, [filter, templates]);

  return (
    <div className="flex flex-col gap-4" data-testid="ok-templates">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Template types">
        {FILTER_TYPES.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            data-testid={`ok-template-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius-md)] border px-2.5 py-1 text-xs transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              filter === f.id
                ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          data-testid="ok-template-add-custom"
        >
          <Plus className="h-2.5 w-2.5" aria-hidden="true" /> Custom template
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] p-12 text-center text-xs text-[var(--fg-muted)]">
          No templates match this filter.
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          data-testid="ok-template-grid"
        >
          {visible.map((t, idx) => {
            const Icon = TYPE_ICON[t.kind];
            const isHovered = hovered === t.id;
            return (
              <motion.li
                key={t.id}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered(null)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.18 }}
                whileHover={{ y: -2 }}
                className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-shadow hover:shadow-[var(--shadow-md)]"
                data-testid="ok-template-card"
              >
                <header className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-elevated)]"
                      style={{ color: TYPE_COLOR[t.kind] }}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span
                      className="rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
                      style={{ background: `${TYPE_COLOR[t.kind]}20`, color: TYPE_COLOR[t.kind] }}
                    >
                      {TEMPLATE_KIND_LABEL[t.kind]}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{t.id}</span>
                </header>

                <div>
                  <h3 className="text-base font-semibold text-[var(--fg-primary)]">{t.title}</h3>
                  <p className="mt-0.5 text-[10px] text-[var(--fg-tertiary)]">by {t.owner}</p>
                </div>

                <p className="line-clamp-2 text-xs text-[var(--fg-secondary)]">{t.description}</p>

                <div className="flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5 text-[var(--accent-cyan)]" aria-hidden="true" />
                    {Math.max(2, Math.round((t.preview?.length ?? 0) / 80))} variables
                  </span>
                  <span className="font-mono">Used {t.uses}× this month</span>
                </div>

                <div className="-mx-1 h-10" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparkline(idx + t.id.length)}>
                      <Line
                        type="monotone"
                        dataKey="v"
                        stroke={TYPE_COLOR[t.kind]}
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <footer className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onUse(t)}
                    data-testid="ok-template-use"
                    className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    Use template
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    Preview →
                  </button>
                </footer>

                {isHovered ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--accent-primary)]/30 bg-[var(--bg-elevated)] p-2 text-[10px] text-[var(--fg-secondary)]">
                    <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                      Preview
                    </p>
                    <pre className="thin-scrollbar max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                      {t.preview?.slice(0, 280) ?? 'No preview available.'}
                    </pre>
                  </div>
                ) : null}
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}