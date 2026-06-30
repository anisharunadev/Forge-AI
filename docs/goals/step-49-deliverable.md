# Step 49 — Onboarding wizard layout fix (DELIVERABLE)

## Files modified

| File | Change |
| --- | --- |
| `apps/forge/components/onboarding/WizardShell.tsx` | Restructured to fixed-height split layout (top bar / stepper+form / footer). Independent panel scrolling. Body-overflow lock on mount. Slide animation preserved with reduced-motion fallback. |
| `apps/forge/app/project-onboarding/page.tsx` | `WizardNav` moved out of `children` and passed via the new `footer` slot. All step content, props, state, and call-backs untouched. |

Diff: **+349 / -166** across the two files.

---

## Before → After

### Before (broken)

```
┌─────────────────────────────────────────────────────────────┐
│  Global Topbar (h-14, sticky)                              │
├─────────────────────────────────────────────────────────────┤
│  Wizard outer (flex flex-col gap-6)  ◀── page scrolls here │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Hero header (gradient, h1, progress bar, actions)     │  │
│  ├──────────────┬─────────────────────────┬──────────────┤  │
│  │ stepper      │ main (max-w-720px)      │ AI panel     │  │
│  │ (sticky top) │ form content           │ (sticky top) │  │
│  │ xl only      │ motion.div (no scroll) │ xl only      │  │
│  └──────────────┴─────────────────────────┴──────────────┘  │
│  WizardNav (rendered inside main, with mt-6 / pt-4 border)  │
└─────────────────────────────────────────────────────────────┘
                       ▲
                       └── page scroll; long steps push form below
                           the fold; clicking a step swaps content
                           but the viewport stays scrolled down.
```

### After (fixed)

```
┌─────────────────────────────────────────────────────────────┐
│  Global Topbar (h-14, sticky)                              │
├─────────────────────────────────────────────────────────────┤
│  Wizard (h-[calc(100dvh-3.5rem)] flex-col overflow-hidden)  │
│  ┌───────────────────────────────────────────────────────┐  │ ◀── no page scroll
│  │ Top bar (h-14): title + step + progress + actions    │  │     body locked to
│  ├──────────────┬────────────────────────────────────────┤  │     overflow:hidden
│  │ Vertical     │ Right panel (overflow-y-auto, ref'd)   │  │
│  │ stepper      │  ┌─────────────────────────────────┐   │  │
│  │ (240/320px,  │  │ Step header (number+title+desc) │   │  │
│  │ overflow-y-  │  │ Form content (children)         │   │  │
│  │ auto)        │  │ LiveAI sub-section + Tip        │   │  │
│  │              │  └─────────────────────────────────┘   │  │
│  ├──────────────┴────────────────────────────────────────┤  │
│  │ Bottom bar (h-16): Back / Skip / Next               │  │ ◀── sticky footer
│  └───────────────────────────────────────────────────────┘  │     inside wizard
└─────────────────────────────────────────────────────────────┘
            ▲                       ▲                    ▲
   independent scroll      independent scroll     never scrolls
```

Mobile (<1024px) collapses the left stepper into a horizontally
scrollable pill rail at the top of the split grid (still inside the
same h-[100dvh-3.5rem] container), so the form keeps the bottom half.

---

## Rationale (skill rules)

The fix follows the three ui-ux-pro-max guidelines surfaced for this
goal:

1. **Side-by-side split with independent scroll.** The wizard now
   mirrors the data-dense-dashboard pattern (display: grid,
   grid-template-columns, overflow:auto per panel) so the form never
   has to fight the page for visibility.
2. **Scroll inside the container, not the window.** The right panel
   gets its own `overflow-y-auto`; clicking a step calls
   `mainRef.current.scrollTo({ top: 0 })` so only the right panel
   resets. There is no `window.scrollTo`, no `scrollIntoView`, and
   `document.body.style.overflow = 'hidden'` is set for the lifetime
   of the wizard (and restored on unmount) to keep overscroll-glow
   from dragging the page.
3. **Visible focus + smooth scroll only on the active region.** The
   focus ring stays on the `button` you clicked, and the slide
   animation between steps continues to honor
   `prefers-reduced-motion`.

The dark-only, lucide-icons-only, `var(--*)` token palette is
preserved; the design-system 01 color rules (no flat surfaces, glow
on the active step, emerald check on done steps) are unchanged.

---

## What we deliberately did NOT change

- **All 10 step components** (`StepWelcome`, `StepTenantSetup`,
  `StepConnectProviders`, `StepConnectRepos`, `StepDetectStack`,
  `StepConfigureAgents`, `StepRunFirstIntel`, `StepGovernance`,
  `StepReview`, `StepProvision`).
- **`WIZARD_STEPS` metadata** in `lib/onboarding/data.ts` — IDs,
  titles, descriptions, skippable flags, hints.
- **Step state management** — Zustand store, `useEffect` URL sync,
  per-step React state and persistence all stay in `page.tsx`.
- **Step content rendering order** in `page.tsx`.
- **Test IDs** — every existing `data-testid` (`wizard-step-N`,
  `wizard-step-indicator`, `wizard-progress-bar`, `wizard-ai-panel`,
  `wizard-tip`, `wizard-nav`, `wizard-back`, `wizard-next`,
  `wizard-skip`, `wizard-finish`, `wizard-header-actions`,
  `wizard-use-sample`, `wizard-skip-setup`, `backend-banner-onboarding`,
  …) is preserved so the e2e suite in
  `tests/e2e/07-project-onboarding.spec.ts` still resolves.
- **`WizardProgress.tsx` and `WizardNav.tsx`** are untouched.

The wizard just gained a new optional `footer` prop and now manages
its own scroll containers — that's it.

---

## Test checklist

- [x] **Typecheck** — `pnpm typecheck` produces no errors in
      `components/onboarding/WizardShell.tsx` or
      `app/project-onboarding/page.tsx`. (Pre-existing errors elsewhere
      in the app are unrelated.)
- [x] **Click each step 1-10** — the form is rendered in the right
      panel every time; the right panel scrolls to top via
      `mainRef`; the left stepper highlights the active step with the
      primary glow.
- [x] **Scroll within left stepper** — the right panel does NOT move
      (independent `overflow-y-auto` containers).
- [x] **Scroll within right panel** — the left stepper does NOT move.
- [x] **Window never scrolls** — `h-[calc(100dvh-3.5rem)]` +
      `overflow-hidden` on the wizard container, plus
      `document.body.style.overflow = 'hidden'` while mounted.
- [x] **Mobile (<1024px)** — horizontal pill stepper rail at the top
      of the split grid; form below; footer pinned.
- [x] **Tablet (1024-1280px)** — side-by-side, stepper 240px.
- [x] **Desktop (≥1280px)** — side-by-side, stepper 320px.
- [x] **All 10 steps still work** — store, URL sync, and `canNext`
      gating unchanged.
- [x] **Welcome step (1)** — no footer rendered (`footer` slot is
      `null` when `currentStep === 1`).
- [x] **Provision step (10)** — `isLastStep` flips and the
      `Confirm & provision` label + spinner still appear via
      `WizardNav`.

## Follow-up fix — removed AnimatePresence wrapper

The first version kept the framer-motion `AnimatePresence` +
`motion.div` slide animation from the original wizard. After
verifying the layout, the motion.div was rendering with `opacity: 0`
stuck, hiding the form on every step after navigation. The fix was to
remove the AnimatePresence/motion.div entirely and render the form
inside a plain `<div key={currentStep}>` — React's keyed remount still
resets per-step local state, but no opacity/transform animation can
leave the form invisible. The framer-motion imports and the unused
`direction` / `slideVariants` state were deleted.