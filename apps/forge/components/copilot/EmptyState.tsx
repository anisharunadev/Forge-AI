'use client';

/**
 * Step 37 — Compact Co-pilot welcome card.
 *
 * Replaces Step 24's tall four-section greeting with a tighter layout
 * that focuses on the actual conversation:
 *
 *   1. PERSONALITY  — 56×56 sparkle tile + "Hi <name> 👋" + ONE
 *      sub-line. Sets the tone without dominating 200px of the panel.
 *   2. CONTEXT       — collapsed `ContextStrip` (single pill, expands
 *      on click). Frees ~60px of vertical space.
 *   3. MODES         — segmented control (General / Code / ADR /
 *      Debug / Architecture). Mode changes the chip suggestions
 *      below AND the system prompt the API sees.
 *   4. STARTERS      — three CONTEXTUAL cards (down from six), each
 *      with icon + title + one-line body. Page-aware.
 *
 * Skill influence (ui-ux-pro-max style + ux-guideline):
 *   - "Show helpful message and action" (08-empty-ux.md) — every
 *     starter is a verb the user can take; every mode change is
 *     reversible.
 *   - "Heading hierarchy" (04-ux-guideline.md) — h2 in greeting,
 *     h3 in section labels; no skipping levels.
 *   - "User freedom" (08-empty-ux.md) — "Show more suggestions"
 *     expands in place; nothing is hidden behind a non-cancelable
 *     tour.
 *   - "Less is more" — fewer starters + collapsed context strip
 *     leave room for the actual conversation.
 */

import * as React from 'react';
import { usePathname } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  BarChart3,
  BookOpen,
  Bot,
  Code2,
  Compass,
  Cpu,
  FileText,
  GitBranch,
  GitMerge,
  History,
  Layers,
  MapPin,
  ShieldCheck,
  Sparkles,
  Terminal,
  TestTube2,
  Wrench,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopilotStore } from '@/lib/store/copilot';
import { cn } from '@/lib/utils';

import { ContextStrip } from './ContextStrip';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type CopilotMode = 'general' | 'code' | 'adr' | 'debug' | 'architecture';

interface ModeOption {
  id: CopilotMode;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  description: string;
  placeholder: string;
}

interface Starter {
  id: string;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Semantic accent for the icon tile. */
  accent: 'cyan' | 'emerald' | 'violet' | 'indigo' | 'amber' | 'rose';
  prompt: string;
}

interface PageContextSummary {
  /** Display label for the path — e.g. "/dashboard". */
  label: string;
  /** Optional sub-label (page heading). */
  sub: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Constants — modes, accents, default starters
// ─────────────────────────────────────────────────────────────────────

const MODES: ReadonlyArray<ModeOption> = [
  {
    id: 'general',
    label: 'General',
    icon: Sparkles,
    description: 'Ask anything about your project, runs, or how Forge works.',
    placeholder: 'Ask the Co-pilot anything…',
  },
  {
    id: 'code',
    label: 'Code',
    icon: Code2,
    description: 'Generate, refactor, or explain code in any project file.',
    placeholder: 'Describe the code change you want…',
  },
  {
    id: 'adr',
    label: 'ADR',
    icon: FileText,
    description: 'Draft an Architecture Decision Record step-by-step.',
    placeholder: 'Describe the ADR you want to write…',
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: AlertCircle,
    description: 'Investigate failing runs, errors, or unexpected behavior.',
    placeholder: 'Paste an error or describe what broke…',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    icon: Layers,
    description: 'Design systems, services, and data flows.',
    placeholder: 'Describe the system you want to design…',
  },
];

const ACCENT_TILE: Record<Starter['accent'], string> = {
  cyan: 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]',
  emerald: 'bg-[var(--accent-emerald)]/15 text-[var(--accent-emerald)]',
  violet: 'bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]',
  indigo: 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]',
  amber: 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]',
  rose: 'bg-[var(--accent-rose)]/15 text-[var(--accent-rose)]',
};

// Page-aware starters — keyed by route prefix so /dashboard,
// /dashboard/project-x, etc. all share the same pool. When the user
// is on a route we don't have content for, we fall back to the
// default set from Step 19 (the CAPABILITY_CHIPS).
const PAGE_STARTERS: Record<string, ReadonlyArray<Starter>> = {
  '/dashboard': [
    {
      id: 'summarize-today',
      title: "Summarize today's activity",
      body: 'What changed across my projects in the last 24 hours?',
      icon: Activity,
      accent: 'cyan',
      prompt: "Summarize today's activity across my Forge projects — what changed in the last 24 hours?",
    },
    {
      id: 'why-orchestrator-down',
      title: 'Why is the orchestrator down?',
      body: 'Diagnose the most recent orchestration failure.',
      icon: AlertCircle,
      accent: 'rose',
      prompt: 'Look at the most recent orchestration failure — what went wrong and how do I fix it?',
    },
    {
      id: 'expensive-run',
      title: 'Show me the most expensive run',
      body: 'Which run cost the most this week and why?',
      icon: BarChart3,
      accent: 'amber',
      prompt: 'Which run cost the most this week, what agents did it call, and why was it so expensive?',
    },
  ],
  '/workflows': [
    {
      id: 'explain-pipeline',
      title: 'Explain my Ideation → PRD pipeline',
      body: 'Walk me through this workflow end-to-end.',
      icon: GitBranch,
      accent: 'cyan',
      prompt: 'Walk me through the Ideation → PRD pipeline end-to-end and tell me what each step does.',
    },
    {
      id: 'add-approval-gate',
      title: 'Add an approval gate after step 3',
      body: 'Insert a human approval before deployment.',
      icon: ShieldCheck,
      accent: 'emerald',
      prompt: 'Help me add a human approval gate after step 3 of this workflow, before anything deploys.',
    },
    {
      id: 'show-workflow-runs',
      title: 'Show runs of this workflow',
      body: 'List the last 5 runs and their outcomes.',
      icon: History,
      accent: 'violet',
      prompt: 'Show me the last 5 runs of this workflow and tell me which ones failed and why.',
    },
  ],
  '/agents': [
    {
      id: 'what-does-agent-do',
      title: 'What does my Code Reviewer agent do?',
      body: 'Summarize the agent’s purpose, tools, and constraints.',
      icon: Bot,
      accent: 'cyan',
      prompt: 'Summarize what my Code Reviewer agent does, what tools it can call, and what constraints it has.',
    },
    {
      id: 'create-test-agent',
      title: 'Create a new agent for testing',
      body: 'Scaffold a test-runner agent from a template.',
      icon: TestTube2,
      accent: 'emerald',
      prompt: 'Help me scaffold a new test-runner agent from a template — what should I configure first?',
    },
  ],
  '/audit': [
    {
      id: 'suspicious-activity',
      title: 'Anything suspicious in the last 24h?',
      body: 'Flag unusual patterns in the audit log.',
      icon: ShieldCheck,
      accent: 'rose',
      prompt: 'Scan the audit log for the last 24 hours — flag anything unusual or unexpected.',
    },
    {
      id: 'who-changed-settings',
      title: 'Who changed settings yesterday?',
      body: 'Show every settings diff from the last day.',
      icon: History,
      accent: 'amber',
      prompt: 'Who changed Forge settings yesterday and what exactly did they change?',
    },
  ],
  '/connector-center': [
    {
      id: 'connect-github',
      title: 'Connect GitHub',
      body: 'Walk through GitHub repo ingestion.',
      icon: GitBranch,
      accent: 'cyan',
      prompt: 'Walk me through connecting my GitHub organization and ingesting the first repo.',
    },
  ],
  '/agent-center': [
    {
      id: 'agent-assignments',
      title: 'Review agent assignments',
      body: 'Which projects still need an agent assigned?',
      icon: Bot,
      accent: 'cyan',
      prompt: 'Which of my projects still need an agent assigned, and which ones have a coverage gap?',
    },
  ],
};

const FALLBACK_STARTERS: ReadonlyArray<Starter> = [
  {
    id: 'summarize-knowledge',
    title: 'Summarize my knowledge base',
    body: 'What are the most active topics this week?',
    icon: BookOpen,
    accent: 'cyan',
    prompt: 'Summarize my organization knowledge base — what are the most active topics this week?',
  },
  {
    id: 'recent-activity',
    title: 'Show recent activity',
    body: 'Last 24 hours across all my projects.',
    icon: Activity,
    accent: 'emerald',
    prompt: 'Show me recent activity across my projects for the last 24 hours.',
    },
  {
    id: 'write-adr',
    title: 'Help me write an ADR',
    body: 'Draft an Architecture Decision Record.',
    icon: FileText,
    accent: 'violet',
    prompt: 'Help me draft an ADR for adding a streaming endpoint to the agent runtime.',
  },
  {
    id: 'connect-repo',
    title: 'Connect my first repo',
    body: 'Walk through repository ingestion.',
    icon: GitBranch,
    accent: 'indigo',
    prompt: 'Walk me through connecting my first repository to Project Intelligence.',
  },
  {
    id: 'cost-changes',
    title: 'What changed in costs?',
    body: 'Highlight any cost spikes this week.',
    icon: BarChart3,
    accent: 'amber',
    prompt: 'What changed in model costs this week? Highlight any spikes.',
  },
  {
    id: 'audit-deploy',
    title: 'Audit my last deploy',
    body: 'Were any approval gates skipped?',
    icon: ShieldCheck,
    accent: 'rose',
    prompt: 'Audit my last deploy — were any approval gates skipped?',
  },
];

const EXTRA_STARTERS: ReadonlyArray<Starter> = [
  {
    id: 'explain-component',
    title: 'Explain a component to me',
    body: 'Pick the file I’m looking at and walk through it.',
    icon: Compass,
    accent: 'indigo',
    prompt: 'Pick the file I’m currently viewing and explain what it does, line by line.',
  },
  {
    id: 'run-a-command',
    title: 'Run a forge command',
    body: 'Trigger a forge-cli command from chat.',
    icon: Terminal,
    accent: 'cyan',
    prompt: 'What forge-cli commands can I run from chat, and which one should I try first?',
  },
  {
    id: 'navigate-page',
    title: 'Navigate to a page',
    body: 'Jump me to the right dashboard surface.',
    icon: MapPin,
    accent: 'emerald',
    prompt: 'Where do I go in Forge to manage my agent budgets?',
  },
  {
    id: 'draft-rfc',
    title: 'Draft an RFC from a brief',
    body: 'Turn a short brief into an RFC outline.',
    icon: FileText,
    accent: 'violet',
    prompt: 'Help me draft an RFC outline from a brief I’ll paste in next.',
  },
  {
    id: 'fix-failing-test',
    title: 'Fix a failing test',
    body: 'Diagnose and propose a patch for a failing test.',
    icon: Wrench,
    accent: 'amber',
    prompt: 'I have a failing test — how should I approach debugging it?',
  },
  {
    id: 'merge-strategy',
    title: 'Suggest a merge strategy',
    body: 'Pick a safe merge approach for a stack of PRs.',
    icon: GitMerge,
    accent: 'rose',
    prompt: 'I have 3 PRs stacked on each other — what merge strategy should I use and why?',
  },
  {
    id: 'cost-budget',
    title: 'Set a model budget',
    body: 'Configure a per-conversation spend ceiling.',
    icon: Cpu,
    accent: 'cyan',
    prompt: 'Help me set a per-conversation model budget that protects me from runaway cost.',
  },
  {
    id: 'observability',
    title: 'Set up tracing',
    body: 'Wire OpenTelemetry into a new service.',
    icon: Activity,
    accent: 'emerald',
    prompt: 'Walk me through wiring OpenTelemetry into a new service in this repo.',
  },
  {
    id: 'security-review',
    title: 'Run a security review',
    body: 'Scan the active project for vulnerabilities.',
    icon: ShieldCheck,
    accent: 'rose',
    prompt: 'Run a security review on the project I’m currently in and summarize the top 3 risks.',
  },
  {
    id: 'refactor-module',
    title: 'Refactor a module',
    body: 'Propose a refactor plan for a specific folder.',
    icon: Layers,
    accent: 'indigo',
    prompt: 'Pick a module in this repo that would benefit most from a refactor and propose a plan.',
  },
];

// Recent-activity stub — in production this would be wired to
// useAuditTimeline or a similar hook. We render an empty state so the
// surface exists in the layout.
const RECENT_ACTIVITY_STUB: ReadonlyArray<{ id: string; label: string; when: string }> = [];

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function EmptyState() {
  const pathname = usePathname() ?? '/';
  const setDraft = useCopilotStore((s) => s.setDraft);
  const open = useCopilotStore((s) => s.open);

  // Local UI state — which mode is active and whether the expanded
  // list of starters is showing. Persisted to localStorage so the
  // user's choice survives reloads (per the Step 24 constraints).
  const [mode, setMode] = React.useState<CopilotMode>(() => readPersistedMode());
  const [showAll, setShowAll] = React.useState(false);

  // Persist mode to localStorage. SSR-safe — no-op on server.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  // Compose the starters list from the page + mode.
  const baseStarters = React.useMemo(() => {
    const match = matchPage(pathname);
    return PAGE_STARTERS[match] ?? FALLBACK_STARTERS;
  }, [pathname]);

  const starters = React.useMemo(() => {
    if (mode === 'code') return codeStarters(baseStarters);
    if (mode === 'adr') return adrStarters(baseStarters);
    if (mode === 'debug') return debugStarters(baseStarters);
    if (mode === 'architecture') return architectureStarters(baseStarters);
    return baseStarters;
  }, [baseStarters, mode]);

  // Step 37 — show only 3 starters by default (down from all six).
  // Users can expand to see more.
  const visibleStarters = showAll ? [...starters, ...EXTRA_STARTERS] : starters.slice(0, 3);
  const hasExtras = !showAll;

  const handleStarter = React.useCallback(
    (prompt: string) => {
      setDraft(prompt);
      if (!open) {
        useCopilotStore.getState().setOpen(true);
      }
      // Focus the composer so the user can edit before sending.
      if (typeof document !== 'undefined') {
        const ta = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="copilot-composer-input"]',
        );
        ta?.focus();
        // Move caret to the end so the user can keep typing.
        const len = ta?.value.length ?? 0;
        ta?.setSelectionRange(len, len);
      }
    },
    [setDraft, open],
  );

  const activeMode: ModeOption = MODES.find((m) => m.id === mode) ?? MODES[0]!;

  // Step 37 — pull user name from the body / localStorage if
  // present so the greeting feels personal without becoming
  // intrusive. Falls back gracefully to "there".
  const userName = React.useMemo(() => readUserName(), []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 flex-col items-center gap-3 overflow-y-auto px-5 py-5"
      data-testid="copilot-empty-state"
      data-mode={mode}
    >
      {/* Greeting card ─────────────────────────────────────────── */}
      <section
        aria-labelledby="copilot-welcome-title"
        className="flex w-full max-w-[380px] flex-col items-center gap-2 pt-1"
      >
        <div
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--bg-inset)] text-[var(--accent-cyan)] shadow-[0_0_18px_rgba(34,211,238,0.18)] animate-[ai-thinking-pulse_3s_ease-in-out_infinite]"
        >
          <Sparkles className="h-6 w-6" strokeWidth={1.6} />
        </div>

        <h2
          id="copilot-welcome-title"
          className="mt-1 text-center text-[var(--text-base)] font-semibold text-[var(--fg-primary)]"
        >
          {userName ? `Hi ${userName} 👋` : "Hi, I'm your Co-pilot."}
        </h2>
        <p className="max-w-[300px] text-center text-[var(--text-xs)] text-[var(--fg-secondary)]">
          Ask me about your project, runs, or how Forge works.
        </p>

        {/* Collapsed context strip (one-line, expands on click) ── */}
        <div className="mt-2 w-full">
          <ContextStrip pathname={pathname} />
        </div>

        {/* Mode tabs (segmented) ──────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Co-pilot mode"
          className="mt-2 flex w-full items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5"
        >
          {MODES.map((m) => {
            const isActive = m.id === mode;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] transition-colors',
                  isActive
                    ? 'bg-[var(--accent-primary)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-secondary)]',
                )}
                data-testid={`copilot-mode-${m.id}`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-center text-[10px] text-[var(--fg-tertiary)]">
          {activeMode.description}
        </p>
      </section>

      {/* Starters ────────────────────────────────────────────── */}
      <section
        aria-labelledby="copilot-starters-title"
        className="flex w-full max-w-[380px] flex-col gap-2"
      >
        <h3
          id="copilot-starters-title"
          className="px-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
        >
          Try
        </h3>
        <div className="flex flex-col gap-1.5">
          {visibleStarters.length > 0 ? (
            visibleStarters.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleStarter(s.prompt)}
                  className={cn(
                    'group flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 text-left transition-all duration-200',
                    'hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] hover:shadow-[var(--shadow-sm)]',
                    'focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]',
                  )}
                  data-testid={`copilot-starter-${s.id}`}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                      ACCENT_TILE[s.accent],
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                      {s.title}
                    </span>
                    <span className="truncate text-[var(--text-xs)] text-[var(--fg-tertiary)]">
                      {s.body}
                    </span>
                  </span>
                </button>
              );
            })
          ) : null}
        </div>

        {hasExtras ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 self-center text-[var(--text-xs)] font-medium text-[var(--accent-cyan)] transition-colors hover:text-[var(--accent-primary)] focus-visible:outline-none focus-visible:underline"
            data-testid="copilot-starters-more"
          >
            Show more suggestions →
          </button>
        ) : null}
      </section>

      {/* Recent activity (collapsible) ───────────────────────── */}
      <RecentActivityStub items={RECENT_ACTIVITY_STUB} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function RecentActivityStub({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: string; when: string }>;
}) {
  const [open, setOpen] = React.useState(true);
  if (items.length === 0) return null;
  return (
    <section className="mt-6 w-full max-w-[380px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
      >
        Recent activity
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <ul className="mt-2 flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-xs)]"
            >
              <span className="truncate text-[var(--fg-secondary)]">{item.label}</span>
              <span className="text-[var(--fg-tertiary)]">{item.when}</span>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="text-[var(--accent-cyan)] hover:underline"
            >
              View full history →
            </button>
          </li>
        </ul>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const MODE_STORAGE_KEY = 'forge.copilot.mode.v1';

function readPersistedMode(): CopilotMode {
  if (typeof window === 'undefined') return 'general';
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (raw && MODES.some((m) => m.id === raw)) {
      return raw as CopilotMode;
    }
  } catch {
    // ignore
  }
  return 'general';
}

function matchPage(pathname: string): string {
  // Longest-prefix match so /agent-center/123 hits /agent-center.
  const keys = Object.keys(PAGE_STARTERS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (pathname === key || pathname.startsWith(`${key}/`)) return key;
  }
  return '';
}

/**
 * Step 37 — best-effort user name lookup. Pulls from a few known
 * places (data attribute on body, localStorage cache set by auth
 * flows) and falls back to the empty string so the greeting reads
 * as the impersonal-but-friendly default. SSR-safe.
 */
function readUserName(): string {
  if (typeof window === 'undefined') return '';
  try {
    // 1. data-user-name on the body tag — set by ShellProvider once
    //    the auth bootstrap hydrates the current viewer.
    const fromBody = document.body?.dataset?.userName?.trim();
    if (fromBody) return firstName(fromBody);
    // 2. localStorage cache — written by the auth bootstrap effect
    //    in apps/forge/app/layout.tsx (see FORGE_USER_KEY).
    const fromLS = window.localStorage.getItem('forge.user.name.v1');
    if (fromLS) return firstName(fromLS);
  } catch {
    // ignore — fall through to empty.
  }
  return '';
}

function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  // Split on whitespace, then on common email separators so an email
  // like "arun.v@example.com" yields "arun".
  const head = trimmed.split(/\s+/)[0] ?? '';
  const local = head.split(/[.@]/)[0] ?? '';
  // Capitalize first letter for the greeting.
  if (!local) return '';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function codeStarters(base: ReadonlyArray<Starter>): ReadonlyArray<Starter> {
  // For code mode we prefer code-flavored starters first; fall back to
  // the page-aware list (which is already curated per page).
  const code: Starter[] = [
    {
      id: 'code-explain',
      title: 'Explain this code',
      body: 'Pick the file I’m viewing and walk me through it.',
      icon: Code2,
      accent: 'cyan',
      prompt: 'Pick the file I’m currently viewing and explain what it does, line by line.',
    },
    {
      id: 'code-refactor',
      title: 'Refactor a module',
      body: 'Propose a refactor plan for a specific folder.',
      icon: Layers,
      accent: 'indigo',
      prompt: 'Pick a module in this repo that would benefit most from a refactor and propose a plan.',
    },
    {
      id: 'code-fix',
      title: 'Fix a failing test',
      body: 'Diagnose and propose a patch for a failing test.',
      icon: Wrench,
      accent: 'amber',
      prompt: 'I have a failing test — how should I approach debugging it?',
    },
  ];
  return [...code, ...base.filter((s) => !code.some((c) => c.id === s.id))];
}

function adrStarters(base: ReadonlyArray<Starter>): ReadonlyArray<Starter> {
  const adr: Starter[] = [
    {
      id: 'adr-new',
      title: 'Draft a new ADR',
      body: 'Scaffold an Architecture Decision Record.',
      icon: FileText,
      accent: 'violet',
      prompt: 'Help me draft an ADR for adding a streaming endpoint to the agent runtime.',
    },
    {
      id: 'adr-rfc',
      title: 'Draft an RFC from a brief',
      body: 'Turn a short brief into an RFC outline.',
      icon: FileText,
      accent: 'cyan',
      prompt: 'Help me draft an RFC outline from a brief I’ll paste in next.',
    },
  ];
  return [...adr, ...base.filter((s) => !adr.some((c) => c.id === s.id))];
}

function debugStarters(base: ReadonlyArray<Starter>): ReadonlyArray<Starter> {
  const debug: Starter[] = [
    {
      id: 'debug-fail',
      title: 'Debug a failing run',
      body: 'Diagnose the most recent orchestration failure.',
      icon: AlertCircle,
      accent: 'rose',
      prompt: 'Look at the most recent orchestration failure — what went wrong and how do I fix it?',
    },
    {
      id: 'debug-test',
      title: 'Fix a failing test',
      body: 'Walk through reproduction + patch.',
      icon: TestTube2,
      accent: 'amber',
      prompt: 'Walk me through how to reproduce and fix a failing test.',
    },
  ];
  return [...debug, ...base.filter((s) => !debug.some((c) => c.id === s.id))];
}

function architectureStarters(base: ReadonlyArray<Starter>): ReadonlyArray<Starter> {
  const arch: Starter[] = [
    {
      id: 'arch-design',
      title: 'Design a service',
      body: 'Sketch the data flow + boundaries.',
      icon: Layers,
      accent: 'indigo',
      prompt: 'Help me design a new service — sketch the data flow and service boundaries.',
    },
    {
      id: 'arch-trace',
      title: 'Trace a request',
      body: 'Map how a request flows through the system.',
      icon: Activity,
      accent: 'cyan',
      prompt: 'Trace how a typical request flows through the system end-to-end.',
    },
  ];
  return [...arch, ...base.filter((s) => !arch.some((c) => c.id === s.id))];
}

// Step 37 — the buildContextSummary helper that used to live here
// moved into ContextStrip.tsx, where the collapsed pill renders the
// same items in one line. We keep this comment block as a pointer
// for readers so they can grep for context-related code without
// finding a dead reference.

// ─────────────────────────────────────────────────────────────────────
// Hidden helper for tests + dev — exposes the placeholder text for
// the active mode so ComposerInput can sync its placeholder without
// subscribing to the local state directly.
// ─────────────────────────────────────────────────────────────────────

export function placeholderForMode(mode: CopilotMode): string {
  return MODES.find((m) => m.id === mode)?.placeholder ?? MODES[0]!.placeholder;
}

export default EmptyState;
