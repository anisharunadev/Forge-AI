'use client';

/**
 * Best Practices tab (F-005) — learning-focused layout.
 *
 * Featured practices (2-col large cards) + all practices (3-col grid).
 * Each card has a category, author, reading time, and a "Mark as read"
 * toggle. A progress bar at the top shows how many practices the user
 * has read.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Sparkles,
  Code2,
  TestTube2,
  ShieldCheck,
  Gauge,
  Users,
  FileText,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { BEST_PRACTICES, type BestPractice } from './sample-data';

const CATEGORY_META: Record<
  BestPractice['category'],
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  'code-quality': { label: 'Code quality', tone: 'var(--accent-primary)', icon: Code2 },
  testing: { label: 'Testing', tone: 'var(--accent-cyan)', icon: TestTube2 },
  security: { label: 'Security', tone: 'var(--accent-emerald)', icon: ShieldCheck },
  performance: { label: 'Performance', tone: 'var(--accent-amber)', icon: Gauge },
  collaboration: { label: 'Collaboration', tone: 'var(--accent-violet)', icon: Users },
  documentation: { label: 'Documentation', tone: 'var(--accent-rose)', icon: FileText },
};

const FILTERS: ReadonlyArray<{ id: BestPractice['category'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'code-quality', label: 'Code quality' },
  { id: 'testing', label: 'Testing' },
  { id: 'security', label: 'Security' },
  { id: 'performance', label: 'Performance' },
  { id: 'collaboration', label: 'Collaboration' },
  { id: 'documentation', label: 'Documentation' },
];

export function BestPracticesTab() {
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]['id']>('all');
  const [practices, setPractices] = React.useState<ReadonlyArray<BestPractice>>(BEST_PRACTICES);

  const read = practices.filter((p) => p.read).length;
  const total = practices.length;
  const pct = Math.round((read / Math.max(1, total)) * 100);

  const toggle = (id: string) =>
    setPractices((curr) => curr.map((p) => (p.id === id ? { ...p, read: !p.read } : p)));

  const featured = practices.filter((p) => p.featured && (filter === 'all' || p.category === filter));
  const rest = practices.filter((p) => !p.featured && (filter === 'all' || p.category === filter));

  return (
    <div className="flex flex-col gap-6" data-testid="ok-best-practices">
      {/* Progress tracker */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
            <span>
              You've read{' '}
              <span className="font-mono font-semibold text-[var(--fg-primary)]">
                {read} of {total}
              </span>{' '}
              practices
            </span>
            <span className="font-mono text-[var(--fg-tertiary)]">({pct}%)</span>
          </div>
          <p className="text-[10px] text-[var(--fg-tertiary)]">Recommended next → testing pyramids</p>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-violet)]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Practice categories">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            data-testid={`ok-bp-filter-${f.id}`}
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
      </div>

      {featured.length > 0 ? (
        <section
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          data-testid="ok-bp-featured"
          aria-label="Featured practices"
        >
          {featured.map((p) => (
            <FeaturedCard key={p.id} practice={p} onToggle={toggle} />
          ))}
        </section>
      ) : null}

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        data-testid="ok-bp-grid"
        aria-label="All practices"
      >
        {rest.map((p) => (
          <PracticeCard key={p.id} practice={p} onToggle={toggle} />
        ))}
      </section>
    </div>
  );
}

function FeaturedCard({
  practice,
  onToggle,
}: {
  practice: BestPractice;
  onToggle: (id: string) => void;
}) {
  const meta = CATEGORY_META[practice.category];
  const Icon = meta.icon;
  return (
    <motion.article
      layout
      data-testid="ok-bp-featured-card"
      className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div
        aria-hidden="true"
        className="h-32 w-full"
        style={{
          background: `linear-gradient(135deg, ${meta.tone}33, transparent 60%)`,
        }}
      />
      <div className="space-y-3 p-5">
        <header className="flex items-center gap-2">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]"
            style={{ background: `${meta.tone}20`, color: meta.tone }}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            style={{ background: `${meta.tone}20`, color: meta.tone }}
          >
            Featured · {meta.label}
          </span>
          <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">{practice.id}</span>
        </header>
        <h3 className="text-base font-semibold text-[var(--fg-primary)]">{practice.title}</h3>
        <p className="text-sm text-[var(--fg-secondary)]">{practice.summary}</p>
        <footer className="flex items-center justify-between gap-2 text-xs text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-inset)] font-mono text-[10px] text-[var(--fg-primary)]">
              {practice.author.slice(0, 1)}
            </span>
            <span>{practice.author}</span>
            <span>·</span>
            <span>{practice.readingMinutes} min</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggle(practice.id)}
              aria-pressed={practice.read}
              data-testid="ok-bp-toggle"
              className={cn(
                'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-medium transition-colors',
                practice.read
                  ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
              )}
            >
              {practice.read ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
              {practice.read ? 'Read' : 'Mark read'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              Read →
            </button>
          </div>
        </footer>
      </div>
    </motion.article>
  );
}

function PracticeCard({
  practice,
  onToggle,
}: {
  practice: BestPractice;
  onToggle: (id: string) => void;
}) {
  const meta = CATEGORY_META[practice.category];
  const Icon = meta.icon;
  return (
    <motion.article
      layout
      data-testid="ok-bp-card"
      className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
    >
      <header className="flex items-center gap-2">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]"
          style={{ background: `${meta.tone}20`, color: meta.tone }}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
        <span
          className="rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
          style={{ background: `${meta.tone}20`, color: meta.tone }}
        >
          {meta.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--fg-tertiary)]">{practice.id}</span>
      </header>
      <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{practice.title}</h3>
      <p className="line-clamp-3 text-xs text-[var(--fg-secondary)]">{practice.summary}</p>
      <footer className="mt-auto flex items-center justify-between gap-2 text-xs text-[var(--fg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-3 w-3" aria-hidden="true" />
          <span>{practice.readingMinutes} min</span>
          <span>·</span>
          <span>{practice.author}</span>
        </div>
        <button
          type="button"
          onClick={() => onToggle(practice.id)}
          aria-pressed={practice.read}
          data-testid="ok-bp-toggle"
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-medium transition-colors',
            practice.read
              ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
          )}
        >
          {practice.read ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
          {practice.read ? 'Read' : 'Mark read'}
        </button>
      </footer>
    </motion.article>
  );
}