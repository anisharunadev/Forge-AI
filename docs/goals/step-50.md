> **Status:** completed
/goal

Replace default browser scrollbars with themed, premium scrollbars across the entire Forge AI app. Current scrollbars are OS defaults — too thick, wrong color, no rounded corners. Should look intentional and match the dark theme. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "scrollbar webkit firefox custom thin dark theme styling" --domain style -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — GLOBAL SCROLLBAR STYLES
==========================================================

Add to src/styles/globals.css (or wherever global styles live):

```css
/* ========================================
   SCROLLBAR STYLES — WebKit (Chrome, Safari, Edge)
   ======================================== */

/* Main scrollbar — vertical */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

/* Track (the rail) */
::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 5px;
}

/* Thumb (the draggable part) */
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
  transition: background 150ms ease;
}

/* Thumb hover */
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.16);
  background-clip: padding-box;
}

/* Thumb active (dragging) */
::-webkit-scrollbar-thumb:active {
  background: rgba(99, 102, 241, 0.5);  /* accent-primary with alpha */
  background-clip: padding-box;
}

/* Corner where vertical and horizontal scrollbars meet */
::-webkit-scrollbar-corner {
  background: transparent;
}

/* ========================================
   SCROLLBAR STYLES — Firefox
   ======================================== */

* {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
}

*:hover {
  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
}

/* ========================================
   CUSTOM UTILITY CLASSES (for specific cases)
   ======================================== */

/* For panes that should have a visible-but-subtle scrollbar */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* For hidden scrollbars (still scrollable via wheel/touch) */
.scrollbar-hidden {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.scrollbar-hidden::-webkit-scrollbar {
  display: none;
}

/* For accent-colored scrollbars (used in chat-like UIs) */
.scrollbar-accent {
  scrollbar-color: rgba(99, 102, 241, 0.3) transparent;
}

.scrollbar-accent::-webkit-scrollbar-thumb {
  background: rgba(99, 102, 241, 0.3);
}

.scrollbar-accent::-webkit-scrollbar-thumb:hover {
  background: rgba(99, 102, 241, 0.5);
}

========================================================== FIX 2 — APPLY APPROPRIATELY PER CONTAINER
Different containers have different needs. Apply the right class:

Default (most panels): inherits the global styles
Chat panels / conversation areas: scrollbar-thin (extra subtle, doesn't compete with content)
Modal content: scrollbar-thin
Tabs strip (horizontal scroll): scrollbar-thin (smaller thumb)
Tables (horizontal scroll): scrollbar-thin
Live activity feeds: default (more visible thumb for active use)
Add these classes to the relevant container components.

========================================================== FIX 3 — SPECIFIC FIXES (the user's screenshots)
Looking at the Governance Center screenshots, these specific elements need the styling:

1.
Live Guardrail Activity (vertical scroll) — default styles
2.
Top Violations (vertical scroll) — default styles
3.
Compliance Scorecard (vertical scroll for the standards list) — scrollbar-thin
4.
LLM Usage Breakdown (legend list) — scrollbar-thin
5.
Policy Coverage (vertical scroll) — scrollbar-thin
6.
Recent Policy Changes (horizontal scroll) — scrollbar-thin
7.
Tab strip (horizontal scroll) — scrollbar-thin
8.
All card content with overflow — default
========================================================== FIX 4 — CONSISTENT BEHAVIOR
ENSURE:

Scrollbars are ALWAYS visible when content overflows (NOT auto-hide)
Show on hover OR always show (consistent across the app)
RECOMMENDATION: always show but very subtle (rgba 0.08)
On hover: become more visible (rgba 0.16)
On active drag: become accent-colored (rgba 0.5)
The "always show but subtle" approach matches Linear, Vercel, Stripe
========================================================== FIX 5 — ACCESSIBILITY
Ensure scrollbars meet WCAG 2.1 SC 1.4.12 (text spacing on hover)
Color contrast: thumb (rgba 0.16 on dark bg) passes AA for non-text
Keyboard navigation works (Tab to scrollable area, arrow keys scroll)
prefers-reduced-motion: scrollbar transition removed
css

Copy
@media (prefers-reduced-motion: reduce) {

  ::-webkit-scrollbar-thumb {

    transition: none;

  }
}
========================================================== FIX 6 — SPECIAL CASES
For specific UIs that benefit from custom scrollbar variants:

A. CHAT PANELS (Co-pilot, run logs):

scrollbar-thin with cyan tint:
css

Copy
.scrollbar-chat {

  scrollbar-color: rgba(34, 211, 238, 0.2) transparent;

}

.scrollbar-chat::-webkit-scrollbar-thumb {

  background: rgba(34, 211, 238, 0.2);

}

.scrollbar-chat::-webkit-scrollbar-thumb:hover {

  background: rgba(34, 211, 238, 0.4);

}

B. TERMINAL OUTPUT:

Use monospace font + classic terminal look
scrollbar-thin with muted color
Track: --bg-base (slightly darker)
Thumb: --bg-elevated
C. KNOWLEDGE GRAPH CANVAS:

Disable scrollbar styling (custom pan/zoom instead)
Or very subtle scrollbar-hidden
========================================================== CONSTRAINTS
Don't break keyboard navigation (Tab, arrow keys, Page Up/Down, Home/End)
Don't change scroll behavior (only appearance)
Respect prefers-reduced-motion
All animations on scrollbar transitions should be 150ms or less
Test on Chrome, Safari, Edge, Firefox (different scrollbar APIs)
========================================================== DELIVERABLE
files modified (globals.css + targeted components)
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep keyboard nav, keep scroll behavior, keep touch gestures
Test: open Governance Center → verify all scrollbars look themed
Test: hover scrollbars → verify they brighten
Test: active drag → verify accent color
Test: Firefox → verify thin scrollbars work
Test: keyboard scroll → verify no regression
