'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Compass, Lightbulb, Sparkles, TriangleAlert, X } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/lib/store';
import { AI_REASONING, WIZARD_STEPS } from '@/lib/onboarding/data';

/** AnimatePresence alias with relaxed typing — TS module resolution for
 *  framer-motion 11 is flaky under pnpm-hoisted installs, so we cast
 *  to `any` here rather than fighting the inference at every call site.
 *  Runtime behavior is unchanged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnimatePresenceAny = AnimatePresence as unknown as React.ComponentType<any>;

/**
 * Read the user's `prefers-reduced-motion` setting. Lives in the
 * component module instead of pulling `useReducedMotion` from
 * framer-motion because the TS resolution of that hook can be flaky
 * across pnpm-hoisted installs; the underlying behavior is identical
 * (a `matchMedia` query subscription).
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return reduced;
}

export interface WizardShellProps {
  children: React.ReactNode;
  /**
   * Optional banner rendered between the header and the step grid.
   * Pass `null` to suppress the orchestrator-stub warning entirely.
   */
  banner?: React.ReactNode | null;
  /** Optional slot for top-right ghost links (skip / sample data). */
  headerActions?: React.ReactNode;
}

/**
 * Project Onboarding shell — animated gradient hero, vertical
 * stepper on the left, centered main content, and a live AI
 * reasoning panel on the right.
 *
 * Wraps `<AdminShell>` so the wizard lives inside the standard
 * persona chrome (sidebar + topbar + breadcrumbs).
 */
export function WizardShell({ children, banner, headerActions }: WizardShellProps) {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const total = WIZARD_STEPS.length;
  const step = WIZARD_STEPS.find((s) => s.id === currentStep) ?? WIZARD_STEPS[0]!;

  // Track navigation direction for slide animations.
  const previousStep = React.useRef(currentStep);
  const [direction, setDirection] = React.useState<1 | -1>(1);
  React.useEffect(() => {
    setDirection(currentStep > previousStep.current ? 1 : -1);
    previousStep.current = currentStep;
  }, [currentStep]);

  const reduced = usePrefersReducedMotion();
  const slideVariants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, x: dir === 1 ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: 1 | -1) => ({ opacity: 0, x: dir === 1 ? -24 : 24 }),
  };

  const pct = Math.max(
    0,
    Math.min(100, ((currentStep - 1) / Math.max(1, total - 1)) * 100),
  );

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="project-onboarding"
      >
        {/* Header — eyebrow + h1 + body + top-right ghost actions */}
        <header
          className="relative overflow-hidden rounded-[var(--radius-xl)] p-6"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-glow-primary)',
          }}
        >
          {/* Animated gradient halo */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-px"
            style={{
              background:
                'linear-gradient(120deg, rgba(99,102,241,0.18), rgba(139,92,246,0.10) 30%, transparent 60%, rgba(34,211,238,0.18))',
              filter: 'blur(20px)',
              opacity: 0.6,
            }}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.18em',
                  color: 'var(--fg-tertiary)',
                }}
              >
                Project Onboarding
              </p>
              <h1
                className="flex items-center gap-2"
                style={{
                  fontSize: 'var(--text-3xl)',
                  lineHeight: 'var(--leading-3xl)',
                  fontWeight: 'var(--font-weight-bold)',
                  color: 'var(--fg-primary)',
                }}
              >
                <Compass
                  className="h-6 w-6"
                  style={{ color: 'var(--accent-primary)' }}
                  aria-hidden="true"
                />
                Welcome to Forge
              </h1>
              <p
                className="max-w-2xl"
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--fg-secondary)',
                  lineHeight: 'var(--leading-base)',
                }}
              >
                Let&apos;s set up your AI workforce. We&apos;ll guide you through
                connecting your stack, registering agents, and launching
                your first project. Takes ~5 minutes.
              </p>
            </div>
            {headerActions ? (
              <div
                className="flex items-center gap-3"
                data-testid="wizard-header-actions"
              >
                {headerActions}
              </div>
            ) : null}
          </div>

          {/* Progress meta */}
          <div className="relative mt-5 flex items-center justify-between">
            <span
              className="uppercase tracking-[0.18em]"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--fg-tertiary)',
              }}
            >
              Step {currentStep} of {total}
            </span>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--fg-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
              data-testid="wizard-progress-pct"
            >
              {Math.round(pct)}%
            </span>
          </div>
          <div
            className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--bg-inset)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background:
                  'linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-violet) 50%, var(--accent-cyan) 100%)',
                transition: 'width var(--motion-slow) cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              data-testid="wizard-progress-bar"
              data-pct={Math.round(pct)}
              aria-hidden="true"
            />
          </div>
        </header>

        {/* Conditional warning banner */}
        {banner != null ? <div data-testid="wizard-banner">{banner}</div> : null}

        {/* Three-column grid — vertical stepper (left) | main (center) | live AI panel (right) */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,300px)] lg:grid-cols-1">
          <aside
            className="self-start xl:sticky xl:top-6"
            data-testid="wizard-stepper"
          >
            <VerticalStepper
              currentStep={currentStep}
              steps={WIZARD_STEPS}
              onJump={(s) => setStep(s)}
            />
          </aside>

          <div className="relative min-w-0">
            <div className="mx-auto max-w-[720px]">
              <AnimatePresenceAny initial={false} custom={direction}>
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={reduced ? undefined : slideVariants}
                  initial={reduced ? { opacity: 0 } : 'enter'}
                  animate={reduced ? { opacity: 1 } : 'center'}
                  exit={reduced ? { opacity: 0 } : 'exit'}
                  transition={{
                    duration: reduced ? 0.15 : 0.28,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  {children}
                </motion.div>
              </AnimatePresenceAny>
            </div>
          </div>

          <aside
            className="self-start xl:sticky xl:top-6"
            data-testid="wizard-side-panel"
          >
            <LiveAIPanel currentStep={currentStep} step={step} />
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}

/* ============================================================================
 * Vertical stepper — replaces the horizontal chip rail. Done steps
 * are clickable, the active step glows with the accent-primary color,
 * skippable steps show a small "Skip" badge.
 * ========================================================================== */

function VerticalStepper({
  currentStep,
  steps,
  onJump,
}: {
  currentStep: number;
  steps: ReadonlyArray<{
    id: number;
    title: string;
    description: string;
    skippable?: boolean;
  }>;
  onJump: (step: number) => void;
}) {
  return (
    <ol
      className="space-y-1"
      data-testid="wizard-step-indicator"
      aria-label="Wizard progress"
    >
      {steps.map((s, idx) => {
        const active = s.id === currentStep;
        const done = s.id < currentStep;
        const upcoming = s.id > currentStep;
        const isLast = idx === steps.length - 1;
        return (
          <li key={s.id} className="relative">
            <button
              type="button"
              disabled={!done}
              onClick={() => done && onJump(s.id)}
              aria-current={active ? 'step' : undefined}
              aria-label={`Step ${s.id}: ${s.title}${done ? ' (completed)' : active ? ' (current)' : ' (upcoming)'}`}
              className={cn(
                'group flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                done && 'cursor-pointer hover:bg-[var(--hover)]',
                active && 'bg-[var(--bg-inset)]',
                upcoming && 'cursor-default',
              )}
              style={{
                background: active ? 'var(--bg-inset)' : undefined,
                border: active
                  ? '1px solid rgba(99, 102, 241, 0.30)'
                  : '1px solid transparent',
              }}
              data-testid={`wizard-step-${s.id}`}
              data-state={active ? 'active' : done ? 'done' : 'pending'}
            >
              <span
                className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full font-mono"
                style={{
                  fontSize: 10,
                  fontWeight: 'var(--font-weight-semibold)',
                  background: done
                    ? 'var(--accent-emerald)'
                    : active
                      ? 'var(--accent-primary)'
                      : 'var(--bg-inset)',
                  color:
                    done || active ? 'white' : 'var(--fg-tertiary)',
                  boxShadow: active
                    ? '0 0 0 4px rgba(99, 102, 241, 0.18)'
                    : undefined,
                }}
                aria-hidden="true"
              >
                {done ? (
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      d="M3 8.5l3.5 3.5L13 5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  s.id
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="flex items-center gap-2"
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: active
                      ? 'var(--font-weight-semibold)'
                      : 'var(--font-weight-medium)',
                    color: active
                      ? 'var(--fg-primary)'
                      : done
                        ? 'var(--accent-emerald)'
                        : 'var(--fg-tertiary)',
                  }}
                >
                  <span className="truncate">{s.title}</span>
                  {s.skippable ? (
                    <span
                      className="rounded-sm border px-1 py-px"
                      style={{
                        fontSize: 8,
                        textTransform: 'uppercase',
                        letterSpacing: '0.18em',
                        color: 'var(--fg-tertiary)',
                        borderColor: 'var(--border-subtle)',
                      }}
                    >
                      Skip
                    </span>
                  ) : null}
                </span>
                <p
                  className="mt-0.5 truncate"
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-tertiary)',
                  }}
                >
                  {s.description}
                </p>
              </span>
            </button>
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute left-[19px] top-8 h-3 w-px"
                style={{
                  background: done
                    ? 'var(--accent-emerald)'
                    : 'var(--border-subtle)',
                  opacity: 0.6,
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ============================================================================
 * Live AI reasoning panel — word-by-word animation against the lines
 * stored in `AI_REASONING[currentStep]`. Falls back to the static
 * description when no reasoning is configured for a step.
 * ========================================================================== */

function LiveAIPanel({
  currentStep,
  step,
}: {
  currentStep: number;
  step: { title: string; description: string; hint?: string };
}) {
  const lines = AI_REASONING[currentStep] ?? [step.description];
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    setVisibleCount(0);
    if (lines.length === 0) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= lines.length) {
        window.clearInterval(id);
      }
    }, 950);
    return () => window.clearInterval(id);
  }, [currentStep, lines]);

  const visible = lines.slice(0, visibleCount);
  const hint = step.hint ?? step.description;

  return (
    <div
      className="space-y-4"
      data-testid="wizard-ai-panel"
    >
      <div
        className="rounded-[var(--radius-lg)] border p-5 space-y-3"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            className="flex items-center gap-2"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            <Lightbulb
              className="h-4 w-4"
              style={{ color: 'var(--accent-amber)' }}
              aria-hidden="true"
            />
            What is happening
          </h2>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: 'var(--accent-violet)',
              background: 'rgba(139, 92, 246, 0.10)',
              border: '1px solid rgba(139, 92, 246, 0.30)',
            }}
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--accent-violet)' }}
            />
            forge-pi
          </span>
        </div>

        <div
          className="min-h-[88px] space-y-1.5"
          aria-live="polite"
          data-testid="wizard-ai-reasoning"
        >
          {visible.length === 0 ? (
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--fg-tertiary)',
              }}
            >
              Waiting for the next instruction…
            </p>
          ) : (
            visible.map((line, idx) => (
              <p
                key={`${currentStep}-${idx}`}
                className="flex items-start gap-2"
                style={{
                  fontSize: 'var(--text-xs)',
                  color:
                    idx === visible.length - 1
                      ? 'var(--fg-primary)'
                      : 'var(--fg-secondary)',
                  lineHeight: 'var(--leading-base)',
                }}
              >
                <Bot
                  className="mt-0.5 h-3 w-3 shrink-0"
                  style={{ color: 'var(--accent-violet)' }}
                  aria-hidden="true"
                />
                <span>{line}</span>
              </p>
            ))
          )}
          {visible.length < lines.length && visible.length > 0 ? (
            <span
              aria-hidden="true"
              className="ml-4 inline-block h-3 w-1 animate-pulse"
              style={{ background: 'var(--accent-violet)' }}
            />
          ) : null}
        </div>
      </div>

      {hint ? (
        <div
          className="rounded-[var(--radius-lg)] border p-4"
          style={{
            background: 'var(--bg-inset)',
            borderColor: 'var(--border-subtle)',
          }}
          data-testid="wizard-tip"
        >
          <p
            className="flex items-start gap-2"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-secondary)',
              lineHeight: 'var(--leading-base)',
            }}
          >
            <Sparkles
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--accent-violet)' }}
              aria-hidden="true"
            />
            <span>
              <strong style={{ color: 'var(--fg-primary)' }}>Tip — </strong>
              {hint}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
 * Orchestrator-stub warning banner. Exported separately so the page can
 * conditionally render it based on `/v1/onboarding/catalog` reachability.
 * ========================================================================== */

export function OrchestratorStubBanner({
  status,
}: {
  status?: { error?: string; httpStatus?: number } | null;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;

  return (
    <div
      role="alert"
      data-testid="backend-banner-onboarding"
      className="flex items-start gap-3 rounded-[var(--radius-lg)] p-4"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.30)',
      }}
    >
      <TriangleAlert
        className="mt-0.5 h-5 w-5 shrink-0"
        style={{ color: 'var(--accent-amber)' }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--fg-primary)',
          }}
        >
          Orchestrator stub not running
        </p>
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
          }}
        >
          The wizard can collect your inputs, but the final{' '}
          <em>Confirm</em> step has no backend to provision against. Start
          the dev orchestrator stub on{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>
            http://localhost:4000
          </code>{' '}
          to enable project creation.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <KbdPill command="pnpm dev:stub" />
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
            }}
          >
            or run the full stack:
          </span>
          <KbdPill command="pnpm dev:stack" />
        </div>
        {status?.error ? (
          <p
            className="font-mono"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-tertiary)',
            }}
          >
            {status.httpStatus && status.httpStatus > 0
              ? `HTTP ${status.httpStatus} — `
              : ''}
            {status.error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss orchestrator warning"
        className="rounded-md p-1 transition-colors hover:bg-[rgba(245,158,11,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-amber)]"
        style={{ color: 'var(--fg-secondary)' }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function KbdPill({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API may be unavailable in insecure contexts — silent fallthrough.
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-[rgba(245,158,11,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-amber)]"
      style={{
        background: 'rgba(245, 158, 11, 0.10)',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--fg-primary)',
      }}
      aria-label={`Copy ${command} to clipboard`}
    >
      <span>{command}</span>
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        {copied ? (
          <path
            d="M3 8.5l3 3L13 4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <rect x="5" y="5" width="9" height="9" rx="1.5" />
            <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}