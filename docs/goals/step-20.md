/goal

Modernize the Projects page (Project Intelligence) in Forge AI Agent OS. Tokens, shell, empty/error states, and Steps 7–19 are done. Read .claude/design-system/ first.

CURRENT STATE (bad): four stacked sections (Epics / Requirement briefs / Draft PRDs / Active stories by stage) all showing empty states with no visual hierarchy. The page feels like four dead ends stacked. The user's brief: "same kind of boring, needs to be modernized." This is the PM-facing intelligence browser — it should feel like a control tower, not a graveyard.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "project management dashboard intelligence bento multi-section" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "project switcher context header artifact browser hierarchy" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "timeline gantt milestone progress tracking project" --domain chart -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/projects/page.tsx. Keep route. Rebuild.

PROJECT CONTEXT BAR (sticky top of content area, --bg-base with backdrop-blur, border-b --border-subtle, h-72px, flex between):
- Left: project selector — Command-style button (current project avatar + name + chevron + ⌘P hint). Shows tenant + project name + region. Click opens Combobox with all tenant projects, active one checkmarked
- Middle: breadcrumbs — "Acme Corp / Forge Platform / Project Intelligence" --text-sm --fg-secondary with chevrons
- Right cluster:
  - "Last sync: 2m ago" --text-xs --fg-tertiary with Refresh icon
  - "Health" pill — emerald/amber/rose dot + status
  - "Export view" ghost button (Download icon)
  - "New epic" primary button (Plus icon, opens Dialog)

HERO BAND (animated gradient border, mt-8, mb-8):
- Eyebrow "CENTER · AUDIT VIEW" --text-xs --fg-tertiary uppercase tracking-widest
- h1 "Project Intelligence" --text-3xl font-700 with lucide Layers icon in --accent-primary
- Body "PM-facing typed-artifact browser for every Epic, every Story, every active run, every open question. Engineering Lead viewing tenant acme-corp (Acme Corp (Dev Demo))." --text-sm --fg-secondary
- Top-right: view toggle segmented control — "All" / "Mine" / "At risk" / "Recent"

KPI STRIP (4 tiles, 140px tall, gap-4, mb-8):
- Total Epics (indigo, Layers icon) — count + delta + sparkline
- Open Stories (cyan, ListTodo icon) — count + delta + sparkline
- Stories In Dev (amber, Code icon) — count + "across N agents" + sparkline
- Avg Velocity (emerald, Gauge icon) — points/sprint + delta vs last sprint + sparkline

MAIN GRID — 2-COLUMN BENTO (gap-4, on desktop ≥1280px; single column <1024px):

LEFT COLUMN (flex-1, vertical stack of sections):

SECTION 1: EPICS (mb-6)
- Header: h3 "Epics" --text-md font-600 + sort dropdown (by status / by progress / by updated) + "View all" link
- If empty: Step 3 EmptyState compact, illustration = Layers, title "No epics in this project", description "Epics are produced by the architecture pipeline from approved PRDs.", primary "Create epic", secondary "View architecture center"
- If populated: vertical list of epic cards. Each card = bg --bg-surface, --radius-lg, border --border-subtle, p-20px, hover lift --shadow-md, 200ms
  - Top row: lucide Layers icon (16px in --accent-primary) + epic id (mono, --text-xs --fg-tertiary, "E-001") + title --text-sm font-600 + status badge (On track emerald / At risk amber / Blocked rose / Done muted)
  - Below title: description --text-sm --fg-secondary, clamp 2 lines
  - Progress: progress bar (--bg-inset track, --accent-primary fill, --radius-full, h-4px) + label "12 / 20 stories" --text-xs --fg-tertiary
  - Bottom row: assignee avatars (overlap, max 3 visible + "+N more") + last activity --text-xs --fg-tertiary
  - Click: opens epic detail drawer (right slide-in 720px)

SECTION 2: REQUIREMENT BRIEFS
- Header: h3 "Requirement briefs" + "schema v1.0" version badge (mono --bg-inset --radius-sm) + sort + "View all"
- Empty: Step 3 compact, illustration = BookOpen, title "No requirement briefs yet", description "Briefs capture the why behind each epic. They're generated when an epic is approved.", primary "Approve first epic"
- Populated: list of brief cards (similar to epics but compact): brief id "B-001" + title + linked epic chip + author + "Read" / "Edit" actions

SECTION 3: DRAFT PRDS
- Header: h3 "Draft PRDs" + "lint-passed" status badge (emerald dot) + sort + "View all"
- Empty: Step 3 compact, illustration = FileText, title "No draft PRDs yet", description "Drafts are produced by the architecture pipeline.", primary "Generate first PRD", secondary "How PRDs work"
- Populated: list of PRD cards: PRD id "PRD-001" + title + linked brief chip + lint status + author + "Open" button

SECTION 4: ACTIVE STORIES BY STAGE
- Header: h3 "Active stories by stage" --text-md font-600 + "N total in flight" count badge + segmented tabs (Stories In Dev / Stories In QA / Stories In DevOps)
- Each tab shows a sub-section of up to 8 stories for that stage
- Use the Step 21 story card component (will be built next step) for visual consistency
- Each row: lucide icon (status) + story id + title --text-sm font-500 + assignee avatar + estimate (story points badge) + age --text-xs --fg-tertiary
- Click: opens story detail drawer (reused in Step 21)
- Footer: "Open Stories center →" link

RIGHT COLUMN (380px sticky on desktop, hidden on mobile — replace with collapsible):

RIGHT TILE A: PROJECT VELOCITY (Recharts BarChart)
- Header: h3 "Velocity · last 6 sprints" --text-sm font-600
- Stacked bar: completed (emerald) + carryover (amber) per sprint. X = sprint number. Hover: tooltip with points + stories count

RIGHT TILE B: BURNDOWN (Recharts LineChart)
- Header: h3 "Current sprint burndown" --text-sm font-600
- Two lines: ideal (muted dashed) + actual (indigo). Days on X, points on Y. Hover: tooltip with delta

RIGHT TILE C: TEAM LOAD (horizontal stacked bar)
- Header: h3 "Team load this sprint" --text-sm font-600
- Per-member horizontal bars showing allocated vs capacity. Color codes: under allocated (emerald) / at capacity (amber) / over allocated (rose)

RIGHT TILE D: RECENT ACTIVITY (compact timeline)
- Header: h3 "Recent activity" --text-sm font-600 + "View audit log →"
- Last 6 events: timestamp + actor avatar + action verb + target. Click → navigates to /audit with filter applied

LOADING STATE: each section shows skeleton matching its layout (3 placeholder epic cards, 3 placeholder brief cards, etc.)

EMPTY PROJECT STATE (entire project has nothing):
- Center the Step 3 full EmptyState in the main area, illustration = Sparkles, title "This project is fresh", description "Start by approving an idea, drafting a PRD, or creating your first epic. Each artifact unlocks the next step.", primary "Capture first idea", secondary "How projects work"

ERROR STATE: use error-state.tsx from Step 13. Detect: 404 → "Project not found" + "Back to projects list"; 403 → "You don't have access to this project" + "Request access"; network → retry pattern from Step 18

CONSTRAINTS: all sections share the same card padding/typography; KPI numbers mono font; status colors paired with icons (color NEVER alone); client-side filtering instant; URL params preserve selected project + filters; max-width 1600px; responsive: right column becomes drawer on <1024px.

Deliverable: files modified, layout sketch in text, full section component map, 1-paragraph rationale citing skill rules.