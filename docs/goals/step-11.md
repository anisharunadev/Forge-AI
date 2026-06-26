/goal

Modernize the Architecture Center page in Forge AI Agent OS. Tokens, shell, empty states, and Steps 7–10 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "documentation tabs ADR architecture decision records dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "tab navigation documentation viewer markdown table" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "table list filter search empty state documentation" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/architecture/page.tsx. Keep route. Keep tabs ADRs / API Contracts / Task Breakdowns / Risk Registers / Traceability / Versions. Rebuild content for each.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Architecture Center" --text-3xl font-700 with a Network icon in --accent-primary
- Body "ADRs, API contracts, task breakdowns, risk registers, and full traceability from requirement to test."
- Top-right area: conditional warning badge (if conflicts exist) — bg rgba(244, 63, 94, 0.10), border rgba(244, 63, 94, 0.30), --radius-md, px-12px py-6px, lucide AlertTriangle icon + "Demo: 3 intentional conflicts" --text-xs --accent-rose + "Resolve" ghost button; AND primary "New ADR" button (+ icon)

TABS (segmented control pattern):
- ADRs (count) | API Contracts (count) | Task Breakdowns (count) | Risk Registers (count) | Traceability | Versions
- Active state: bg --bg-elevated --shadow-sm + --fg-primary

EACH TAB CONTENT (default to ADRs since it's the most populated):

ADR TAB — Master-detail layout (left list 360px, right detail flex-1):

LEFT (sticky list):
- Header: search input "Search ADRs..." w-full
- Filter pills: Status (All / Draft / Accepted / Deprecated / Superseded), Component (Backend / Frontend / Infra / Data)
- ADR list rows: each = ADR number (mono, --text-xs --fg-tertiary, "ADR-001") + title --text-sm font-500 --fg-primary + status badge (Draft amber / Accepted emerald / Deprecated muted / Superseded violet) + last edited --text-xs --fg-tertiary. Active row: bg rgba(99,102,241,0.10) + 2px left rail --accent-primary. Hover bg rgba(255,255,255,0.04)

RIGHT (detail panel, --bg-surface, --radius-lg, p-32px, sticky top-56px):
- Top: ADR number + status badge + title --text-2xl font-700 + meta row (Author avatar + name + last edited + component badge)
- Divider
- Sections stacked with h3 --text-md font-600 + body --text-sm --fg-secondary: Context · Decision · Consequences · Alternatives considered
- "Linked items" chip row at bottom: ADR-N (cross-references), API contracts, tasks. Each chip clickable, scrolls to relevant tab+row
- Action bar sticky bottom: "Edit ADR" outline button + "Supersede" outline + "Mark accepted" primary (status-dependent)

EMPTY STATE: use Step 3 EmptyState, illustration = FileText, title "No ADRs yet", description "ADRs are produced by the architecture pipeline. Create one to get started.", primary "Create ADR", secondary "Read the ADR template"

API CONTRACTS TAB: same master-detail. Left = service list with method counters, Right = OpenAPI viewer (use a syntax-highlighted code block — shadcn has CodeBlock; or a third-party like @shikijs/transformers). Add "Run in sandbox" button top-right

TASK BREAKDOWS TAB: master-detail. Left = work breakdown items, Right = task tree with assignee avatars, dependency arrows, status dots. Use a simple custom tree (no extra library)

RISK REGISTERS TAB: kanban-like 3 columns (Open / Mitigating / Closed), each card = risk title + severity badge (Low/Med/High/Critical, color-coded) + owner avatar + linked ADR. Drag-and-drop using @dnd-kit (already added in Step 5)

TRACEABILITY TAB: visual graph view (use a simple SVG-rendered dependency graph OR a flat matrix view if SVG graph is overkill — pick matrix by default with a "Graph view" toggle). Each cell color = coverage strength

VERSIONS TAB: timeline view (vertical) — each version = card with version number, release date, changelog (collapsible), "Promote" button

CONSTRAINTS: master-detail layout collapses to single-column list <1024px; row click in left navigates detail; URL updates with selected ADR id so links work; breadcrumb above tabs reflects selected ADR ("Architecture / ADRs / ADR-001"); empty states from Step 3 everywhere; prefers-reduced-motion respected.

Deliverable: files modified, package additions if any, layout sketch, 1-paragraph rationale citing skill rules.