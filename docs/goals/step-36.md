> **Status:** completed
/goal

Polish the Forge Terminal in Forge AI Agent OS — terminal area is too small because TIPS + KEYBOARD + AUDIT LOG panels eat the canvas. User wants the same collapsible-rail pattern as the Workflows editor (shown in the second screenshot). Make the terminal the hero, side panels become collapsible tools. Read .claude/design-system/ first.

USER INTENT (clear from comparing the two screenshots):
- Workflows editor (second screenshot): clean canvas-first design, minimap in corner, collapsible right rail, full width for the actual work surface
- Terminal (first screenshot): TIPS + KEYBOARD + AUDIT LOG all visible at once, terminal squeezed into ~40% of the viewport
- Goal: same pattern as workflows — terminal is the hero, side panels are tools that appear when needed

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "terminal canvas full-width collapsible side rail tool palette" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "developer IDE workbench minimal chrome breathing room terminal" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "help overlay keyboard shortcuts command palette discoverability" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — REMOVE THE ALWAYS-VISIBLE TIPS + KEYBOARD PANELS
==========================================================

The TIPS card and KEYBOARD card take ~300px of horizontal space and contain static info that doesn't need to be visible at all times.

REPLACE with:
- Help icon (lucide HelpCircle) in the TERMINAL TOOLBAR (top-right of terminal pane)
- Click → opens Help overlay (Dialog):
  - TABS: TIPS | KEYBOARD | ABOUT
  - TIPS tab: the 2-3 tips currently shown, formatted better with icons
  - KEYBOARD tab: the full shortcut list (all 10+ shortcuts from Step 32 Zone 10), searchable, copyable, organized by category
  - ABOUT tab: sidecar status, version, "How to start the sidecar" + "View logs" + "Open documentation"
- Help overlay: ⌘+? to open globally
- First-time visit: subtle "?" tooltip on the help icon for 3s

==========================================================
FIX 2 — COLLAPSE AUDIT LOG INTO A RIGHT RAIL (like workflows)
==========================================================

Currently audit log is a 320px panel always visible on the right. Follow the workflow editor pattern:

RIGHT RAIL (collapsed by default, 56px wide):
- When collapsed: shows only the section icon (lucide ScrollText) + "AUDIT" label rotated 90° + badge count
- Hover icon: tooltip "Audit log · N commands" + ⌘ shortcut
- Click → expands to 360px panel (slides in 200ms)
- When expanded: full audit log content + close X
- Persists state in localStorage (user preference)
- Mobile: full-screen overlay

INSIDE THE EXPANDED RAIL:
- Header: "Audit log" + count + pause/resume stream + clear + export
- Filter chips: All / Started / Completed / Failed / Today
- List (virtualized, last 50): timestamp + command mono --text-xs + status dot + duration
- Click row → scrolls terminal to that line + flashes the line briefly (cyan border pulse, 1s)
- Empty: "No commands yet. Run a command from the Command Center."

==========================================================
FIX 3 — REPLACE LEFT-SIDE PANELS WITH COLLAPSIBLE LEFT RAIL
==========================================================

Currently left side has nothing useful (just TIPS + KEYBOARD). After Fix 1, left side is empty.

ADD a left rail (same pattern as the right rail):
- Collapsed by default (56px wide, icons only)
- Sections (top to bottom):
  - **Sessions** (lucide Terminal icon) — list of active sessions
  - **Context** (lucide Layers icon) — context items attached to current session
  - **Skills** (lucide Sparkles icon) — available forge-* skills
  - **Commands** (lucide Command icon) — recent / favorite forge-* commands
  - **Layout** (lucide LayoutGrid icon) — layout switcher (Single / Split H / Split V / Grid)
- Each: icon + count badge + tooltip on hover
- Click icon → expands to 320px panel

EXPANDED PANELS (when clicked):
- **Sessions panel**: list of active sessions with name, status dot, last activity
  - "+ New session" button at bottom
  - Drag to reorder
  - Right-click: Rename / Duplicate / Close
- **Context panel**: context items currently injected (from Step 32)
  - Each: icon + name + X to remove
  - "+ Add context" button → opens context picker
- **Skills panel**: collapsible list of forge-* skills
  - Click skill → inserts into terminal as slash command
- **Commands panel**: recent forge-* commands with quick-run buttons

DEFAULT COLLAPSED = terminal gets the full canvas width.

==========================================================
FIX 4 — TERMINAL CANVAS (the hero)
==========================================================

With rails collapsed, terminal gets ~1700px on a 1920px viewport (vs current ~700px). The terminal should feel like the work surface, not a cramped box.

ENHANCEMENTS:
- SESSION TABS (top, h-44px, --bg-base, border-b --border-subtle):
  - Active tab: --bg-elevated, bottom border 2px --accent-cyan
  - "+ New session" button at end
  - Drag to reorder (existing)
- LAYOUT TOOLBAR (h-44px, --bg-base, border-b --border-subtle, flex between):
  - LEFT: Layout switcher (Single / Split H / Split V / Grid 2×2) — segmented control
  - CENTER: Connection status pill (Disconnected rose / Connecting amber pulse / Connected emerald + latency ms)
  - RIGHT cluster:
    - Search icon (Ctrl+Shift+F)
    - Help icon (Fix 1)
    - Settings icon (terminal theme, font size, etc.)
    - More icon (clear scrollback / export log / share session)
- TERMINAL PANE: large, fills available space, xterm.js with custom theme

==========================================================
FIX 5 — STATUS BAR (bottom, refined)
==========================================================

Keep the 32px status bar. Make it more informative:

- LEFT cluster: connection status + latency + reconnect attempt counter
- CENTER: session id (mono) + agent name + workspace name
- RIGHT cluster: cursor position + encoding (UTF-8) + ⌘+? for help
- Add: "context: N items" indicator when context is injected
- Add: small sparkline showing recent activity (commands/min)

==========================================================
FIX 6 — LEFT RAIL DEFAULT-COLLAPSED ON FIRST VISIT
==========================================================

- First visit: both rails collapsed, terminal gets max space
- Show subtle 3s tooltips on rail icons: "Sessions (⌘1)" / "Context (⌘2)" etc.
- After 5 visits: stop showing tooltips
- User can pin/unpin via right-click on rail icons

==========================================================
FIX 7 — KEYBOARD SHORTCUTS FOR RAILS
==========================================================

- ⌘1: Toggle Sessions rail
- ⌘2: Toggle Context rail
- ⌘3: Toggle Skills rail
- ⌘4: Toggle Commands rail
- ⌘5: Toggle Audit log rail
- ⌘0: Collapse all rails (terminal-only mode)
- ⌘⇧0: Expand all rails

==========================================================
FIX 8 — FOCUS MODE (the wow)
==========================================================

Add a "Focus mode" toggle in the toolbar:
- Click → hides everything except the terminal pane + session tabs + minimal status bar
- Like VS Code's Zen mode
- Press Esc to exit
- A subtle hint "Press Esc to exit focus" appears in bottom-right for 2s then fades
- Useful for distraction-free work

==========================================================
FIX 9 — EMPTY STATES
==========================================================

- No sessions: centered card in terminal area "Create your first session" with primary button + "How to start the sidecar" expandable
- No audit log: empty state in audit rail (muted text)
- No context: empty state in context rail

==========================================================
CONSTRAINTS
==========================================================

- Keep all existing functionality (xterm.js, sidecar, sessions, multi-CLI support from Step 32)
- Don't break keyboard shortcuts from Step 32
- Don't break Context injection from Step 32
- Don't break Forge Command Palette (Ctrl+Shift+P) from Step 32
- All animations respect prefers-reduced-motion
- State persistence in localStorage (which rails are open)
- Mobile: rails become drawers (slide from edge)
- Keep the existing connection warning inline banner (already good)
- Keep the existing bottom status bar (just enhance)

==========================================================
DELIVERABLE
==========================================================

- files modified
- Before/after screenshot mockup (text-based) showing the new layout
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep xterm.js, keep sidecar architecture, keep existing session/agent functionality
