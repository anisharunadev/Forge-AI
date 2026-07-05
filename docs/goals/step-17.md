> **Status:** completed
/goal

Modernize the Audit page in Forge AI Agent OS. Tokens, shell, empty states, error states, and Steps 7–16 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "audit log timeline virtualized table filter" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "tamper evident hash chain audit record viewer" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "virtualized scroll large list filter date range performance" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/audit/page.tsx. Keep route. Rebuild.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Audit Center" --text-3xl font-700 with lucide ShieldCheck icon in --accent-primary
- Body "Append-only, tamper-evident audit trail. Click any record for the full payload and hash chain link."
- Top-right: "Export" primary button (Download icon) — exports current filter to CSV/JSON. Disabled when zero records

INTEGRITY BADGE (full width strip below hero, --bg-surface, --radius-lg, p-12px flex):
- Left: shield icon in --accent-emerald
- Title "Chain integrity: verified" --text-sm font-500 + body "Last hash anchor 2m ago · 1,248 records · root hash 0x7a3f..." --text-xs --fg-secondary mono
- Right: "Verify now" ghost button (triggers re-hash verification)

FILTER BAR (full width, --bg-surface, --radius-lg, p-16px, gap-3):
- Field 1: Actor — Combobox (search users by name/email, shows avatar + role)
- Field 2: Action — Combobox (multi-select: create / update / delete / approve / reject / login / export / invoke)
- Field 3: Target type — Combobox (multi-select: agent / project / run / policy / user / connector)
- Field 4: From — DatePicker (with quick presets: Last hour / Today / Last 7d / Last 30d / Custom)
- Field 5: To — DatePicker
- Below fields: "Reset filters" ghost button (left), "Apply" primary button (right) — for accessibility the filters apply on change but these buttons are explicit affordances
- Active filter count badge appears next to "Reset filters" when N > 0

TABLE HEADER ROW:
- Left: "AUDIT TIMELINE (VIRTUALIZED)" --text-xs --fg-tertiary uppercase + count "(N OF M)"
- Right: density toggle (Compact / Comfortable), column visibility menu (eye icon)

TIMELINE TABLE (virtualized — @tanstack/react-virtual):
- Columns: Timestamp · Actor · Action verb · Target · IP · Hash (truncated mono, copy on hover) · chevron (expand)
- Row hover: bg rgba(255,255,255,0.04)
- Active row: bg rgba(99,102,241,0.10)
- Action verbs color-coded: create=emerald, update=cyan, delete=rose, approve=emerald, reject=amber, login=indigo, export=violet, invoke=cyan
- Click row: opens detail drawer (right slide-in 640px) — same pattern as Step 14's drawer

DETAIL DRAWER:
- Header: action verb (color-coded) + target name + close X
- Body sections stacked:
  - Summary card: actor avatar + name + role + IP + user agent + timestamp (absolute + relative)
  - Payload: JSON viewer with syntax highlighting + search + copy + "Download JSON" button. Default expanded
  - Hash chain: vertical chain visualization — current record's hash at top, "← previous" arrow, previous record's hash + summary, "← previous" arrow, etc, back to root. Each hash clickable to jump to that record
  - Diff (if action was update): side-by-side or unified diff with + / - line coloring
  - Related: chips linking to actor profile / target entity / run (if applicable)
- Footer: "Copy record ID" + "Open in new tab" (deep link)

EMPTY STATE (current screenshot — "No audit records match the current filter"):
- Replace with Step 3 EmptyState variant:
  - illustration = ScrollText
  - title = "No audit records match the current filter"
  - description = "Try clearing your filters to see every audit record. The audit log is append-only — records are never deleted."
  - primary = "Clear filters"
  - secondary = "View integrity report" (links to the chain verification page, stub for now)

EMPTY STATE (no filters, zero records — should never happen in prod but handle):
- Step 3 EmptyState, illustration = ShieldCheck, title = "Audit log is empty", description = "Records will appear here as actions occur.", no primary

LOADING STATE: skeleton rows matching table layout (8 visible) with shimmer

VIRTUALIZATION NOTES:
- Render 20 rows beyond viewport top/bottom (overscan)
- Sticky header (Timestamp / Actor / Action columns)
- Smooth scroll on hash-jump (scrollIntoView with smooth, respect prefers-reduced-motion)

CONSTRAINTS: virtualized handles 100k+ records without lag; filter changes don't refetch (client-side filter for instant UX, server fetch only on date range change); hash column uses mono font; all icons from lucide; drawer keyboard-accessible (Esc closes, focus returns to triggering row); max-width 1600px container.

Deliverable: files modified, package additions (@tanstack/react-virtual if not already added), layout sketch, 1-paragraph rationale citing skill rules.
