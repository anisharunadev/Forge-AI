'use client';

/**
 * Stories Center — "Start implementation" modal (Step 38 Fix 5 + Step 44).
 *
 * The headline cross-module integration. Clicking "Start implementation"
 * on a Ready/To Do story opens this modal which:
 *   1. Picks an agent based on the story's labels (feature → Claude Code,
 *      chore/refactor → Aider, bug → Codex).
 *   2. Picks a model with a big-enough context window — default
 *      Claude Sonnet 4.5 (200K). Step 44 added a context-size indicator
 *      that turns amber/rose when context >50/80% of the model window.
 *   3. Previews every piece of context that will be auto-injected
 *      (PRD section, ADRs, related code files, acceptance criteria as a
 *      Task checklist) and lets the user toggle each on/off.
 *   4. Picks the working directory (project + branch).
 *   5. Shows estimated cost based on selected model + context size.
 *   6. On "Start": creates a new terminal session via Zustand store,
 *      dispatches a `forge:terminal:open-story` event with the story
 *      context payload, and navigates to /forge-terminal.
 *
 * Skill influence:
 *   - ux-guideline (action preview) — show the consequence before the
 *     user commits. Reduces "what did I just do?" anxiety.
 *   - ux-guideline (animation / reduced motion) — slide-in respects
 *     prefers-reduced-motion (handled by the underlying Dialog).
 *   - ux-guideline (active states) — toggle chips flip on click, all
 *     checkboxes share the same hit area.
 *   - ux-guideline (warn at threshold) — context bar uses emerald /
 *     amber / rose thresholds at 50% and 80% of model window.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Cpu,
  DollarSign,
  FileCode,
  Folder,
  GitBranch,
  GitPullRequest,
  Loader2,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Story } from '@/lib/stories/types';
import { useTerminalStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export interface StartImplementationModalProps {
  readonly story: Story | null;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called after a new terminal session has been created and bound to
   *  the story. Receives (storyId, sessionId) so the parent can flip
   *  story status to `in_progress` and remember the live binding. */
  readonly onSessionStarted?: (storyId: string, sessionId: string) => void;
}

interface AgentChoice {
  readonly id: 'claude-code' | 'aider' | 'codex' | 'cursor';
  readonly label: string;
  readonly tagline: string;
  readonly rationale: string;
}

const AGENT_LIBRARY: ReadonlyArray<AgentChoice> = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    tagline: 'default for new features',
    rationale: 'Best for greenfield features, multi-file refactors, and tests.',
  },
  {
    id: 'aider',
    label: 'Aider',
    tagline: 'default for refactors',
    rationale: 'Excels at surgical edits and large existing codebases.',
  },
  {
    id: 'codex',
    label: 'Codex',
    tagline: 'default for bug fixes',
    rationale: 'Good at reading failing tests and producing minimal patches.',
  },
  {
    id: 'cursor',
    label: 'Cursor Composer',
    tagline: 'default for greenfield',
    rationale: 'Best when starting from a blank directory.',
  },
];

/**
 * Model library — values from the provider abstraction layer (Rule 1).
 * Step 44 picks the model with the biggest *practical* context window
 * as the default so auto-injected context never truncates.
 */
interface ModelChoice {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly contextWindow: number; // tokens
  /** USD per 1M input tokens. Source of truth lives in the provider
   *  abstraction layer; these numbers are placeholders for the UI. */
  readonly pricePerMillion: number;
}

const MODEL_LIBRARY: ReadonlyArray<ModelChoice> = [
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', contextWindow: 200_000, pricePerMillion: 3 },
  { id: 'claude-opus-4', label: 'Claude Opus 4', provider: 'Anthropic', contextWindow: 200_000, pricePerMillion: 15 },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', contextWindow: 128_000, pricePerMillion: 2.5 },
  { id: 'gemini-2-pro', label: 'Gemini 2.0 Pro', provider: 'Google', contextWindow: 1_000_000, pricePerMillion: 1.25 },
];

const DEFAULT_MODEL_ID = 'claude-sonnet-4-5';

const WORKING_DIRS: ReadonlyArray<{ id: string; branch: string; label: string }> = [
  { id: 'forge-platform', branch: 'main', label: 'Forge Platform · main' },
  { id: 'forge-platform', branch: 'feature/sprint-25', label: 'Forge Platform · feature/sprint-25' },
  { id: 'forge-dashboard', branch: 'main', label: 'Forge Dashboard · main' },
  { id: 'forge-orchestrator', branch: 'main', label: 'Forge Orchestrator · main' },
];

const CONTEXT_TOGGLES: ReadonlyArray<{
  id: 'prd' | 'adrs' | 'codeFiles' | 'tasks' | 'tests' | 'connector';
  label: string;
  detail: string;
  /** Estimated token cost when this context is included. */
  tokens: number;
}> = [
  { id: 'prd', label: 'Linked PRD section', detail: 'PRD-FORGE-001 §2.3 (Auth & PKCE)', tokens: 1800 },
  { id: 'adrs', label: 'Linked ADRs', detail: 'ADR-009 · ADR-012', tokens: 600 },
  { id: 'codeFiles', label: 'Related code files', detail: 'src/auth/pkce.ts · src/auth/redirect.ts', tokens: 2400 },
  { id: 'tasks', label: 'Linked tasks', detail: '8 subtasks detected from description', tokens: 400 },
  { id: 'tests', label: 'Linked tests', detail: 'auth.test.ts (8 existing cases)', tokens: 1200 },
  { id: 'connector', label: 'Connector data', detail: 'Zendesk ticket ACME-123 (origin)', tokens: 300 },
];

const STORY_BASE_TOKENS = 450; // title + identifier + acceptance-criteria prose

function pickAgentForStory(story: Story): AgentChoice['id'] {
  if (story.labels.includes('bug')) return 'codex';
  if (story.labels.includes('chore') || story.labels.includes('spike')) return 'aider';
  if (story.labels.includes('docs')) return 'claude-code';
  return 'claude-code';
}

function buildInitialPrompt(story: Story, agentLabel: string): string {
  const ac =
    story.acceptanceCriteria.length > 0
      ? story.acceptanceCriteria
          .map((a, i) => `  ${i + 1}. ${a.text}`)
          .join('\n')
      : '  (no explicit acceptance criteria)';
  return [
    `Implement story ${story.identifier}: ${story.title}.`,
    '',
    'Acceptance criteria:',
    ac,
    '',
    'Start by exploring the relevant codebase, then propose a plan before writing code.',
    '',
    `Workspace: Forge Platform · Agent: ${agentLabel}`,
  ].join('\n');
}

export function StartImplementationModal({
  story,
  open,
  onClose,
  onSessionStarted,
}: StartImplementationModalProps) {
  const router = useRouter();
  const createSession = useTerminalStore((s) => s.createSession);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const [agentId, setAgentId] = React.useState<AgentChoice['id']>('claude-code');
  const [modelId, setModelId] = React.useState<string>(DEFAULT_MODEL_ID);
  const [workdirId, setWorkdirId] = React.useState<string>(WORKING_DIRS[0]!.id + '/' + WORKING_DIRS[0]!.branch);
  const [contextToggles, setContextToggles] = React.useState<Set<ContextToggleId>>(
    () =>
      new Set<ContextToggleId>(['prd', 'adrs', 'codeFiles', 'tasks', 'tests', 'connector']),
  );
  const [starting, setStarting] = React.useState(false);

  // Reset agent + toggles whenever the story changes so re-opening
  // the modal on a different story starts from its defaults.
  React.useEffect(() => {
    if (!story) return;
    setAgentId(pickAgentForStory(story));
    setModelId(DEFAULT_MODEL_ID);
    setWorkdirId(WORKING_DIRS[0]!.id + '/' + WORKING_DIRS[0]!.branch);
    setContextToggles(
      new Set<ContextToggleId>(['prd', 'adrs', 'codeFiles', 'tasks', 'tests', 'connector']),
    );
    setStarting(false);
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!story) return null;

  const agent = AGENT_LIBRARY.find((a) => a.id === agentId)!;
  const model = MODEL_LIBRARY.find((m) => m.id === modelId)!;
  const prompt = buildInitialPrompt(story, agent.label);

  // Estimated token usage = story base + every toggled context item.
  const estimatedTokens = React.useMemo(() => {
    let total = STORY_BASE_TOKENS;
    for (const t of CONTEXT_TOGGLES) {
      if (contextToggles.has(t.id)) total += t.tokens;
    }
    return total;
  }, [contextToggles]);
  const contextRatio = estimatedTokens / model.contextWindow;
  const estimatedCost = (estimatedTokens / 1_000_000) * model.pricePerMillion;

  const toggleContext = (id: ContextToggleId) => {
    setContextToggles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    setStarting(true);
    const sessionId = createSession({
      title: `${story.identifier}: ${story.title}`,
      agent: agentId,
      workspace: workdirId,
      color: 'indigo',
    });
    setActiveSession(sessionId);

    // Build the context payload the terminal page will read on mount.
    const payload = {
      sessionId,
      storyId: story.id,
      storyIdentifier: story.identifier,
      agent: agentId,
      model: modelId,
      workdir: workdirId,
      prompt,
      injectedContext: Array.from(contextToggles).map((id) => {
        const t = CONTEXT_TOGGLES.find((x) => x.id === id)!;
        return { id, label: t.label, detail: t.detail };
      }),
      acceptanceCriteria: story.acceptanceCriteria,
      estimatedTokens,
      estimatedCost,
      startedAt: new Date().toISOString(),
    };

    // Persist for late subscribers (terminal page may not be mounted yet).
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          'forge:terminal:pending-story',
          JSON.stringify(payload),
        );
      } catch {
        /* quota or private-mode — non-fatal */
      }
      window.dispatchEvent(new CustomEvent('forge:terminal:open-story', { detail: payload }));
      onSessionStarted?.(story.id, sessionId);
    }

    toast.success(`${story.identifier} in progress`, {
      description: 'Terminal session opened with story context pre-injected.',
    });

    // Tiny delay so the toast + spinner can register before route flip.
    window.setTimeout(() => {
      router.push(`/forge-terminal?sessionId=${sessionId}&storyId=${story.id}`);
      onClose();
    }, 240);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          'max-h-[min(640px,calc(100vh-64px))] w-[min(720px,calc(100vw-32px))] gap-0 overflow-hidden p-0',
          'border border-[var(--border-default)] bg-[var(--bg-surface)]',
        )}
        data-testid="start-implementation-modal"
      >
        <DialogHeader className="border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span className="font-mono">{story.identifier}</span>
            <ChevronRight size={12} aria-hidden="true" />
            <span>Start implementation</span>
          </div>
          <DialogTitle className="mt-1 text-base font-semibold text-[var(--fg-primary)]">
            {story.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--fg-secondary)]">
            Forge will open a fresh terminal session with the story's full context pre-injected —
            so the agent starts coding from your project, not from scratch.
          </DialogDescription>
        </DialogHeader>

        <div className="thin-scrollbar grid max-h-[440px] grid-cols-1 gap-0 overflow-y-auto md:grid-cols-[1fr_240px]">
          {/* LEFT — context preview */}
          <div className="flex flex-col gap-5 border-r border-[var(--border-subtle)] px-6 py-5">
            {/* Agent picker */}
            <section aria-labelledby="agent-pick-h">
              <h3
                id="agent-pick-h"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]"
              >
                Agent
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {AGENT_LIBRARY.map((a) => {
                  const active = agentId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAgentId(a.id)}
                      data-testid={`agent-pick-${a.id}`}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col gap-1 rounded-[var(--radius-md)] border px-3 py-2 text-left',
                        'transition-colors duration-fast ease-out-soft',
                        active
                          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                        <Bot size={12} aria-hidden="true" />
                        {a.label}
                      </span>
                      <span className="text-[10px] text-[var(--fg-tertiary)]">{a.tagline}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
                {agent.rationale}
              </p>
            </section>

            {/* Model picker — Step 44. Default = biggest practical context
                window so auto-injected context never silently truncates. */}
            <section aria-labelledby="model-pick-h">
              <h3
                id="model-pick-h"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]"
              >
                Model
              </h3>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                data-testid="model-pick"
                aria-label="Model"
                className={cn(
                  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-[var(--fg-primary)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                {MODEL_LIBRARY.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {(m.contextWindow / 1000).toFixed(0)}K window · ${m.pricePerMillion}/M in
                  </option>
                ))}
              </select>

              {/* Context-size indicator — emerald / amber / rose thresholds
                  at 50% / 80% of the model's context window. Step 44. */}
              <div className="mt-2">
                <div className="flex items-baseline justify-between text-[10px]">
                  <span className="text-[var(--fg-tertiary)]">
                    Context size
                  </span>
                  <span
                    className={cn(
                      'font-mono',
                      contextRatio < 0.5
                        ? 'text-[var(--accent-emerald)]'
                        : contextRatio < 0.8
                          ? 'text-[var(--accent-amber)]'
                          : 'text-[var(--accent-rose)]',
                    )}
                    data-testid="context-size-readout"
                  >
                    {estimatedTokens.toLocaleString()} / {model.contextWindow.toLocaleString()} (
                    {(contextRatio * 100).toFixed(1)}%)
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(contextRatio * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]"
                >
                  <div
                    className={cn(
                      'h-full transition-all duration-fast ease-out-soft',
                      contextRatio < 0.5
                        ? 'bg-[var(--accent-emerald)]'
                        : contextRatio < 0.8
                          ? 'bg-[var(--accent-amber)]'
                          : 'bg-[var(--accent-rose)]',
                    )}
                    style={{ width: `${Math.min(100, contextRatio * 100)}%` }}
                  />
                </div>
                {contextRatio >= 0.8 ? (
                  <p
                    className="mt-1.5 flex items-start gap-1.5 text-[10px] text-[var(--accent-amber)]"
                    data-testid="context-warning"
                  >
                    <AlertTriangle size={10} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span>
                      Context is large. Consider a bigger model — Claude Sonnet 4.5 (200K),
                      Claude Opus 4 (200K), or Gemini 2.0 Pro (1M).
                    </span>
                  </p>
                ) : null}
              </div>
            </section>

            {/* Working directory picker */}
            <section aria-labelledby="workdir-pick-h">
              <h3
                id="workdir-pick-h"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]"
              >
                Working directory
              </h3>
              <select
                value={workdirId}
                onChange={(e) => setWorkdirId(e.target.value)}
                data-testid="workdir-pick"
                aria-label="Working directory"
                className={cn(
                  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-sm text-[var(--fg-primary)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                )}
              >
                {WORKING_DIRS.map((d) => (
                  <option key={`${d.id}/${d.branch}`} value={`${d.id}/${d.branch}`}>
                    {d.label}
                  </option>
                ))}
              </select>
            </section>

            {/* Injected context toggles */}
            <section aria-labelledby="ctx-toggles-h">
              <h3
                id="ctx-toggles-h"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]"
              >
                Auto-injected context
              </h3>
              <ul className="flex flex-col gap-1.5">
                {CONTEXT_TOGGLES.map((t) => {
                  const on = contextToggles.has(t.id);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => toggleContext(t.id)}
                        data-testid={`ctx-toggle-${t.id}`}
                        aria-pressed={on}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left',
                          'transition-colors duration-fast ease-out-soft',
                          on
                            ? 'border-[var(--accent-primary)]/40 bg-[rgba(99,102,241,0.06)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-base)] opacity-60',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'inline-flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] border',
                            on
                              ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                              : 'border-[var(--border-default)] bg-[var(--bg-elevated)]',
                          )}
                        >
                          {on ? <Check size={10} /> : null}
                        </span>
                        <span className="flex-1">
                          <span className="block text-xs font-medium text-[var(--fg-primary)]">
                            {t.label}
                          </span>
                          <span className="block text-[10px] text-[var(--fg-tertiary)]">
                            {t.detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Initial prompt preview */}
            <section aria-labelledby="prompt-prev-h">
              <h3
                id="prompt-prev-h"
                className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]"
              >
                Initial prompt
              </h3>
              <pre
                className={cn(
                  'thin-scrollbar max-h-[160px] overflow-y-auto rounded-[var(--radius-md)]',
                  'border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3',
                  'font-mono text-[11px] leading-relaxed text-[var(--fg-primary)]',
                )}
              >
                {prompt}
              </pre>
            </section>
          </div>

          {/* RIGHT — summary */}
          <aside className="flex flex-col gap-4 px-5 py-5">
            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
                Estimated effort
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-[var(--fg-primary)]">{story.estimate}</span>
                <span className="text-[11px] text-[var(--fg-tertiary)]">({estimateHours(story.estimate)}h)</span>
              </p>
              <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">
                {story.acceptanceCriteria.length} acceptance criteria · {story.subtasks.length} subtasks
              </p>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-tertiary)]">
                Estimated cost
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <DollarSign
                  size={12}
                  aria-hidden="true"
                  className="self-center text-[var(--accent-emerald)]"
                />
                <span
                  className="text-xl font-bold text-[var(--fg-primary)]"
                  data-testid="estimated-cost"
                >
                  ${estimatedCost < 0.01 ? estimatedCost.toFixed(4) : estimatedCost.toFixed(3)}
                </span>
                <span className="text-[11px] text-[var(--fg-tertiary)]">
                  ({model.label})
                </span>
              </p>
              <p className="mt-1 text-[10px] text-[var(--fg-tertiary)]">
                {estimatedTokens.toLocaleString()} tokens · {(contextRatio * 100).toFixed(1)}% of window
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Row icon={Cpu} label="Model" value={model.label} />
              <Row icon={Folder} label="Workspace" value={workdirId} />
              <Row icon={GitBranch} label="Branch" value={`feature/${story.identifier.toLowerCase()}`} />
              <Row icon={GitPullRequest} label="PR target" value="main" />
              <Row icon={FileCode} label="Linked files" value="2 files" />
              <Row icon={TerminalSquare} label="Terminal target" value="Forge Terminal" />
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--accent-primary)]/30 bg-[rgba(99,102,241,0.06)] p-3">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--accent-primary)]">
                <Sparkles size={12} aria-hidden="true" />
                Story → Terminal handoff
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--fg-secondary)]">
                Story status will auto-flip to <span className="font-mono">in_progress</span>.
                You'll see a live coding indicator on the story card while the agent works.
              </p>
            </div>
          </aside>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-3">
          <p className="text-[11px] text-[var(--fg-tertiary)]">
            {contextToggles.size} of {CONTEXT_TOGGLES.length} context items selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              data-testid="start-implementation-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleStart}
              disabled={starting}
              data-testid="start-implementation-go"
              className="gap-1.5"
            >
              {starting ? (
                <>
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  Opening session…
                </>
              ) : (
                <>
                  <Code2 size={12} aria-hidden="true" />
                  Start implementation
                  <ArrowRight size={12} aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ContextToggleId = (typeof CONTEXT_TOGGLES)[number]['id'];

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px]">
      <Icon size={11} aria-hidden="true" className="shrink-0 text-[var(--fg-tertiary)]" />
      <span className="text-[var(--fg-tertiary)]">{label}</span>
      <span className="ml-auto truncate text-right font-mono text-[var(--fg-primary)]">{value}</span>
    </div>
  );
}

function estimateHours(estimate: Story['estimate']): number {
  return ({ XS: 2, S: 4, M: 8, L: 16, XL: 32 }[estimate] ?? 8);
}
