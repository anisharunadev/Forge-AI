> **Status:** completed
/goal

Modernize the Forge Command Center page in Forge AI Agent OS (React + TS + Next.js + Tailwind + shadcn/ui + Framer Motion + lucide-react). Tokens, shell, and empty states from Steps 1–6 are already in place. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "command catalog CLI reference developer documentation dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "search filter category sidebar documentation pattern" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "developer tool command palette dark mode typography" --domain typography -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/workflows/page.tsx (find the exact path). Keep the route. Rebuild the page.

LAYOUT (3-column, desktop ≥1280px; collapse to stacked <1024px):

LEFT SIDEBAR (240px, sticky):
- Header: "CATEGORIES" --text-xs uppercase tracking-widest --fg-tertiary
- Category list — each row: small lucide icon (12px) + category name --text-sm font-500 + count badge (--bg-inset pill, --text-xs --fg-tertiary). Categories: Onboarding, Project Intelligence, Ideation, Architecture, Development, Testing, Security, Code Review, Deployment, Milestones
- Active category: bg rgba(99,102,241,0.10) + --accent-primary text + 2px left rail --accent-primary. Use Framer Motion layoutId for the rail
- Hover: bg rgba(255,255,255,0.04), 150ms
- Bottom: "Show deprecated" toggle (shadcn Switch)

CENTER (flex-1):
- Top: section eyebrow "FORGE COMMAND CENTER" --text-xs --fg-tertiary uppercase tracking-widest
- h1 "Run a forge-* command" --text-3xl font-700 --fg-primary with a small ⚡-style lucide icon (Zap) before it in --accent-primary
- Body "Browse, search, and execute the white-labeled forge-* command catalog. All commands are routed through the backend orchestrator." --text-sm --fg-secondary
- Search input row: full-width shadcn Input with Search icon left, "Search forge-* commands..." placeholder, right-side meta showing "⌘/" hint
- Right of search row: "History is captured per command. Recent runs surface here." --text-xs --fg-tertiary with a Clock icon
- GRID of command cards (3 cols ≥1440px, 2 cols ≥1024px, 1 col <1024px, gap-4, mt-6)

Command card:
- bg --bg-surface, --radius-lg, border --border-subtle, p-20px
- Hover: border --border-default + --shadow-md + translate-y-[-2px], 200ms --ease-out
- Top row: 40×40 square --bg-inset --radius-md with the command's lucide icon in --accent-primary 20px, then title --text-md font-600 --fg-primary + command slug in mono font --text-xs --fg-tertiary underneath
- Description: --text-sm --fg-secondary, clamp 2 lines, mt-3
- Bottom row (mt-4 flex between): left = chip group (category badge --bg-inset + duration badge e.g. "~600s" with Clock icon); right = "Run" button (shadcn Button default, --accent-primary) + "View history" text-link --text-xs --fg-tertiary on the left of the button row
- Click Run: button morphs into a progress state (animated gradient sweep + spinner icon) for ~600ms then success toast "Command queued — see Runs center for live output"

RIGHT SIDEBAR (320px, sticky, hidden <1280px):
- Header "RECENT RUNS" --text-xs uppercase tracking-widest --fg-tertiary
- List of last 5 runs (sample data): each row = status dot (emerald/cyan/amber/rose) + command name --text-sm font-500 --fg-primary + relative time --text-xs --fg-tertiary + duration
- Empty variant: muted "No runs yet" with a Play icon hint
- Footer link "View all runs →" --text-sm --accent-primary

EMPTY STATE (when no commands match search/category): use the Step 3 EmptyState component, illustration = lucide Terminal, primary action "Clear filters".

CONSTRAINTS: search is client-side filter only (instant, no debounce); category click scrolls to the corresponding card group AND filters the grid; keyboard ↑↓ navigates cards, Enter runs; prefers-reduced-motion respected; max-width 1600px container.

Deliverable: files modified, text sketch of layout, 1-paragraph rationale citing which skill rules shaped decisions.
