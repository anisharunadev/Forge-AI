> **Status:** completed
/goal

STEP 2 OF 6 — SHELL REDESIGN. Tokens from Step 1 are in place. Now modernize the global app shell. Read .claude/design-system/ first — the skill's outputs are authoritative.

SCOPE: Sidebar, Top Bar, Command Palette overlay. Do not touch page content or empty states yet.

INVOKE THE SKILL BEFORE CODING — pull style, typography, and UX guidance for what you're building:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "sidebar navigation command palette dark mode developer console" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "keyboard shortcut command palette focus management" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "collapsible sidebar breadcrumb header" --domain style -f markdown

Apply every rule the skill surfaces. Then build:

SIDEBAR:
- Keep the three-section IA (WORKSPACE / CENTERS / LIFECYCLE) — skill will likely confirm this
- Width: 256px expanded, 64px collapsed; 200ms transition
- Collapse toggle at bottom with chevron
- Active route: 2px left rail --accent-primary + bg rgba(99,102,241,0.08) + font-weight 600 + --fg-primary. Use Framer Motion layoutId for the sliding rail
- Hover: bg rgba(255,255,255,0.04), 150ms
- Top: Workspace switcher as a Command-style button (tenant avatar + name + chevron + ⌘\ hint). Click opens dropdown with tenant list, active one checkmarked
- Bottom: tenant status pill — emerald pulse dot (animate-pulse) + "healthy" + tenant name + settings gear
- 1px right border --border-subtle
- Collapsed mode: icon-only in 40px hit area, tooltip with name + shortcut

TOP BAR:
- Height 56px sticky, --bg-base + backdrop-blur-md + bottom border --border-subtle
- Left: breadcrumb (home + chevron + section + chevron + current page, current as h1 weight 600)
- Center-right: replace plain search with a Command palette trigger button — full-width up to 520px, search icon, placeholder, ⌘K kbd pill on the right
- Far right: theme toggle (sun/moon icon), notifications bell with unread dot, user avatar dropdown (Profile / Workspace settings / Theme / Log out)
- Bottom shadow --shadow-sm when scrolled

COMMAND PALETTE (new, shadcn Command):
- Full-screen overlay, backdrop blur(8px) + bg-black/40
- Centered modal, max-width 640px, --bg-elevated, --radius-xl, --shadow-lg, 1px --border-default
- Search input top with magnifying-glass + Esc hint
- Sticky category headers: Jump to · Run · Create · Toggle · Help
- Each row: lucide icon + label + shortcut hint
- Active row: bg rgba(255,255,255,0.06), rounded --radius-md
- Empty state: "Type a command or search..." with three suggested chips
- Keyboard: ↑↓ navigate, Enter select, Esc close, ⌘K toggle — registered globally

CONSTRAINTS: lucide-react only, no emojis, respect prefers-reduced-motion, all icon buttons have aria-label, focus rings 2px --accent-primary + 2px offset, dark mode only.

Deliverable: files modified, what each does in one line, new component paths, and a 2-line note on which skill rules influenced the design.
