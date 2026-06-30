'use client';

import * as React from 'react';
import {
  Bot,
  Compass,
  Lightbulb,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/lib/store';
import { AI_REASONING, WIZARD_STEPS } from '@/lib/onboarding/data';

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
  /** Form content for the active step (rendered inside the right panel). */
  children: React.ReactNode;
  /**
   * Optional banner rendered between the top bar and the split grid.
   * Pass `null` to suppress the orchestrator-stub warning entirely.
   */
  banner?: React.ReactNode | null;
  /** Optional slot for top-right ghost links (skip / sample data). */
  headerActions?: React.ReactNode;
  /** Optional footer slot — usually the Back / Skip / Next nav. */
  footer?: React.ReactNode;
}

/**
 * Project Onboarding shell — fixed-height split layout:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ top bar (h-14, fixed)                                       │
 *   ├──────────────┬──────────────────────────────────────────────┤
 *   │ stepper      │ right panel (scrollable, independent)        │
 *   │ (320px,      │  - step header (number + title + desc)       │
 *   │  scrollable) │  - form content (children)                   │
 *   │              │  - AI reasoning + tip sub-section            │
 *   ├──────────────┴──────────────────────────────────────────────┤
 *   │ bottom bar (h-16, fixed) — Back / Skip / Next              │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The page itself never scrolls — both panels own their own scroll
 * containers, so clicking a step only swaps the form content and
 * resets the right panel's scroll position. No `window.scrollTo` or
 * `scrollIntoView` calls anywhere in the flow.
 *
 * Wraps `<AdminShell>` so the wizard lives inside the standard
 * persona chrome (sidebar + topbar + breadcrumbs).
 */
export function WizardShell({
  children,
  banner,
  headerActions,
  footer,
}: WizardShellProps) {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const total = WIZARD_STEPS.length;
  const step = WIZARD_STEPS.find((s) => s.id === currentStep) ?? WIZARD_STEPS[0]!;

  // Right-panel scroll container — used to reset to top on step change.
  const mainRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    // Reset only the right panel's scroll, never the window.
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  // Lock window scroll while the wizard is mounted — defensive belt
  // and suspenders alongside the `overflow-hidden` container, so that
  // focus rings / overscroll-glow can't push the page around.
  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const reduced = usePrefersReducedMotion();

  const pct = Math.max(
    0,
    Math.min(100, ((currentStep - 1) / Math.max(1, total - 1)) * 100),
  );

  return (
    <AdminShell>
      <div
        className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden"
        data-testid="project-onboarding"
      >
        {/* ─── Top bar (fixed) ─────────────────────────────────────── */}
        <header
          className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
          data-testid="wizard-topbar"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Compass
              className="h-4 w-4 shrink-0"
              style={{ color: 'var(--accent-primary)' }}
              aria-hidden="true"
            />
            <div className="flex min-w-0 items-baseline gap-3">
              <span
                className="truncate"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--fg-primary)',
                }}
              >
                Project Onboarding
              </span>
              <span
                className="hidden truncate uppercase tracking-[0.18em] sm:inline"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--fg-tertiary)',
                }}
              >
                Step {currentStep} of {total} · {Math.round(pct)}%
              </span>
            </div>
          </div>

          {/* Progress bar (desktop only — mobile uses the inline label above) */}
          <div className="hidden flex-1 px-6 lg:block">
            <div
              className="h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--bg-inset)' }}
              aria-hidden="true"
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
              />
            </div>
          </div>

          {headerActions ? (
            <div
              className="flex shrink-0 items-center gap-2"
              data-testid="wizard-header-actions"
            >
              {headerActions}
            </div>
          ) : null}
        </header>

        {/* ─── Conditional warning banner ─────────────────────────── */}
        {banner != null ? <div data-testid="wizard-banner">{banner}</div> : null}

        {/* ─── Split layout: stepper (left) | content (right) ─────── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_1fr] overflow-hidden lg:grid-cols-[240px_1fr] lg:grid-rows-1 xl:grid-cols-[320px_1fr]">
          {/* Mobile / tablet stepper — horizontal pill list at top */}
          <div
            className="border-b lg:hidden"
            style={{ borderColor: 'var(--border-subtle)' }}
            data-testid="wizard-stepper-mobile"
          >
            <HorizontalStepper
              currentStep={currentStep}
              steps={WIZARD_STEPS}
              onJump={(s) => setStep(s)}
            />
          </div>

          {/* Desktop vertical stepper (left panel, independently scrollable) */}
          <aside
            className="hidden min-h-0 overflow-y-auto border-r lg:block"
            style={{ borderColor: 'var(--border-subtle)' }}
            data-testid="wizard-stepper"
          >
            <div className="p-4 xl:p-6">
              <VerticalStepper
                currentStep={currentStep}
                steps={WIZARD_STEPS}
                onJump={(s) => setStep(s)}
              />
            </div>
          </aside>

          {/* Right panel: form content + AI sub-section, scrollable */}
          <main
            ref={mainRef}
            id="wizard-step-content"
            className="min-h-0 overflow-y-auto"
            data-testid="wizard-main"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
              {/* Step header — number + title + description */}
              <StepHeader currentStep={currentStep} step={step} />

              {/* Form content — the `key` forces React to remount
                  on step change so all per-step local state resets. We
                  intentionally avoid AnimatePresence / framer-motion
                  here because the slide+fade animation had been
                  sticking the form at opacity:0 inside the nested
                  scroll layout. A plain div keeps the form reliably
                  visible at all times. */}
              <div
                key={currentStep}
                data-testid="wizard-step-form"
                className="min-w-0"
              >
                {children}
              </div>

              {/* AI reasoning sub-section (kept inside the right panel
                  per the layout fix — no third column). */}
              <LiveAIPanel currentStep={currentStep} step={step} />
            </div>
          </main>
        </div>

        {/* ─── Bottom bar (fixed, no scroll) ──────────────────────── */}
        {footer ? (
          <footer
            className="flex h-16 shrink-0 items-center justify-between border-t px-4 sm:px-6"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-subtle)',
            }}
            data-testid="wizard-footer"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
              {footer}
            </div>
          </footer>
        ) : null}
      </div>
    </AdminShell>
  );
}

/* ============================================================================
 * Step header — sits at the top of the right panel. Renders the step
 * number badge, the title (also the visible h1 for screen readers),
 * and the short description below it.
 * ========================================================================== */

function StepHeader({
  currentStep,
  step,
}: {
  currentStep: number;
  step: { id: number; title: string; description: string };
}) {
  return (
    <div className="space-y-2" data-testid="wizard-step-header">
      <p
        className="flex items-center gap-2"
        style={{
          fontSize: 'var(--text-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'var(--fg-tertiary)',
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full font-mono"
          style={{
            fontSize: 10,
            fontWeight: 'var(--font-weight-semibold)',
            background: 'var(--accent-primary)',
            color: 'white',
          }}
        >
          {currentStep}
        </span>
        <span>Step {currentStep}</span>
      </p>
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          lineHeight: 'var(--leading-tight, 1.2)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--fg-primary)',
        }}
      >
        {step.title}
      </h1>
      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--fg-secondary)',
          lineHeight: 'var(--leading-base)',
        }}
      >
        {step.description}
      </p>
    </div>
  );
}

/* ============================================================================
 * Vertical stepper — the left-panel navigation. Done, active, and
 * pending steps all show the step number (with an emerald check for
 * done and a primary glow for active). Skippable steps render a small
 * "Skip" badge. Clicking any step jumps to it (no page scroll).
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
        const isLast = idx === steps.length - 1;
        return (
          <li key={s.id} className="relative">
            <button
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={active ? 'step' : undefined}
              aria-label={`Step ${s.id}: ${s.title}${done ? ' (completed)' : active ? ' (current)' : ' (upcoming)'}`}
              className={cn(
                'group flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                'hover:bg-[var(--hover)] cursor-pointer',
                active && 'bg-[var(--bg-inset)]',
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
                  color: done || active ? 'white' : 'var(--fg-tertiary)',
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
 * Horizontal stepper — mobile / narrow viewport. Same data, rendered
 * as a horizontally scrollable pill list so it never wraps the page.
 * ========================================================================== */

function HorizontalStepper({
  currentStep,
  steps,
  onJump,
}: {
  currentStep: number;
  steps: ReadonlyArray<{
    id: number;
    title: string;
    description: string;
  }>;
  onJump: (step: number) => void;
}) {
  return (
    <ol
      className="flex items-center gap-2 overflow-x-auto px-3 py-3"
      data-testid="wizard-step-indicator-horizontal"
      aria-label="Wizard progress"
    >
      {steps.map((s) => {
        const active = s.id === currentStep;
        const done = s.id < currentStep;
        return (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onJump(s.id)}
              aria-current={active ? 'step' : undefined}
              aria-label={`Step ${s.id}: ${s.title}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
              )}
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: active
                  ? 'var(--font-weight-semibold)'
                  : 'var(--font-weight-medium)',
                background: active ? 'var(--bg-inset)' : undefined,
                borderColor: active
                  ? 'rgba(99, 102, 241, 0.50)'
                  : done
                    ? 'rgba(16, 185, 129, 0.40)'
                    : 'var(--border-subtle)',
                color: active
                  ? 'var(--fg-primary)'
                  : done
                    ? 'var(--accent-emerald)'
                    : 'var(--fg-tertiary)',
              }}
              data-testid={`wizard-step-${s.id}`}
              data-state={active ? 'active' : done ? 'done' : 'pending'}
            >
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full font-mono"
                style={{
                  fontSize: 9,
                  background: done
                    ? 'var(--accent-emerald)'
                    : active
                      ? 'var(--accent-primary)'
                      : 'var(--bg-inset)',
                  color: done || active ? 'white' : 'var(--fg-tertiary)',
                }}
                aria-hidden="true"
              >
                {done ? '✓' : s.id}
              </span>
              <span className="whitespace-nowrap">{s.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ============================================================================
 * Live AI reasoning panel — word-by-word animation against the lines
 * stored in `AI_REASONING[currentStep]`. Falls back to the static
 * description when no reasoning is configured for a step. Lives as a
 * sub-section inside the right panel rather than as a third column.
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
    <div className="space-y-4" data-testid="wizard-ai-panel">
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