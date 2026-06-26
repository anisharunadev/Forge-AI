/goal

Modernize the Stories page in Forge AI Agent OS. Tokens, shell, empty/error states, and Steps 7–20 are done. Read .claude/design-system/ first.

CURRENT STATE: Stories tab in sidebar; currently shown as a sub-section inside the Projects page with horizontal tabs (Stories In Dev / Stories In QA / Stories In DevOps). The user wants a dedicated Stories center with kanban — backlog / sprint / done — and story detail drawer.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "kanban board backlog sprint done story card" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "user story management estimate assignee label priority" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro_max/scripts/search.py "drag and drop kanban keyboard accessibility story" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "story detail drawer acceptance criteria subtask comments" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/stories/page.tsx. Keep route. Rebuild as a full kanban center.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Stories" --text-3xl font-700 with lucide ListTodo icon in --accent-primary
- Body "Every user story across this project. Drag cards across columns to update status."
- Top-right cluster:
  - Sprint picker Combobox (current sprint + "Backlog" + future sprints) with date range
  - View toggle segmented control — Kanban (default) / List / Timeline
  - "New story" primary button (Plus icon, opens Dialog)

KPI STRIP (5 tiles, 120px tall, gap-4, mb-8):
- Total in sprint (indigo, count + sparkline)
- Backlog (muted, count + "across N projects")
- In progress (cyan, count + delta)
- In review/QA (amber, count + delta)
- Done this sprint (emerald, count + delta + velocity bar showing % of sprint goal)
- Each tile uses Step 1 tokens

FILTER BAR (below KPIs, --bg-surface, --radius-lg, p-16px, gap-3, mb-6):
- Search input "Search stories..."
- Filter pills: Assignee (Avatars) | Priority (P0 rose / P1 amber / P2 cyan / P3 muted) | Label (chips: bug, feature, chore, docs) | Estimate (XS / S / M / L / XL)
- Active filter count badge + "Clear filters" link

KANBAN BOARD (4 columns, equal width, gap-4, flex-1):
1. Backlog (gray dot, muted)
2. To Do (cyan dot)
3. In Progress (indigo dot, pulse)
4. In Review (amber dot)
5. Done (emerald dot)

OPTIONAL 5th COLUMN: Blocked (rose dot) — toggle in view settings, off by default

COLUMN STRUCTURE (each):
- Sticky header (bg --bg-base with backdrop-blur, border-b --border-subtle):
  - Status dot + column name --text-sm font-600 --fg-primary
  - WIP limit (if set, shown as "3 / 5" mono, --text-xs --fg-tertiary; rose if exceeded)
  - Total story points (mono, --text-xs --fg-tertiary)
  - "+ Add" icon button on right (creates story in this column)
  - Collapse column toggle (chevron right, collapses column to 64px width with just dot + count)
- Body: vertical card stack, gap-3, overflow-y-auto with thin scrollbar
- Empty body: dashed border 1px --border-subtle, --radius-md, centered "Drop stories here" --text-xs --fg-muted, py-8
- Quick-add input at bottom of each column (collapsible) — type title + Enter to add

STORY CARD (bg --bg-surface, --radius-md, border --border-subtle, p-12px, hover lift + drag handle visible):
- Top row: story id (mono, --text-xs --fg-tertiary, "S-123") + priority badge (left colored dot) + 3-dot menu (Edit / Duplicate / Delete)
- Title --text-sm font-500 --fg-primary, clamp 3 lines
- Label chips row (max 3 visible, "+N" if more): bug (rose), feature (indigo), chore (muted), docs (cyan), etc — colored pills --radius-sm --text-xs
- Bottom row: assignee avatar (24px, with online dot) + story points badge (mono, --bg-inset, --text-xs --fg-secondary) + comment count (MessageSquare icon + number) + attachment count (Paperclip icon + number, only if >0) + age (Clock icon, --text-xs --fg-tertiary)
- Subtask progress: tiny progress bar at very bottom (only if subtasks exist) — "3/7 subtasks" with bar
- Drag handle (lucide GripVertical) appears on hover, left edge, --fg-muted
- DRAG STATE: scale 1.02, rotate 1deg, --shadow-lg, opacity 95%
- BLOCKED CARD: rose border tint rgba(244,63,94,0.30), small "Blocked" badge top-right
- DONE CARD: opacity 0.65, title with strikethrough, completed timestamp replaces age

DRAG-AND-DROP (use @dnd-kit from Step 5):
- Sensors: PointerSensor + KeyboardSensor (required for accessibility)
- Drop zone highlight: column body bg rgba(99,102,241,0.08) when card dragged over
- Drop animation: card slides into position 250ms
- Optimistic update: state changes immediately, API call is mocked (console.log)
- Keyboard: Space pickup, Arrow keys move, Space drop, Esc cancel. Announce column changes to screen readers via aria-live

LIST VIEW (toggle):
- Virtualized table (reuse Step 14's virtualized pattern): ID · Title · Status · Priority · Assignee · Estimate · Labels · Updated · Actions
- Bulk select with floating action bar (Assign / Move / Delete)

TIMELINE VIEW (toggle):
- Horizontal swimlanes per assignee (or per epic if filtered)
- Days on X axis, stories as cards positioned by start date
- Today indicator (vertical cyan line)

STORY DETAIL DRAWER (right slide-in 720px, opens on card click):
- Header: story id + priority badge + status badge + close X
- Title h2 (editable inline, --text-xl font-700) + below: created-by avatar + created-at + "Last updated Xm ago by Arun"

TABS IN DRAWER:

DETAIL TAB:
- Description (markdown rendered, click-to-edit, autosave)
- Acceptance criteria (checklist — add/remove items, check to mark done, % complete shown)
- Subtasks (nested list, drag to reorder, check to complete)
- Definition of Done checklist (locked system items: code reviewed, tests pass, docs updated)
- Linked items: epic chip (clickable to /projects?epic=X), related stories, ADRs, PRs, runs

ACTIVITY TAB:
- Timeline of events: created / status changed / assigned / commented / linked / edited
- Comment thread: user avatars + markdown comments + "Add comment" input at bottom
- @mention support in comments (use Combobox to pick teammate)

ATTACHMENTS TAB:
- File list (drag-drop upload zone) + preview thumbnails
- Mock for now

ANALYTICS TAB:
- Time in each status (mini bar chart)
- Cycle time + lead time
- Sprint burndown contribution

DRAWER FOOTER (sticky bottom):
- Left: status dropdown (move to column)
- Middle: assignee Combobox + due date picker + label manager
- Right: "Save changes" (auto-saved already, show "Saved Xs ago" indicator) + "Open in full page" link

NEW STORY DIALOG (from "+ New story" button):
- Title (required), Description (markdown), Epic (Combobox), Priority (RadioGroup), Estimate (RadioGroup: XS=1 / S=2 / M=3 / L=5 / XL=8), Labels (Combobox multi), Assignee (Combobox), Sprint (Combobox)
- "Create" primary + "Create and add another" outline

EMPTY STATE (no stories yet): use Step 3 EmptyState, illustration = ListTodo, title "No stories in this project", description "Stories are the unit of work. Break your epics down into user stories the team can pick up.", primary "Create first story", secondary "How to write good stories"

EMPTY STATE (filtered to zero): compact Step 3 variant, title "No stories match", primary "Clear filters"

ERROR STATE: use error-state.tsx from Step 13

LOADING: skeleton kanban with 3 placeholder cards per column

CONSTRAINTS: drag-and-drop MUST be keyboard accessible (@dnd-kit KeyboardSensor); status colors paired with icons; estimate always visible; WIP limits enforced with rose highlight when exceeded + soft block (warning toast, not hard prevent); all data shapes stable across views (kanban / list / timeline share the same Story type); prefers-reduced-motion respected (no drag rotation/scale, instant transitions); max-width 1800px container.

Deliverable: files modified, full Story type interface, all view layouts sketched in text, 1-paragraph rationale citing skill rules.