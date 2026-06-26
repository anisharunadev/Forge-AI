'use client';

/**
 * Agent Center — Visual mental model diagram (Step 43 / Addition 2).
 *
 * Horizontal 4-box flow that visualises the core Agent Center mental
 * model:
 *
 *   AGENTS ──▶ MODEL PROVIDERS ──▶ RUNTIMES ──▶ ASSIGNMENTS
 *   (workers)   (brains)            (workspaces) (org chart)
 *
 * Boxes are sourced from the design system tokens, arrows are an
 * animated dashed-cyan line capped by a lucide ChevronRight, and
 * every box has a hover state (scale + tooltip with examples).
 *
 * Constraints adopted from skill searches:
 *   - "Visual feedback on interactive elements" — every box scales
 *     1.05 on hover and reveals a tooltip with concrete examples
 *     (Claude Code, Anthropic, local Docker, etc.).
 *   - "marching ants" animation honours the global reduced-motion
 *     gate in `app/globals.css`.
 *   - Each box icon uses a category-specific accent so the colour
 *     carries redundant meaning (no "color only" rule violation).
 */

import * as React from 'react';
import { Bot, Cpu, Server, Link2, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

interface DiagramBox {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly examples: ReadonlyArray<string>;
  readonly Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  readonly accent: string;
  readonly tooltip: string;
}

const BOXES: ReadonlyArray<DiagramBox> = [
  {
    id: 'agents',
    title: 'Agents',
    subtitle: 'workers',
    body: 'AI workers that execute forge-* commands.',
    examples: ['Claude Code', 'Codex', 'Aider'],
    Icon: Bot,
    accent: 'var(--accent-cyan)',
    tooltip:
      'Claude Code: AI pair-programmer that executes forge-dev-* commands.',
  },
  {
    id: 'providers',
    title: 'Model Providers',
    subtitle: 'brains',
    body: 'LLM backends that power each agent.',
    examples: ['Anthropic', 'OpenAI', 'Bedrock'],
    Icon: Cpu,
    accent: 'var(--accent-violet)',
    tooltip:
      'Anthropic Claude Sonnet — primary brain for code review and refactor.',
  },
  {
    id: 'runtimes',
    title: 'Runtimes',
    subtitle: 'workspaces',
    body: 'Sandboxes where agents actually execute.',
    examples: ['Local Docker', 'K8s cluster'],
    Icon: Server,
    accent: 'var(--accent-amber)',
    tooltip: 'Local Docker — default for development; isolated, reproducible.',
  },
  {
    id: 'assignments',
    title: 'Assignments',
    subtitle: 'org chart',
    body: 'Map agents to projects so work has owners.',
    examples: ['Project: X', 'Sprint: 12'],
    Icon: Link2,
    accent: 'var(--accent-emerald)',
    tooltip: 'Project: X — Claude Code assigned to refactor auth module.',
  },
];

const ARROW_LABELS = ['powered by', 'running in', 'assigned to'] as const;

export function AgentMentalModelDiagram() {
  return (
    <section
      aria-labelledby="agent-mental-model-heading"
      data-testid="agent-mental-model-diagram"
      className="mt-4 rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] p-6 md:p-8"
    >
      <header className="flex flex-col gap-1">
        <h3
          id="agent-mental-model-heading"
          className="text-[var(--text-md)] font-semibold text-[var(--fg-primary)]"
        >
          How it works
        </h3>
        <p className="text-sm text-[var(--fg-tertiary)]">
          The 4 pieces that make your AI workforce work.
        </p>
      </header>

      <ol
        role="list"
        aria-label="Agent Center mental model"
        className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch"
      >
        {BOXES.map((box, index) => (
          <React.Fragment key={box.id}>
            <li className="relative" data-testid={`diagram-box-${box.id}`}>
              <DiagramCard box={box} />
            </li>
            {index < BOXES.length - 1 ? (
              <li
                aria-hidden="true"
                className="hidden md:flex md:flex-col md:items-center md:justify-center md:gap-1 md:py-4"
                data-testid={`diagram-arrow-${index}`}
              >
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
                  {ARROW_LABELS[index]}
                </span>
                <span
                  className="diagram-arrow-line relative inline-block h-[2px] w-12 md:w-16"
                  aria-hidden="true"
                />
                <ChevronRight
                  className="h-4 w-4 text-[var(--accent-cyan)]"
                  aria-hidden="true"
                />
              </li>
            ) : null}
          </React.Fragment>
        ))}
      </ol>
    </section>
  );
}

function DiagramCard({ box }: { box: DiagramBox }) {
  return (
    <div
      className={cn(
        'group relative h-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4',
        'transition-[transform,box-shadow] duration-200 ease-out-soft',
        'hover:scale-[1.05] hover:shadow-[var(--shadow-md)]',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: `color-mix(in srgb, ${box.accent} 18%, transparent)` }}
        >
          <box.Icon className="h-3.5 w-3.5" aria-hidden={true} />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--fg-primary)]">{box.title}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            {box.subtitle}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[var(--fg-secondary)]">{box.body}</p>

      <ul role="list" className="mt-3 flex flex-wrap gap-1.5">
        {box.examples.map((ex) => (
          <li key={ex}>
            <span className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-secondary)]">
              {ex}
            </span>
          </li>
        ))}
      </ul>

      <div
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2',
          'whitespace-nowrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-3 py-1.5',
          'text-[11px] text-[var(--fg-secondary)] shadow-[var(--shadow-md)]',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {box.tooltip}
      </div>
    </div>
  );
}
