> **Status:** completed
/goal

Modernize the Organization Knowledge (Artifacts) page in Forge AI Agent OS — currently has empty state with Standards/Templates/Policies/Activity tabs. User wants to add organization-wise + project-scoped artifacts, knowledge best practices, templates (PRDs/ADRs/bugs), and many curated features. This should feel like a knowledge management hub: Confluence + Notion + Obsidian for engineering artifacts. Read .claude/design-system/ first.

USER INTENT: a unified home for everything the org needs to know — standards, templates, policies, runbooks, best practices. Org-wide shared knowledge AND project-scoped artifacts. Plus curated "wow" features like AI suggestions, adoption metrics, compliance dashboard, and Obsidian-style backlinks.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "knowledge base wiki documentation hub templates standards" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Obsidian backlink cross-reference knowledge graph navigation" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "template library starter snippets best practices" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "version control document diff history approval workflow" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "compliance dashboard adoption metrics governance overview" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/organization-knowledge/page.tsx (find exact path). Keep route. Total rebuild.

==========================================================
ZONE 1 — HEADER + SCOPE SWITCHER
==========================================================

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Organization Knowledge" --text-3xl font-700 with lucide BookMarked icon in --accent-violet
- Body "Org-level standards (F-001), templates (F-002), and policies (F-003). These artifacts are shared across all projects in this tenant."
- Top-right: SCOPE SWITCHER (Command-style):
  - Default: "Org-wide" with avatar (the tenant) + chevron + ⌘⇧S hint
  - Click → opens Combobox: list of all projects + "Org-wide (all projects)"
  - Selecting a project filters the entire page to project-scoped artifacts
  - Active scope shown in pill next to title: "Scope: Forge Platform · 47 artifacts" or "Scope: Org-wide · 124 artifacts"
- Top-right also: "+ New" primary button (Plus icon) — opens new artifact modal with type picker (Standard / Template / Policy / Runbook / Best practice)

==========================================================
ZONE 2 — TABS (expanded to 7)
==========================================================

TAB BAR (segmented control with horizontal scroll on overflow):
1. **Overview** (NEW — default) — knowledge hub dashboard
2. **Standards** (F-001) — org rules + project policies
3. **Templates** (F-002) — PRD, ADR, bug, runbook templates
4. **Policies** (F-003) — governance policies
5. **Runbooks** (NEW F-004) — operational procedures
6. **Best Practices** (NEW F-005) — curated learning
7. **Activity** — change log + adoption metrics
8. **Graph** (NEW) — Obsidian-style connection view

Count badges on each. Hover shows breakdown by scope (org / project).

==========================================================
ZONE 3 — OVERVIEW TAB (new default)
==========================================================

The unified hub. Bento layout.

KPI STRIP (5 tiles, 120px tall, gap-4, mb-6):
1. Total artifacts (indigo, BookMarked icon) — count + delta this week
2. Recently published (emerald, Sparkles icon) — last 7 days count
3. Adoption rate (cyan, Users icon) — % of projects using at least one template
4. Avg approval time (amber, Clock icon) — hours for a draft → published
5. Compliance score (violet, ShieldCheck icon) — % of projects in compliance

ROW 1 (3 tiles, 320px tall, gap-4, mb-4):

TILE A (flex-2): "RECENT ACTIVITY" — what's been happening
- Header: h3 "Recent activity" + "All activity →"
- Timeline of last 10 events: avatar + actor + action verb (created/updated/approved/archived) + artifact reference + relative time
- Click → opens that artifact
- Color-coded by action type

TILE B (flex-1): "QUICK ACCESS" — most-used artifacts
- Header: h3 "Quick access" + "Manage →"
- Top 5 most-viewed artifacts this week: each row = icon + title + view count + "Open"
- Click → opens

TILE C (flex-1): "RECOMMENDED FOR YOU" — AI-curated
- Header: h3 "Recommended" + Sparkles icon
- 3 personalized suggestions based on role + recent activity:
  - "Engineering Lead at Forge Platform — you might want to review: 'API versioning policy' (last updated 47d ago)"
  - "Hot topic: 5 projects using 'PRD template v2' — check if yours needs migration"
- Each: bg --bg-elevated, --radius-md, p-12px, hover lift
- Click → opens

ROW 2 (2 tiles, 280px tall, gap-4, mb-4):

TILE D (flex-1): "COMPLIANCE OVERVIEW"
- Header: h3 "Compliance by project" + "Details →"
- Table: Project | Standards applied | Policies in effect | Compliance % (progress bar with color: emerald ≥90, amber 70-89, rose <70) | Last audit
- Sortable columns
- 5 projects shown + "View all N projects →"

TILE E (flex-1): "TEMPLATE USAGE"
- Header: h3 "Most-used templates" + "All templates →"
- Recharts horizontal BarChart: top 8 templates by usage count
- Each bar: template name + count + colored by template type
- Hover: tooltip with full stats + which projects use it

ROW 3 (full width, 240px tall, mb-6):

TILE F: "KNOWLEDGE GAPS" — AI-identified missing artifacts
- Header: h3 "Knowledge gaps" + lucide Sparkles + "Detected by AI"
- List of 3-5 gaps: "No ADR exists for 'Database migration strategy'" / "Bug report template not used in 3 projects" / "Runbook for 'Payment service outage' is missing"
- Each: bg --bg-elevated with --accent-rose left border + title + "Create now" button
- AI analyzes codebase + recent runs to identify gaps

==========================================================
ZONE 4 — STANDARDS TAB (F-001)
==========================================================

ENHANCED LIST + EDITOR PATTERN (master-detail):
- LEFT (320px): list of standards
  - Search input + filter pills: Scope (Org / Project) | Status (Draft / Published / Deprecated) | Tag | Owner
  - Each row: standard id (mono "F-001-N") + title --text-sm font-500 + scope badge + owner avatar + last edited + status dot (Draft amber / Published emerald / Deprecated muted / In Review violet)
  - Active row highlight
  - "+ New standard" button at bottom (dashed border, --bg-elevated)

- RIGHT (flex-1): editor panel
  - HEADER: standard id badge + title (editable inline) + status badge + 3-dot menu (Duplicate / Archive / Export JSON / Move to project)
  - TABS: Content | Versions | Usage | Discussions | AI Suggestions
  - Content tab: rich markdown editor (reuse Step 12's markdown editor component)
    - Toolbar: B / I / H / link / list / code / quote / image / table
    - Right: "Insert template variable" dropdown ({{project_name}}, {{owner_email}}, etc.)
    - Footer: word count + last saved indicator + "Save draft" + "Publish" buttons
  - Versions tab: timeline of all versions with diff viewer (line-by-line green/red additions/deletions)
  - Usage tab: which projects reference this standard + how often + compliance status
  - Discussions tab: comment thread (markdown)
  - AI Suggestions tab: lucide Sparkles panel with AI recommendations to improve this standard

==========================================================
ZONE 5 — TEMPLATES TAB (F-002)
==========================================================

GRID OF TEMPLATE CARDS (3 cols ≥1440px, 2 cols ≥1024px, 1 col <1024px):

Each card: bg --bg-surface, --radius-lg, p-20px, hover lift
- Top: lucide icon in semantic color + template type badge (PRD / ADR / Bug / Runbook / RFC / Spec)
- Title --text-md font-600 + "by Forge Team" or author
- Description --text-sm --fg-secondary, 2 lines
- Variable count badge ("12 variables" mono)
- Usage stats: "Used 47 times this month" with sparkline
- Bottom row: "Use template" primary button + 3-dot menu
- Hover: shows preview thumbnail of the rendered template

TEMPLATE LIBRARY (default 6 templates + ability to add more):
- PRD template v3 (indigo) — "Product requirements with auto-PRD AI assist"
- ADR template (violet) — "Architecture decision record with context/decisions/consequences"
- Bug report template (rose) — "Structured bug with repro steps + expected vs actual"
- Runbook template (emerald) — "Operational procedures with escalation paths"
- RFC template (amber) — "Request for comments — proposal format"
- Spec template (cyan) — "Technical specification with API + data model"

CATEGORY FILTERS at top: All | PRD | ADR | Bug | Runbook | RFC | Spec | Custom

==========================================================
ZONE 6 — POLICIES TAB (F-003)
==========================================================

LIST + DETAIL pattern (similar to Standards but enforcement-focused):

EACH POLICY ROW:
- Policy id + title + scope (Org-wide / Project / Resource type)
- Enforcement level (Strict / Advisory / Off) with badge color
- Acknowledgment required: toggle
- Affected resources count
- Violations count (last 30d) — if >0, rose badge
- Owner avatar

POLICY DETAIL (right panel):
- Same structure as Standards editor PLUS:
- ENFORCEMENT SETTINGS card:
  - Scope: Org-wide / Specific projects / Specific resource types
  - Enforcement: Strict (blocks violations) / Advisory (warns) / Off
  - Acknowledgment required: toggle + which users must acknowledge
  - Auto-remediation: optional action to take on violation
- VIOLATIONS card:
  - Last 30 days violations list: resource + violation type + actor + timestamp + "View audit"
  - Chart: violations over time (sparkline)
  - If 0 violations: emerald "No violations in last 30d ✓"

==========================================================
ZONE 7 — RUNBOOKS TAB (F-004 — new)
==========================================================

RUNBOOK-SPECIFIC FEATURES:
- Each runbook = step-by-step operational procedure
- Visual: vertical timeline of steps (numbered)
- Each step: title + description + code snippet + command + expected output + "Run this step" button (executes via terminal)
- Steps can be conditional (if/else branches)
- Runbooks are executable — can be triggered from incidents

RUNBOOK CARD:
- Title + icon + steps count + last execution result + success rate
- Status: Draft / Tested / Production / Outdated
- "Test run" button (dry run, logs the steps without executing)
- "Run for real" button (executes in production)

==========================================================
ZONE 8 — BEST PRACTICES TAB (F-005 — new)
==========================================================

LEARNING-FOCUSED LAYOUT:
- Featured practices (large cards, 2-col): curated, with hero image + summary
- All practices (grid, 3-col): compact cards
- Categories: Code quality / Testing / Security / Performance / Collaboration / Documentation
- Each practice: title + summary + author + reading time + "Read" CTA
- Progress tracker: "You've read 12 of 47 practices (26%)" with progress bar at top
- "Mark as read" toggle per practice
- "Recommended next" based on what you've read

==========================================================
ZONE 9 — ACTIVITY TAB
==========================================================

Two sub-tabs: Change log | Adoption metrics

CHANGE LOG:
- Virtualized timeline of all artifact changes (created/updated/approved/archived/published)
- Filter by: actor, action type, artifact type, date range
- Each row: timestamp + actor avatar + action verb + artifact reference + diff summary (+X / -Y lines)
- Click → opens artifact diff

ADOPTION METRICS:
- Recharts grid:
  - Most viewed this week (bar chart)
  - Most edited this month (bar chart)
  - Adoption funnel (area chart): published → used → acknowledged
  - Compliance score over time (line chart)
  - Top contributors (leaderboard: avatar + name + contribution count)
- Date range picker at top

==========================================================
ZONE 10 — GRAPH TAB (Obsidian-style for artifacts)
==========================================================

KNOWLEDGE GRAPH OF ARTIFACTS ONLY:
- Force-directed graph showing all standards + templates + policies + runbooks + best practices
- Node color by type
- Edges: "references", "supersedes", "depends on", "related to"
- Click → opens artifact
- Reuse Step 27's knowledge graph component, scoped to F-001 to F-005 only
- Toggle to include project-scoped artifacts too

==========================================================
ZONE 11 — NEW ARTIFACT MODAL
==========================================================

When "+ New" clicked (from header):
- Dialog, --bg-elevated, max-width 640px
- Step 1: TYPE picker — 5 large cards:
  - Standard (F-001, indigo BookMarked)
  - Template (F-002, cyan FileText)
  - Policy (F-003, violet Shield)
  - Runbook (F-004, emerald Play)
  - Best practice (F-005, amber BookOpen)
- Step 2: TEMPLATE picker — for templates, show starter templates to clone
- Step 3: FORM — title, description, scope, tags, owner
- "Create draft" + "Create and start editing" buttons

==========================================================
ZONE 12 — OBSIDIAN-STYLE BACKLINKS (every artifact)
==========================================================

EVERY ARTIFACT EDITOR includes a "Backlinks" sidebar:
- Shows: "Referenced by (N)" — list of other artifacts that link to this one
- Shows: "References (N)" — list of artifacts this one links to
- Click any backlink → navigates to that artifact
- Hover → shows preview
- Visual graph mini-preview (3-7 nodes) showing local connections

==========================================================
ZONE 13 — SMART FEATURES (the wow)
==========================================================

A. AI TEMPLATE SUGGESTIONS:
- When user starts typing a new PRD/ADR, AI suggests structure + sections
- Auto-complete from existing standards (if you're writing a PRD, suggest pulling in "API versioning policy" as a reference)

B. SMART TEMPLATE VARIABLES:
- Insert {{variables}} with autocomplete from org-defined set
- Each variable is a typed token: string / number / date / user / reference
- Live preview of rendered template

C. DRIFT DETECTION:
- AI monitors for "drift" — projects using outdated versions of standards
- Surfaces in Overview → "3 projects using outdated 'Auth policy v2' — please migrate"
- Click → opens affected projects list

D. ADOPTION INCENTIVES:
- "🏆 Your team adopted 8/10 standards this quarter — 80% adoption rate"
- "🥇 Top contributor: Priya (24 contributions this month)"
- Light gamification to encourage usage

E. ONBOARDING NEW PROJECTS:
- When creating a new project: wizard suggests which standards to apply
- Auto-applies the recommended set as project-scoped policies
- "Project is now compliant with 12/15 org standards (3 recommended)"

==========================================================
ZONE 14 — KEYBOARD SHORTCUTS
==========================================================

- ⌘N: New artifact
- ⌘⇧S: Switch scope (org vs project)
- ⌘K: Search (semantic — finds by meaning, not just keyword)
- ⌘⇧F: Toggle favorites filter
- /: focus search
- ⌘/: show shortcuts

==========================================================
CONSTRAINTS
==========================================================

- Keep Standards/Templates/Policies editor from Step 12 (markdown editor) — don't rebuild
- All artifact types share a common editor shell — only type-specific configs differ
- Versioning: every save creates a version; UI shows version timeline + diff
- Search is SEMANTIC (uses embeddings) — finds by meaning, not just exact words
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only
- The Overview tab should load in <500ms — use static data, defer charts

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/knowledge/
- Sample data for 6 templates, 5 standards, 4 policies, 3 runbooks, 5 best practices
- All 8 tabs functional
- Obsidian-style backlinks working across all artifact types
- AI suggestions component stub (shows mock data, ready for real AI)
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep Step 12's markdown editor, keep F-001/F-002/F-003 numbering convention, don't break existing artifacts data model
