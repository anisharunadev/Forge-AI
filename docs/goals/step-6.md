/goal

STEP 6 OF 6 — POLISH & AUDIT. All five previous steps are in. Final pass.

INVOKE THE SKILL — the audit IS the skill:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "motion microinteraction accessibility dark mode" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data visualization chart tooltip empty loading" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "WCAG focus management keyboard navigation reduced motion" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "pre-delivery UI audit anti-patterns checklist" --domain ux-guideline -f markdown

Apply every rule from all four outputs. Then:

MOTION PASS — only these motions, no inventions:
1. Route transitions: fade 150ms + translate-y 4→0, ease-out
2. Interactive card hover: scale 1.005 + --shadow-md + border --border-default, 200ms --ease-out. Non-interactive cards do not animate
3. Button press: active:scale-[0.97], 50ms
4. Tab indicator: Framer Motion layoutId pill, 200ms
5. Loading: skeleton with shimmer gradient sweep 1.4s linear infinite. No spinners
6. Toasts: slide up bottom-right + auto-dismiss progress bar 4s. shadcn Sonner
7. AI "thinking" / streaming: pulsing cyan dot + animated gradient text (bg-clip-text + animate-gradient)
8. Modal/Dialog: scale 0.96→1 + fade 200ms; backdrop fade 150ms
9. Command palette: same modal treatment
10. All gated by prefers-reduced-motion (0ms / removed)

DATA VIZ PASS:
- Standardize on Recharts, wrap in src/components/charts/. No Chart.js, no Victory
- All chart colors from CSS vars (var(--accent-*))
- Every chart: title, Tooltip with formatted values, legend if multi-series, empty-state placeholder (NOT a blank chart), loading skeleton
- Sparklines: 60px tall, no axis, no tooltip. Inline next to any number metric
- Bar palette limited to indigo/cyan/emerald/amber/rose
- Line/area: gradient fill (12% top → 0% bottom)
- Pie/donut: only when parts-of-whole is meaningful, max 5 slices — otherwise bar

ACCESSIBILITY PASS:
- @axe-core/react in dev only; fix every Critical and Serious
- Every icon-only button: aria-label
- Every form input: associated <label>, not just placeholder
- Every modal: focus trap, Esc closes, returns focus to trigger
- Every interactive element: visible focus ring 2px --accent-primary + 2px offset
- Contrast: text on bg-base ≥ 4.5:1, large ≥ 3:1, fg-secondary on bg-surface verified
- One h1 per page, h2 sections, no skipped levels
- Skip-to-content link at top of body, visible on focus
- Toast region: role="status" aria-live="polite"
- Kanban drag MUST be keyboard-operable (Space pickup, arrows move, Space drop, Esc cancel) — @dnd-kit KeyboardSensor
- Command palette announces result count to screen readers

PRE-DELIVERY AUDIT — run and fix every failure:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "common UI anti-patterns accessibility dark mode" --domain ux-guideline

Verify each:
  [ ] No bg-black anywhere — all backgrounds use --bg-* tokens
  [ ] Max 2 font families in bundle (Inter + JetBrains Mono)
  [ ] Every empty state has illustration + title + description + primary CTA
  [ ] Every metric has visual indicator (sparkline / dot / delta)
  [ ] Color never the only signal (icon + text paired)
  [ ] Dark mode layered: base/surface/elevated/inset visually distinct
  [ ] All pages work at 1280 / 1440 / 1920px without horizontal scroll
  [ ] Sidebar collapses cleanly both directions
  [ ] All animations respect prefers-reduced-motion
  [ ] No console errors or warnings on any route
  [ ] Lighthouse Accessibility ≥ 95 on Agent Center and Ideation Center
  [ ] Lighthouse Performance ≥ 90 on the same two pages

DELIVERABLE: CHANGELOG.md entry, audit output, Lighthouse before/after, one-paragraph design rationale in plain language for the rest of the team.