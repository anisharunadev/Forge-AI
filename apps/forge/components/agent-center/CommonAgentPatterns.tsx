'use client';

/**
 * Agent Center — "Common patterns" use-cases grid (Step 43 / Addition 6).
 *
 * Always-visible bottom section that inspires teams by showing
 * real-world Agent + Provider + Runtime triples. Clicking a card
 * fires onUsePattern with the pre-filled config so the host page
 * can drop the user straight into the wizard pre-loaded.
 *
 * Constraints adopted from skill searches:
 *   - "Code reviewer" example style — each card carries the
 *     agent + provider + runtime tuple, a benefit sentence, and
 *     a single primary CTA. No duplicated chrome.
 *   - Lucide icons only (no emoji).
 *   - Hover lift respects the global reduced-motion gate.
 *   - Three-column grid at md+, single column on mobile.
 */

import * as React from 'react';
import {
  Eye,
  Wrench,
  RefreshCw,
  FlaskConical,
  BookOpen,
  Shield,
  ArrowUpRight,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export interface AgentPattern {
  readonly id: string;
  readonly name: string;
  readonly Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  readonly accent: string;
  readonly tuple: string;
  readonly description: string;
}

export const COMMON_AGENT_PATTERNS: ReadonlyArray<AgentPattern> = [
  {
    id: 'code-reviewer',
    name: 'Code reviewer',
    Icon: Eye,
    accent: 'var(--accent-cyan)',
    tuple: 'Agent: Claude Code · Provider: Anthropic · Runtime: local Docker',
    description:
      'Reviews PRs automatically, flags issues, suggests fixes. Saves ~3h/week per dev.',
  },
  {
    id: 'refactor-agent',
    name: 'Refactor agent',
    Icon: Wrench,
    accent: 'var(--accent-violet)',
    tuple: 'Agent: Codex · Provider: OpenAI · Runtime: K8s',
    description:
      'Tackles large refactors across the codebase. Auto-generates PRs with tests.',
  },
  {
    id: 'sync-agent',
    name: 'Sync agent',
    Icon: RefreshCw,
    accent: 'var(--accent-primary)',
    tuple: 'Agent: Custom (HTTP) · Provider: Anthropic · Runtime: local Docker',
    description:
      'Syncs data between Jira, GitHub, Slack, and Forge. Keeps everyone in the loop.',
  },
  {
    id: 'test-runner',
    name: 'Test runner',
    Icon: FlaskConical,
    accent: 'var(--accent-emerald)',
    tuple: 'Agent: Claude Code · Provider: Anthropic · Runtime: local Docker',
    description:
      'Writes tests, runs them, reports coverage. Increases test coverage by 20% in a sprint.',
  },
  {
    id: 'doc-generator',
    name: 'Doc generator',
    Icon: BookOpen,
    accent: 'var(--accent-amber)',
    tuple: 'Agent: Aider · Provider: Anthropic · Runtime: local Docker',
    description:
      'Auto-generates docs from code. Keeps README and API docs in sync.',
  },
  {
    id: 'security-auditor',
    name: 'Security auditor',
    Icon: Shield,
    accent: 'var(--accent-rose)',
    tuple: 'Agent: Custom · Provider: Anthropic · Runtime: isolated K8s',
    description:
      'Scans for security issues, suggests fixes. Runs nightly on the main branch.',
  },
];

export interface CommonAgentPatternsProps {
  onUsePattern?: (pattern: AgentPattern) => void;
}

export function CommonAgentPatterns({ onUsePattern }: CommonAgentPatternsProps) {
  return (
    <section
      aria-labelledby="common-agent-patterns-heading"
      data-testid="common-agent-patterns"
      className="mt-12"
    >
      <header className="mb-5 space-y-1">
        <h3
          id="common-agent-patterns-heading"
          className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]"
        >
          Common agent patterns
        </h3>
        <p className="text-sm text-[var(--fg-tertiary)]">
          Real-world setups teams use — click any card to open the wizard pre-filled.
        </p>
      </header>

      <ul
        role="list"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {COMMON_AGENT_PATTERNS.map((pattern) => (
          <li key={pattern.id} data-testid={`pattern-${pattern.id}`}>
            <PatternCard pattern={pattern} onUse={onUsePattern} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PatternCard({
  pattern,
  onUse,
}: {
  pattern: AgentPattern;
  onUse?: (p: AgentPattern) => void;
}) {
  return (
    <article
      className={cn(
        'group flex h-full flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] p-5',
        'border border-[var(--border-subtle)]',
        'transition-[transform,box-shadow] duration-200 ease-out-soft',
        'hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${pattern.accent} 18%, transparent)`,
            color: pattern.accent,
          }}
        >
          <pattern.Icon className="h-4 w-4" aria-hidden={true} />
        </span>
        <h4 className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]">
          {pattern.name}
        </h4>
      </div>

      <p className="font-mono text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
        {pattern.tuple}
      </p>

      <p className="flex-1 text-sm leading-relaxed text-[var(--fg-secondary)]">
        {pattern.description}
      </p>

      <button
        type="button"
        onClick={() => onUse?.(pattern)}
        data-testid={`pattern-${pattern.id}-use`}
        className={cn(
          'inline-flex w-fit items-center gap-1.5 rounded-md border border-[var(--border-subtle)]',
          'bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--fg-secondary)]',
          'transition-colors duration-150 ease-out-soft',
          'hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]',
        )}
      >
        Use this pattern
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </button>
    </article>
  );
}
