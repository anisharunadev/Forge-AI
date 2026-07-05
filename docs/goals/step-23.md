> **Status:** completed
/goal

Polish the Workflow editor in Forge AI Agent OS — built in Step 22 but the user reports: nodes too small, hard to edit, no breathing room, panels feel cramped. Read .claude/design-system/ first.

THE CORE PROBLEM (per user feedback): "very small, hard to edit the node, need more spaces." Everything is squeezed. The canvas is starving for pixels while wasted empty space sits around it. Panels are competing for room. Reading text in nodes requires squinting.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "visual editor node graph canvas breathing room whitespace padding" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "right side panel inspector properties editing comfortable layout" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "React Flow node sizing handles visibility connection points accessibility" --domain ux-guideline -f markdown

Adopt every rule. Then fix:

==========================================================
FIX 1 — MAKE NODES BIGGER AND READABLE
==========================================================

Current node width: 220px. Too narrow — text truncates everywhere. Bump to:

- DEFAULT NODE: 320px wide, min-height 100px
- Header section: p-16px (was p-12px implicit)
- Title: --text-base font-600 (was --text-sm) — readable from normal viewing distance
- Subtitle: --text-sm (was --text-xs)
- Body text (when showing config summary): --text-sm (was --text-xs)
- Type label (top corner): --text-xs uppercase tracking-widest with extra letter-spacing for readability
- Icon: 20px (was 16px)
- Handles: 14px circles (was 12px), with subtle outer ring (rgba(99,102,241,0.3), 2px) so they're findable. Add tiny "+" icon inside handle on hover. Connecting line 2.5px stroke (was 2px)

NODE CARD STRUCTURE — give each node proper internal spacing:
- Header strip: p-16px flex (icon + type label + 3-dot menu), border-b --border-subtle
- Body: p-16px flex-col gap-2 — title + subtitle + config summary
- Footer (optional, for status/timing): p-12px border-t --border-subtle bg rgba(255,255,255,0.02)
- Hover: subtle lift translate-y-[-2px] + --shadow-md
- Selected: 2px solid --accent-primary border + glow shadow (0 0 0 4px rgba(99,102,241,0.15)) + show inline edit affordances
- Multi-output handles (Condition, Switch): label each edge with its label ("True" / "False" / "Case 1") — small badge positioned on the edge midpoint, --bg-elevated --radius-sm --text-xs

NODE-SPECIFIC CONTENT CHANGES:
- **APPROVAL** node: show approver avatars (32px, max 4 visible + "+N") + role label below. The current "PR" with single avatar is too sparse
- **LLM PROMPT** node: show first 2 lines of the prompt in --text-sm, model badge (e.g., "claude-sonnet · t=0.2") below in --text-xs
- **COMMAND** node: show command slug in mono + duration estimate. Current "Run forge-prd-genera..." is truncated — full width should fit it
- **CONDITION** node: show the actual expression (`score >= 7`) prominently + label the two outputs "True" (emerald edge) / "False" (rose edge) with edge labels
- **END** node: show outcome ("Always" / "On success" / "On failure") more prominently

==========================================================
FIX 2 — REDESIGN THE PANEL LAYOUT (more canvas room)
==========================================================

Current layout: 280px left + canvas + 360px right = sidebars hogging the canvas. New layout:

OPTION A — COLLAPSIBLE RAIL (default):
- LEFT RAIL: 56px collapsed by default (icons only, vertical, --bg-base, border-r)
  - When collapsed: shows only section icons (Layers / LayoutTemplate / History) + count badges
  - Hover an icon → tooltip with section name + count
  - Click → rail expands to 320px (slides in 200ms)
  - When expanded, click outside or click active icon again to collapse
- RIGHT RAIL: 56px collapsed by default (icons only)
  - Icons: Settings / Inspector (when node selected) / Activity (when running) / Terminal (when log open)
  - Same expand-on-click behavior, expands to 440px (wider than before — inspector needs room)
- CANVAS: gets ~1488px on a 1600px viewport instead of ~960px. Big win

OPTION B — FLOATING PANELS (alternative, more canvas-first):
- Both panels become floating overlays anchored to their respective edges
- Drag handles on panel headers to detach and reposition
- Pin/unpin button to keep open or auto-hide
- This is heavier to build but gives maximum canvas

RECOMMEND OPTION A. Default collapsed, expand-on-demand, persistent across sessions per user preference (localStorage). Show subtle "click to expand" hint on first load (3s tooltip).

==========================================================
FIX 3 — TOP BAR WITH PROPER ROOM
==========================================================

Current top bar: 56px, items crammed. New design:

- Height: 64px (was 56px), --bg-elevated, border-b --border-subtle
- Layout: 3 zones with flex-1 spacers, items not crammed
- LEFT (gap-3):
  - Back arrow icon button (ArrowLeft, 36px hit area)
  - Vertical divider --border-subtle (24px tall)
  - Workflow name --text-md font-600 (max 280px, truncate with ellipsis, click to rename inline)
  - Version badge: "v3" mono --bg-inset --text-xs --fg-secondary, click to open version history popover
  - Save status: "Saved 4s ago" --text-xs --fg-tertiary with emerald dot. "Saving..." with cyan spinning dot. "Unsaved changes" with amber dot
- CENTER (flex-1, centered):
  - When idle: "Draft" muted pill with Pencil icon (click to edit name)
  - When running: animated execution status pill — Running dot + "Running · step 3 of 8" + horizontal progress bar (120px) + elapsed time mono
  - When paused: amber "Paused at approval gate"
  - When failed: rose "Failed at: API call node — click to view"
- RIGHT (gap-2):
  - "Variables" outline button (Braces icon + count "0 vars")
  - "Test run" outline button (FlaskConical icon)
  - "Run" primary button (Play icon, 36px tall). When running: morphs into "Stop" with Square icon in rose
  - Icon button 3-dot menu (MoreVertical)

==========================================================
FIX 4 — IMPROVE THE INSPECTOR (the editing experience)
==========================================================

When a node is selected, right panel slides in. Currently cramped at 360px. New design:

- Width: 440px when expanded
- Background: --bg-elevated, border-l --border-subtle, p-24px (was p-16px)
- HEADER (sticky top):
  - Back arrow + breadcrumb: "← Workflow settings / PM approval"
  - Type label: "APPROVAL" --text-xs uppercase tracking-widest with lucide ShieldCheck icon in --accent-rose
  - Title h2: "PM approval" --text-lg font-600 (editable inline — click to rename)
- BODY (sections, gap-24px between):

Section structure: each section is its own card — bg --bg-surface, --radius-lg, p-20px, border --border-subtle
- Section header: h3 --text-sm font-600 + optional badge + optional expand/collapse chevron
- Section body: gap-12px

Required sections per node type (PM approval example):
1. **Configuration** — Approvers field (Combobox showing "role:product-manager" as a chip with avatar + X to remove, "Add approver" button below). Timeout field (number input + "hours" suffix). Criteria field (full-width textarea, p-12px, --text-sm, min-h-80px, NOT a single-line input)
2. **Behavior** — On timeout radio group (Auto-approve / Auto-reject / Reassign / Wait forever), Notification toggles, Reminder schedule
3. **Test** — Large "Test this node" button (full-width, --accent-primary bg, h-40px) + "View source JSON" expand-collapse below

Every field:
- Floating label (NOT placeholder-only) — label sits above the input, --text-xs --fg-tertiary uppercase tracking-widest
- Helper text below input when not focused — --text-xs --fg-tertiary
- Error state: rose border + helper text in rose
- Required indicator: asterisk in --accent-rose after label
- Changes autosave with debounce 1500ms — show "Saving..." then "Saved Xs ago" inline at section bottom

INLINE EDITING ON CANVAS — also offer:
- Double-click node title → edits inline on the node itself (shadcn Input overlays the title text)
- Esc / Enter to commit
- This is faster than opening inspector for simple renames

==========================================================
FIX 5 — STATUS BAR AT BOTTOM (new)
==========================================================

40px height, --bg-elevated, border-t --border-subtle, flex between:
- LEFT: zoom level "100%" (mono, click to reset) + canvas position "x: 240 y: 180" (mono, --text-xs --fg-tertiary) + selected node indicator "PM approval selected" when applicable
- CENTER: node count "6 nodes · 7 edges" mono --text-xs --fg-tertiary
- RIGHT: validation status — "✓ Ready to run" (emerald) / "2 errors, 1 warning" (amber/rose) clickable to open validation panel

==========================================================
FIX 6 — MINIMAP + CONTROLS — VISIBLE AND STYLED
==========================================================

Currently not visible. Add:
- MiniMap: bottom-left of canvas, 200×120px, --bg-elevated bg, --radius-md, --shadow-md, 1px --border-default
  - nodeColor by category (Trigger emerald, Command cyan, Agent violet, Approval rose, etc.)
  - maskColor rgba(0,0,0,0.6)
  - pannable + zoomable
  - Click to navigate
- Controls (zoom in / out / fit / lock): bottom-right of canvas, vertical stack
  - Each button: 32×32, --bg-elevated, --text-fg-secondary, hover --bg-inset
  - Active (locked) state: rose dot indicator

==========================================================
FIX 7 — SHOW MULTIPLE PANELS SIMULTANEOUSLY (no more "replacing" right panel)
==========================================================

Currently: clicking a node REPLACES the workflow settings panel. Lose context.
Currently: opening execution log REPLACES the inspector. Lose edit context.

Fix: TABS at top of right panel, multiple panels stack-able
- Right panel header tabs: "Settings" | "Inspector" | "Log" — each tab shows its own panel BELOW the tabs
- Multiple tabs can be open: clicking tabs toggles them. Active tab is highlighted, inactive tabs collapsed to a thin strip showing just the tab name + chevron
- Or better: SPLIT right panel into two when both are needed
  - Top half (50%): Inspector
  - Bottom half (50%): Execution log (collapsible)
  - Draggable divider between them
- During RUN: log opens automatically, inspector stays accessible (user might want to watch + tweak config simultaneously)

==========================================================
FIX 8 — CANVAS GUIDANCE WHEN EMPTY (first-time users)
==========================================================

When canvas is empty (no nodes yet):
- Centered overlay card (NOT just text — an actual card): --bg-elevated, --radius-xl, --shadow-lg, p-32px, max-width 480px
- Icon: lucide MousePointerSquare 48px in --accent-primary, animate-bounce (subtle)
- h2 "Build your first workflow" --text-xl font-700
- Body "Drag a node from the left panel, or pick a template to get started." --text-sm --fg-secondary
- Three buttons: "Open templates" primary + "Add trigger" outline + "Watch 30s tour" ghost
- Below card: faint dashed border outline of a starter workflow with "Drop here" text at each drop zone

==========================================================
FIX 9 — LEFT PANEL POLISH
==========================================================

Currently the left panel tabs (Nodes / Templates / Runs) are tiny. Polish:
- Tab strip: bigger (44px tall instead of ~36px), --text-sm font-600, count badges --bg-inset --radius-full
- Active tab: bottom border 2px --accent-primary
- NODE PALETTE items:
  - Each item: p-12px (was implicit p-8px or none)
  - Icon: 18px (was 16px) in section color
  - Name: --text-sm font-500 (was --text-sm font-500 — fine)
  - Description: --text-xs --fg-tertiary (already there — make it clamp 2 lines max, currently might overflow)
  - Drag handle: lucide GripVertical 14px in --fg-muted, opacity 0 → 1 on hover
- Category accordion headers:
  - More click area: p-12px (full row clickable)
  - Chevron rotates 200ms
  - Count badge on right ("4")
  - Sticky when scrolling within section
- Search input: full-width, h-36px, --bg-inset bg

==========================================================
FIX 10 — EXECUTION LOG FIXES
==========================================================

Current log panel takes whole right side. New:
- Tab in right panel (collapsible)
- Width matches inspector
- Each log entry:
  - Timestamp --text-xs mono --fg-tertiary (12px wide column)
  - Status icon (10px dot) color-coded
  - Node name --text-sm font-500 (clickable → highlights that node on canvas)
  - Event description --text-sm --fg-secondary
  - Duration mono --text-xs --fg-tertiary (right-aligned)
- Hover entry: subtle bg highlight + "Jump to node" button appears
- Auto-scroll to bottom when new entries arrive; "Jump to latest" floating button when scrolled up
- Filter chips at top: All / Started / Completed / Failed / Skipped

==========================================================
FIX 11 — CONNECTION POINTS & EDGES
==========================================================

- Handles: bigger (16px), with subtle outer glow on hover
- When dragging a connection: ghost line follows cursor, color = valid (--accent-primary) or invalid (--accent-rose)
- Existing edges: animated dashed flow when executing (cyan dashed line flowing toward target node)
- Completed edges: solid emerald stroke
- Failed edges: solid rose stroke with X marker at midpoint
- Edge labels (for condition True/False): chip in the middle, --bg-elevated, --text-xs font-500

==========================================================
FIX 12 — IMPROVED EMPTY/ERROR/LOADING STATES
==========================================================

- Loading workflow: skeleton canvas with 3 placeholder nodes positioned realistically + skeleton sidebars
- Validation errors on Run: keep workflow in canvas but open a Dialog listing issues, each with "Jump to node" link that pans + zooms canvas to that node + flashes it amber
- Save failed: toast + small banner at top of canvas "Couldn't save — retrying in 5s" with manual retry button

==========================================================
CONSTRAINTS
==========================================================

- All measurements use Tailwind tokens; respect Step 1's spacing scale
- Canvas must remain performant at 50+ nodes — no regressions from the visual upgrades
- prefers-reduced-motion: disable handle pulse, edge flow animation, node lift hover
- Panel collapse state persists in localStorage
- All panels keyboard-accessible (Tab into them, Esc to collapse)
- Mobile: panels become bottom sheets (different breakpoint than canvas)
- Do not change the data model or component APIs from Step 22 — this is purely a layout/UX polish pass

Deliverable: list of files modified, before/after measurements for each fix, layout sketches, 1-paragraph rationale citing skill rules, plus a short "what we deliberately did NOT change" note explaining what would break if we touched the engine.
