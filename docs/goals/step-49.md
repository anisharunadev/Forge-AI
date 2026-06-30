/goal

Fix the Onboarding wizard layout bug — when clicking any step in the left stepper (steps 2-10), the page scrolls to the bottom instead of keeping the form content visible. The form should be visible alongside the stepper at all times. Read .claude/design-system/ first.

USER ISSUE (from screenshot): Step 2 (Tenant setup) is highlighted in the left stepper but the actual form content is rendered at the BOTTOM of the page. The middle of the page is empty. Clicking any step triggers scroll-to-bottom. The form should be in the main content area, visible alongside the stepper.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "split layout sidebar main content visible side by side" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "wizard stepper scroll into view anchor focus management" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "scroll behavior page vs container nested scrolling overflow" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — RESTRUCTURE LAYOUT (the root cause)
==========================================================

Current (broken) layout:
- Page has scroll
- Stepper is in a sticky/fixed position
- Form content renders below the visible area
- Clicking a step triggers `scrollIntoView` on the form, which scrolls the WHOLE PAGE

NEW (fixed) layout:
- Page: NO scroll (overflow hidden, h-screen)
- Main area: split into 2 panels with `grid-template-columns: 320px 1fr`
  - LEFT (320px): stepper (vertical), scrollable independently
  - RIGHT (1fr, flex-1): form content, scrollable independently
- Form content is ALWAYS in the visible right panel
- Clicking a step changes the form content in the right panel (no page scroll)

IMPLEMENTATION:

```jsx
<div className="h-screen flex flex-col overflow-hidden">
  {/* Top bar (fixed, no scroll) */}
  <header className="h-16 border-b flex-shrink-0">
    {/* breadcrumb + tenant + health pill */}
  </header>

  {/* Main split layout */}
  <div className="flex-1 grid grid-cols-[320px_1fr] overflow-hidden">
    {/* Left: stepper (scrollable) */}
    <aside className="border-r overflow-y-auto p-6">
      <Stepper />
    </aside>

    {/* Right: form content (scrollable, independent) */}
    <main className="overflow-y-auto p-8">
      <StepContent />
    </main>
  </div>

  {/* Bottom bar (fixed, no scroll) */}
  <footer className="h-16 border-t flex-shrink-0">
    {/* Back / Skip / Next buttons */}
  </footer>
</div>

========================================================== FIX 2 — STEPPER (left panel)
The left stepper is the navigation. It should:

Show all 10 steps
Active step: highlighted with --accent-primary, glow
Done steps: emerald check
Pending steps: muted
Click any step: change the form content in the right panel (NO page scroll)
Skip link per skippable step
Show step description (1 line) below title
jsx

Copy
<button onClick={() => goToStep(step.id)}>

  <div className="step-number">{step.number}</div>

  <div>

    <div className="step-title">{step.title}</div>

    <div className="step-description">{step.description}</div>

  </div>

  {step.skippable && <span>SKIP</span>}

</button>
When user clicks a step:

Update currentStep state
Smooth scroll the RIGHT panel to top: mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
DO NOT scroll the window
========================================================== FIX 3 — FORM CONTENT (right panel)
The right panel renders the current step's form. It should:

Be self-contained (not depend on scroll position)
Have its own internal scroll (overflow-y-auto)
Header inside the panel: step number + title + description (the "What is happening" can stay as a sub-section)
Body: the form fields
Sticky save/next button at the bottom of the right panel (NOT the page)
For long forms (multiple sections), use internal sub-headers + sections within the panel.

========================================================== FIX 4 — PREVENT WINDOW SCROLL
Make sure no element triggers window scroll:

No window.scrollTo calls
No scrollIntoView on body/window
All scrolling is contained within the panels
HTML/body: overflow: hidden when wizard is mounted
Modal Dialog (if using shadcn Dialog): automatically handles this
========================================================== FIX 5 — RESPONSIVE BEHAVIOR
On mobile (<1024px):

Stack vertically: stepper on top, form on bottom
Both scrollable independently
Stepper becomes a horizontal scrollable pill list
Or: stepper collapses to a compact "Step X of 10" indicator at top
On tablet (1024-1280px):

Side-by-side but narrower stepper (240px)
Form area gets more space
========================================================== FIX 6 — STICKY FOOTER
Bottom footer with Back/Skip/Next buttons should be:

Fixed at bottom of viewport (h-64px)
Inside the wizard container, not page-fixed
Always visible (not requiring scroll)
========================================================== CONSTRAINTS
Don't change the step content (just the layout)
All 10 steps still work as before
Wizard state persists (resume from localStorage)
Welcome step still works
All animations respect prefers-reduced-motion
Dark mode only
Lucide icons only
========================================================== DELIVERABLE
files modified
Before/after sketch (text-based) showing the new layout
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the 10 steps, keep the form content, keep the step state management
Test: click each step 1-10, confirm form is visible (not scrolled to bottom)
Test: scroll within stepper (left), form (right) should NOT move
Test: scroll within form (right), stepper (left) should NOT move