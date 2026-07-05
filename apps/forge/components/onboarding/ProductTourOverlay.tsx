'use client';

/**
 * ProductTourOverlay — M9-G1 (Track B / T-B1).
 *
 * Lightweight, dependency-free guided tour for the Onboarding Wizard.
 * Six stops walk a new pilot through the major wizard sections:
 *
 *   0. Welcome         — what Forge is and what the wizard does
 *   1. Tenant setup    — tenant name, region, cost ceiling
 *   2. Connect AI      — wire up the LLM provider
 *   3. Connect repos   — pick the repos to onboard
 *   4. Governance      — approval gates, audit, budget
 *   5. Review          — final summary + provision
 *
 * Position: fixed overlay anchored to the centre of the viewport
 * with z-index 1000, behind a dimmed backdrop. Optionally each stop
 * targets a DOM element via `anchorSelector` — when found, the
 * anchor gets a highlight ring; otherwise the card falls back to
 * the centred position.
 *
 * Controls: Prev / Next / Skip / Done.
 *
 * The overlay reads its open/closed state from the
 * `useOnboardingTour` hook (see `lib/onboarding/tour.ts`), which
 * owns localStorage persistence. The page renders the overlay
 * once at the root so it survives step transitions.
 *
 * Test selectors:
 *   - data-testid="product-tour-overlay"        (root)
 *   - data-testid="product-tour-backdrop"        (backdrop)
 *   - data-testid="tour-card"                    (active card)
 *   - data-testid="tour-stop-{index}"            (per stop card; identical to tour-card but pinned to index)
 *   - data-testid="tour-prev" / "tour-next"      (navigation)
 *   - data-testid="tour-skip"                    (skip control)
 *   - data-testid="tour-done"                    (final-step Done button)
 *   - data-testid="tour-progress"                ("3 / 6" marker)
 *   - data-testid="tour-anchor"                  (highlighted anchor when present)
 */

import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single guided tour stop — title, body, optional icon, optional
 * anchor element selector. Stops are ordered; the overlay walks them
 * one at a time. */
export interface TourStop {
  /** Stable id — used as React key. */
  id: string;
  title: string;
  body: string;
  /** Lucide icon component. Optional but strongly recommended for
   * visual consistency with the wizard. */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Optional CSS selector for a target element on the page. When
   * the element is found, it receives a highlight ring; otherwise
   * the card defaults to the centred position. */
  anchorSelector?: string;
}

export interface ProductTourOverlayProps {
  /** Whether the overlay should render at all. When false, renders
   * `null` and skips the dim layer. */
  isOpen: boolean;
  /** Index of the active stop (0..stops.length - 1). */
  stopIndex: number;
  /** Ordered stop list. Typically the module-level TOUR_STOPS
   * constant. */
  stops: ReadonlyArray<TourStop>;
  /** Fired when the user clicks "Prev" on stop 0 (no-op since there
   * is no previous stop, but exposed for symmetry / testability). */
  onPrev: () => void;
  /** Fired when the user clicks "Next". On the final stop, the
   * parent usually closes the overlay and persists completion. */
  onNext: () => void;
  /** Fired when the user clicks "Skip" — overlay closes + skip is
   * persisted to localStorage so the tour does not reappear. */
  onSkip: () => void;
  /** Fired when the user clicks "Done" on the final stop. */
  onDone: () => void;
  /** Optional className applied to the card. */
  className?: string;
}

/** Built-in default 6-stop tour matching the spec (M9 spec §3.2.8 +
 * Track B T-B1). Anchors intentionally point at ids that exist
 * *somewhere* in the wizard shell — they degrade gracefully when
 * the underlying step has not been mounted yet. */
export const TOUR_STOPS: ReadonlyArray<TourStop> = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: 'Forge runs your SDLC end-to-end: agents, knowledge graph, governance. This wizard gets a pilot tenant live in under five minutes.',
    icon: Rocket,
    anchorSelector: '[data-testid="step-welcome"]',
  },
  {
    id: 'tenant-setup',
    title: 'Tenant setup',
    body: 'Name your tenant, pick a region, and set a monthly LLM cost ceiling. Region affects data residency; the cost ceiling is enforced at the LiteLLM router.',
    icon: Building2,
    anchorSelector: '[data-testid="step-welcome"]',
  },
  {
    id: 'connect-providers',
    title: 'Connect an AI provider',
    body: 'Wire up at least one LLM provider — Anthropic, OpenAI, Bedrock, Vertex, Azure, or any OpenAI-compatible endpoint. All agent traffic flows through this connection.',
    icon: Plug,
    anchorSelector: '[data-testid="step-welcome"]',
  },
  {
    id: 'connect-repos',
    title: 'Connect repos',
    body: 'Pick the source repositories to onboard. Forge clones shallow copies first; the deep knowledge-graph scan runs during your first intel pass.',
    icon: Plug,
    anchorSelector: '[data-testid="step-welcome"]',
  },
  {
    id: 'governance',
    title: 'Governance defaults',
    body: 'Set approval gates, audit retention, and budget policies before agents go live. These defaults are tuned for safe rollout — tighten them per project later.',
    icon: ShieldCheck,
    anchorSelector: '[data-testid="step-welcome"]',
  },
  {
    id: 'review',
    title: 'Review & provision',
    body: 'Confirm everything looks right, then provision. Provisioning spins up the project graph shard, connectors, and the audit channel — usually under a minute.',
    icon: Sparkles,
    anchorSelector: '[data-testid="step-welcome"]',
  },
];

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface AnchorGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Try to locate an element matching `selector` and return its
 * bounding rect. Returns `null` when no element is found or the
 * element is not visible (display: none, hidden behind fixed
 * parents, etc). The overlay falls back to a centred card in that
 * case so the tour never silently breaks. */
function resolveAnchorGeometry(
  selector: string | undefined,
): AnchorGeometry | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  if (!selector) return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

const OVERLAY_Z = 1000;
const HIGHLIGHT_PADDING = 4;

/**
 * Overlay component. Render-once at the page root so the tour survives
 * step transitions while the user is on the onboarding wizard.
 */
export function ProductTourOverlay({
  isOpen,
  stopIndex,
  stops,
  onPrev,
  onNext,
  onSkip,
  onDone,
  className,
}: ProductTourOverlayProps) {
  // Render nothing when the tour is closed — keeps the DOM clean and
  // lets the parent gate the entire lifecycle.
  if (!isOpen) return null;
  if (stops.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(stops.length - 1, stopIndex));
  const stop = stops[safeIndex]!;
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === stops.length - 1;
  const total = stops.length;

  // Re-resolve the anchor geometry whenever the stop changes OR the
  // window scrolls/resizes. The tour is contained within the wizard
  // page, so we listen on window (sufficient for the wizard shell).
  const [anchor, setAnchor] = React.useState<AnchorGeometry | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => {
      setAnchor(resolveAnchorGeometry(stop.anchorSelector));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [stop.anchorSelector, safeIndex]);

  // When an anchor resolves, position the card to its bottom-right
  // with a 16px gutter. Otherwise centre it on the viewport. The
  // fallback is the default; never leave the card orphaned off-screen.
  const cardStyle = ((): React.CSSProperties => {
    if (!anchor) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }
    const desiredLeft = anchor.left + anchor.width + 16;
    const cardWidth = 360;
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : cardWidth;
    const clampedLeft = Math.min(
      Math.max(16, desiredLeft),
      Math.max(16, viewportWidth - cardWidth - 16),
    );
    const desiredTop = anchor.top + anchor.height / 2 - 120;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 400;
    const clampedTop = Math.min(
      Math.max(16, desiredTop),
      Math.max(16, viewportHeight - 320),
    );
    return {
      position: 'fixed',
      top: clampedTop,
      left: clampedLeft,
      width: cardWidth,
    };
  })();

  const Icon = stop.icon ?? CheckCircle2;

  const handleBackdropClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Backdrop click ≡ "skip" — matches every other on-by-default
      // tour pattern users are already trained on. The card itself
      // stops propagation so clicks inside the card do not bubble.
      if (e.target === e.currentTarget) {
        onSkip();
      }
    },
    [onSkip],
  );

  return (
    <div
      data-testid="product-tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Forge product tour — ${stop.title}`}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: OVERLAY_Z,
        pointerEvents: 'auto',
        cursor: 'default',
      }}
    >
      {/* Dim backdrop (no pointer-events blocking — the overlay's
       * root handles backdrop clicks). */}
      <div
        data-testid="product-tour-backdrop"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(2, 6, 23, 0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Highlight ring around the anchored element, if any. We use
       * a fixed-positioned div so it follows the geometry without
       * disturbing the page layout. */}
      {anchor ? (
        <div
          data-testid="tour-anchor"
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: anchor.top - HIGHLIGHT_PADDING,
            left: anchor.left - HIGHLIGHT_PADDING,
            width: anchor.width + HIGHLIGHT_PADDING * 2,
            height: anchor.height + HIGHLIGHT_PADDING * 2,
            borderRadius: 12,
            border: '2px solid var(--accent-primary)',
            boxShadow:
              '0 0 0 4px rgba(99, 102, 241, 0.18), 0 0 24px rgba(99, 102, 241, 0.45)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-xl)]',
          className,
        )}
        style={{
          ...cardStyle,
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border-subtle)',
          zIndex: OVERLAY_Z + 1,
        }}
        data-testid={`tour-stop-${safeIndex}`}
      >
        <span
          aria-hidden="true"
          data-testid="tour-card"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            margin: -1,
            padding: 0,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        />
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--accent-primary)',
            }}
          >
            <Icon className="h-4 w-4" aria-hidden={true} />
          </span>
          <div className="flex-1">
            <h3
              style={{
                fontSize: 'var(--text-md)',
                fontWeight: 'var(--font-weight-semibold)',
                color: 'var(--fg-primary)',
                lineHeight: 'var(--leading-md)',
              }}
            >
              {stop.title}
            </h3>
            <p
              data-testid="tour-progress"
              style={{
                fontSize: 10,
                color: 'var(--fg-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                marginTop: 2,
              }}
            >
              Stop {safeIndex + 1} of {total}
            </p>
          </div>
          <button
            type="button"
            aria-label="Skip tour"
            onClick={onSkip}
            data-testid="tour-skip"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
          >
            <X className="h-4 w-4" aria-hidden={true} />
          </button>
        </header>

        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-secondary)',
            lineHeight: 'var(--leading-base)',
            marginTop: 12,
          }}
        >
          {stop.body}
        </p>

        <footer
          className="mt-4 flex items-center justify-between gap-2"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}
        >
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            data-testid="tour-prev"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--fg-secondary)' }}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden={true} />
            Prev
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSkip}
              data-testid="tour-skip-footer"
              className="rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--hover)]"
              style={{ color: 'var(--fg-secondary)' }}
            >
              Skip tour
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={onDone}
                data-testid="tour-done"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                style={{
                  background: 'var(--accent-primary)',
                  color: 'white',
                }}
              >
                Done
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden={true} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onNext}
                data-testid="tour-next"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                style={{
                  background: 'var(--accent-primary)',
                  color: 'white',
                }}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" aria-hidden={true} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default ProductTourOverlay;
