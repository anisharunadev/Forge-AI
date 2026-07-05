> **Status:** completed
/goal

Modernize the Connector Center page in Forge AI Agent OS. Tokens, shell, empty states, and Steps 7–9 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "marketplace card grid SaaS integration gallery install rating" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "filter search category sort marketplace grid" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "connector integration card install count rating" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/connectors/page.tsx. Keep route. Rebuild with tabs Connected / Marketplace / Health / Activity.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary uppercase tracking-widest
- h1 "Connector Center" --text-3xl font-700 with a Plug icon in --accent-primary
- Body "Manage integrations with external systems, browse the marketplace, and review connector health."
- Top-right: "Add Connector" primary button (shadcn Button default, + Plug icon)

TABS (segmented control, same pattern as Step 4):
- Connected (count badge) | Marketplace (count badge) | Health | Activity
- Active pill bg --bg-elevated + --shadow-sm + --fg-primary, Framer Motion layoutId slide

MARKETPLACE TAB (default):

FILTER BAR (below tabs):
- Left: search input "Search connectors..." with Search icon, w-320px
- Center: category chips (Source control, Project mgmt, Design, Comms, Cloud, Quality, Data) — multi-select pill toggles. Active = --bg-elevated with --accent-primary text. Inactive = --bg-inset with --fg-tertiary
- Right: sort dropdown (Popular / Newest / A–Z) + view toggle (Grid / List)

CONNECTOR CARD GRID (3 cols ≥1440px, 2 cols ≥1024px, 1 col <1024px, gap-4, mt-6):

Connector card:
- bg --bg-surface, --radius-lg, border --border-subtle, p-20px, hover lift --shadow-md + border --border-default, 200ms
- Top row: 40×40 square --bg-inset --radius-md with the connector's brand icon (lucide) in semantic color, then category eyebrow --text-xs --fg-tertiary uppercase tracking-widest, then connector name --text-md font-600 --fg-primary
- Below name: "by Forge Team" --text-xs --fg-tertiary
- Body: "Source control, pull requests, issues, Actions" --text-sm --fg-secondary, mt-3
- Bottom row: star rating (lucide Star in --accent-amber + count) + install count (lucide Users + formatted number) on the left; "Install" button on the right (shadcn Button default, + icon)
- Hover on Install: button expands label from "+ Install" to "+ Install GitHub" (200ms)
- Installed state: replace Install button with status badge (emerald dot + "Installed" --text-xs --accent-emerald) + "Manage" ghost button. Card border tints to rgba(16, 185, 129, 0.20)

CONNECTED TAB:
- Same grid. Each card shows last-synced-at --text-xs --fg-tertiary + "Sync now" icon button on hover + "Disconnect" ghost button in a 3-dot menu
- Top of tab: KPI strip (4 tiles) — Active connectors / Synced today / Failed syncs / Avg latency

HEALTH TAB:
- Table view (shadcn Table): Connector | Status dot (emerald/amber/rose) | Last check | Last error | Success rate (mini progress bar) | Actions
- Top: filter pills by status + "Re-run health check" primary button

ACTIVITY TAB:
- Timeline view: vertical timeline (custom, not a chart) with activity entries — each entry = timestamp + connector + event + actor avatar. Filter dropdown: All events / Installs / Syncs / Failures / Updates

EMPTY STATE (Marketplace when no search results): use Step 3 EmptyState, illustration = SearchX, title "No connectors match", primary "Clear filters"

CONSTRAINTS: all icons from lucide-react (no external brand icon set for now — use generic lucide that matches the category); search/filter is client-side instant; card animations respect prefers-reduced-motion; max-width 1600px container; empty states from Step 3 component used everywhere applicable.

Deliverable: files modified, layout sketch, 1-paragraph rationale citing skill rules.
