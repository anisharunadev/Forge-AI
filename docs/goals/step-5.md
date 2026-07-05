> **Status:** completed
/goal

STEP 5 OF 6 — IDEATION CENTER REDESIGN. Foundation, shell, empty states, and Agent Center are done. Now rebuild Ideation Center. Read .claude/design-system/ first.

INVOKE THE SKILL FIRST — kanban and drag-drop are mature patterns:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "kanban board productivity column card" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "drag and drop keyboard accessibility WCAG" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "timeline roadmap swimlane gantt" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: Ideation Center route. Keep route. Keep tabs (Ideas / Roadmap / PRDs / Architecture Previews / My Approvals). Rebuild Ideas tab as kanban with view toggles. Enhance the other tabs.

IDEAS TAB — DEFAULT: KANBAN BOARD

5 columns (equal width, gap-4, horizontal scroll on overflow):
  1. Captured (gray dot)
  2. Scoring (cyan dot, pulse)
  3. Approved (emerald dot)
  4. In PRD (violet dot)
  5. Archived (muted dot)

Each column:
- Sticky header: status dot + name --text-sm font-600 --fg-primary + count badge (--bg-inset pill) + "+ New" icon button
- Body: vertical stack, gap-3, overflow-y-auto with thin scrollbar
- Empty body: centered "Drop ideas here" --text-xs --fg-muted, dashed 1px --border-subtle, --radius-md, py-8

Idea card:
- bg --bg-surface, --radius-md, border --border-subtle, p-14px
- Hover: border --border-default, translate-y-[-1px], --shadow-md, 200ms
- Title --text-sm font-500 --fg-primary, clamp 2 lines
- Chip row: score badge (color by score: 0–3 muted, 4–6 amber, 7–8 emerald, 9–10 violet; show "8.2" + tiny bar), owner avatar 24px, due date muted, comment count (MessageSquare + number)
- 3-dot menu (Move / Edit / Delete)
- GripVertical drag handle on hover, --fg-muted
- Dragging: scale 1.02, rotate 1deg, --shadow-lg, opacity 90%
- Drop zone highlight: column bg rgba(99,102,241,0.06)

VIEW TOGGLE (top-right next to "New Idea"):
- Segmented control: Kanban (default) / List / Timeline
- Kanban = board, List = sortable compact table, Timeline = horizontal swimlanes by week with cards positioned by due date
- All views share the same data shape and EmptyState from Step 3

NEW IDEA FLOW:
- Click "New Idea" or column "+ New" → shadcn Dialog centered, --bg-elevated, --radius-xl, max-w-560px
- Form: Title (required), Description (textarea auto-grow), Category select, Submit
- On submit: optimistic add, toast bottom-right "Idea captured — AI will score it shortly" with 4s progress bar (shadcn Sonner), card animates in fade+slide

ROADMAP TAB: timeline grouped by quarter, cards drag horizontally to change quarter, click opens details modal.

PRDS TAB: list rows = PRD title + linked idea + status dot + author + "Open PRD" button. "Generate first PRD" stays primary, opens modal to pick an approved idea.

ARCHITECTURE PREVIEWS TAB: grid of preview cards — diagram thumbnail (placeholder if none), title, status, "Open" button.

MY APPROVALS TAB: inbox list — idea title + submitter + submitted-at + Approve / Reject / Open buttons. Empty state from Step 3.

CONSTRAINTS: @dnd-kit/core + @dnd-kit/sortable (NOT react-dnd, NOT react-beautiful-dnd). Drag MUST be keyboard-operable via KeyboardSensor (Space pickup, arrows move, Space drop, Esc cancel). Optimistic updates only, persist is a console.log stub. Step 1 tokens only. prefers-reduced-motion respected.

Deliverable: files modified, @dnd-kit/* package additions, 3-sentence description of each view, 1-line note per skill rule that shaped the design.
