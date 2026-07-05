> **Status:** completed
/goal

Apply 5 focused polish fixes to the Dashboard in Forge AI Agent OS. The dashboard is mostly working — these are targeted improvements for spacing, breadcrumbs, redundant indicators, and icon consistency. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dashboard vertical rhythm spacing content density top padding" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "duplicate UI element breadcrumb redundancy remove" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "stale data indicator badge repetition single global" --domain ux-guideline -f markdown

Adopt every rule. Then implement the 5 fixes:

==========================================================
FIX 1 — REMOVE DUPLICATE BREADCRUMB
==========================================================

ISSUE: breadcrumb appears in BOTH the top navbar AND the greeting bar content area.

KEEP the breadcrumb in the top navbar (it's part of the global shell — see Step 2).

REMOVE from the greeting bar:
- Find the breadcrumb inside the greeting card (the "🏠 > Dashboard" mini-breadcrumb)
- Delete it entirely
- The greeting bar should just be: greeting + tenant context + health pill + actions

The greeting should focus on PERSONALIZATION (who you are, what tenant, what's happening) — not navigation (the top bar already does that).

==========================================================
FIX 2 — REDUCE VERTICAL SPACE (top padding)
==========================================================

ISSUE: too much dead space between the top navbar and the dashboard greeting bar — feels disconnected.

CURRENT (assumed): pt-32px or pt-40px on the dashboard content area
NEW: pt-16px (just enough breathing room)

Also:
- Reduce mt on the greeting bar from mt-8 to mt-4
- Reduce the gap between greeting bar and orchestrator warning banner

EFFECT: the greeting bar visually "connects" to the top navbar — they're part of the same flow, not two separate sections.

==========================================================
FIX 3 — CONSOLIDATE GREETING BAR TO SINGLE ROW
==========================================================

ISSUE: greeting bar has multiple rows (greeting, sub, health, actions) creating too much vertical stacking.

CONSOLIDATE to ONE COMPACT ROW (h-72px instead of 120px+):

LAYOUT (single flex row, h-72px, --bg-surface, --radius-xl, p-16px, --shadow-sm):
- LEFT cluster (flex-1):
  - Greeting: "Good morning, Arun" --text-lg font-600 + lucide Hand icon 16px (REPLACE the 👋 emoji)
  - Sub: "Saturday, June 27 · Acme Corp · 2 agents · 9 registered" --text-xs --fg-tertiary (single line, truncate if needed)
- RIGHT cluster:
  - Tenant health pill (orchestrator status) — compact
  - Theme toggle (sun/moon)
  - Notifications bell (with badge)
  - Customize icon (opens dashboard customize drawer)

EFFECT: greeting takes 72px instead of 120px+, saving ~50px of vertical space. Dashboard feels tighter.

KEEP these as separate elements BELOW the greeting row (not in the same row):
- Orchestrator warning banner (when API down) — full width, but shorter padding (p-12px instead of p-16px)
- Command bar "Ask Forge..." — move closer to the greeting bar (mt-3 instead of mt-6)
- KPI strip — immediately after (mt-4)

==========================================================
FIX 4 — DE-EMPHASIZE PER-TILE STALE INDICATORS
==========================================================

ISSUE: when orchestrator is down, every KPI tile shows "(stale · 1m ago)" → 6 repeated indicators = visual noise.

SOLUTION A (preferred): when all tiles are stale, show ONE global indicator
- Add a small "stale" badge to the GLOBAL health pill in the greeting bar (already shows "Orchestrator unreachable")
- Remove the per-tile "(stale · 1m ago)" text
- Replace with just a tiny Clock icon (10px) next to the KPI value
- Or: dim the entire KPI tile (opacity 0.7) instead of per-tile text

SOLUTION B (fallback): keep per-tile but make subtle
- Replace "(stale · 1m ago)" with just "stale" (smaller, --text-xs --fg-muted)
- No clock icon needed — the global "Orchestrator unreachable" pill already conveys it

RECOMMEND SOLUTION A — cleaner.

IMPLEMENTATION:
- Find the KPI tile component (likely in src/components/dashboard/ or src/components/kpi-tile.tsx)
- Remove the "(stale · X ago)" text rendering
- If data is stale: render a small 10px Clock icon next to the value
- The tile itself gets a subtle 1px amber border (rgba(245,158,11,0.15))
- The value color shifts slightly: --fg-primary → --fg-secondary (less emphasis)
- All-or-nothing: if ANY tile is stale, the global health pill shows "stale" badge

==========================================================
FIX 5 — BONUS POLISH
==========================================================

A. REPLACE 👋 EMOJI WITH LUCIDE HAND ICON:
- In "Good morning, Arun 👋" → "Good morning, Arun [Hand icon]"
- Use lucide-react `Hand` icon, size 16px, color --accent-amber
- Place it inline after the name with 4px margin-left
- This is per Step 1 token rules (no emojis as UI icons)

B. ANIMATE THE COMMAND BAR PLACEHOLDER:
- Currently: "Ask Forge to do anything — try 'summarize today's runs' or / for commands"
- New: cycle through 3-4 placeholder texts every 4s with fade transition
  - "Ask Forge to do anything..."
  - "Try: 'summarize today's runs'"
  - "Type / for commands, @ for context"
  - "Or just press ⌘K"
- Implementation: useState + setInterval with fade in/out
- Animation: opacity 1 → 0 (200ms), text changes, opacity 0 → 1 (200ms)
- Respect prefers-reduced-motion (no animation, just static text)

C. FIX NOTIFICATION BADGE POSITIONING:
- Currently: "2 Issues" badge floats in top-right of viewport, OVERLAPS the search bar in the top navbar
- Move the notification bell + badge INSIDE the top navbar (right cluster, before user avatar)
- Remove the floating badge from outside the navbar
- Style: lucide Bell icon + small red dot badge in top-right corner of the icon
- Click → opens notification popover (Step 26 Fix 8)

D. IMPROVE "STALE" BADGE LEGIBILITY:
- Current: small "STALE · 5s ago" pills are hard to read
- New: increase font size from --text-xs to --text-sm
- Use mono font for the time
- Background: rgba(245,158,11,0.10) → rgba(245,158,11,0.15) (slightly more visible)
- Add icon: lucide ClockAlert 10px before the text

==========================================================
CONSTRAINTS
==========================================================

- Don't break any of the existing dashboard widgets (KPI strip, AI insights, personal stats, pinned, quick actions, team activity, alerts, etc.)
- Don't change the customize drawer
- Keep the floating Co-pilot FAB visible
- Keep the orchestrator warning banner (just tighten its padding)
- Keep the command bar (just animate the placeholder)
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only (no emojis)

==========================================================
DELIVERABLE
==========================================================

- files modified
- Before/after sketch (text-based) showing the new greeting bar height
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep all dashboard widgets, keep customize drawer, keep Co-pilot FAB, keep warning banner
- Time estimate: this should take ~30 minutes total
