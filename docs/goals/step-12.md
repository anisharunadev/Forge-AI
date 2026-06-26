/goal

Modernize the Organization Knowledge page in Forge AI Agent OS. Tokens, shell, empty states, and Steps 7–11 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "knowledge base templates standards policy library editor" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "master-detail editor knowledge management markdown" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "document version control diff inline editor" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/knowledge/page.tsx. Keep route. Keep tabs Standards / Templates / Policies / Activity. Rebuild content.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Organization Knowledge" --text-3xl font-700 with a BookOpen icon in --accent-primary
- Body "Org-level standards (F-001), templates (F-002), and policies (F-003). These artefacts are shared across all projects in this tenant."
- Top-right: "New Standard" primary button (+ icon, label changes per active tab: Standards → "New Standard", Templates → "New Template", Policies → "New Policy")

TABS (segmented control pattern, count badges):
- Standards (N) | Templates (N) | Policies (N) | Activity

EACH TAB CONTENT (default Standards):

MASTER-DETAIL LAYOUT (left list 320px, right editor flex-1):

LEFT (sticky list):
- Search input "Search F-001..." w-full, with lucide Search icon
- Filter: scope pills (Org-wide / Project-scoped / Archived)
- Item rows: artifact id (mono "F-001" --text-xs --fg-tertiary) + title --text-sm font-500 --fg-primary + scope badge + last edited --text-xs --fg-tertiary. Active row: bg rgba(99,102,241,0.10) + 2px left rail --accent-primary. Hover bg rgba(255,255,255,0.04)
- Empty list variant: muted "No F-001 yet" + small "+ New" link

RIGHT (editor panel, --bg-surface, --radius-lg, border --border-subtle, flex-col):

EDITOR HEADER (p-20px, border-b --border-subtle):
- Top row: artifact id badge (mono --bg-inset px-8px py-2px --radius-sm) + scope badge + status dot (Draft amber / Published emerald / Archived muted)
- Center: title h1 (editable inline — click to edit, --text-2xl font-700). When editing: shadcn Input with autosave indicator (small emerald dot + "Saved 2s ago" --text-xs --fg-tertiary)
- Right: 3-dot menu (Duplicate, Export, Archive, Delete)
- Meta row: author avatar + name + created + last edited + version badge "v3" with chevron (opens version history)

EDITOR BODY (flex-1, p-32px, overflow-y-auto):
- Markdown editor: split view (write left, preview right on ≥1280px; tabbed on smaller). Toolbar above with formatting buttons (B / I / H / link / list / code / quote) + "Insert template" dropdown
- Use a lightweight markdown editor (e.g., @uiw/react-md-editor) — keep it minimal, dark-themed, monospace body
- Right side preview: rendered markdown with proper heading hierarchy and code highlighting (Shiki)
- Below editor: "Linked artefacts" chip row — shows related templates, policies, ADRs. Add link via Combobox

EDITOR FOOTER (p-16px, border-t --border-subtle, flex between):
- Left: word count + read time estimate + last saved timestamp
- Right: "Discard changes" ghost + "Save draft" outline + "Publish" primary buttons. Publish opens a confirmation AlertDialog

EMPTY STATE (when no artifact is selected from list): use Step 3 EmptyState inside the right panel, illustration = FileText or BookOpen, title "Select an artefact to edit", description "Pick an F-001 standard, F-002 template, or F-003 policy from the list. Or create a new one.", primary "Create Standard"

TEMPLATES TAB: same master-detail but artifact type = "F-002 Template". Right panel adds a "Variables" sidebar (right of editor) — list of {{variable}} placeholders found in the doc with descriptions and example values

POLICIES TAB: same master-detail but artifact type = "F-003 Policy". Right panel shows "Enforcement" sidebar — scope selector (Org / Project / Resource type) + Strictness dropdown (Strict / Advisory / Off) + Acknowledgment required toggle + Linked controls list

ACTIVITY TAB: timeline view — every edit / publish / archive event. Each row: timestamp + actor avatar + action verb (edited / published / archived) + artifact reference (chip) + diff summary (lucide FileDiff icon + "+12 / -3 lines"). Filter pills: All / Edits / Publishes / Archives

CONSTRAINTS: master-detail collapses to single-column list <1024px; row click selects artifact and URL updates with id; autosave debounce 1500ms with explicit indicator (never silent); markdown editor must be dark-themed; Shiki theme matches dark palette; empty states from Step 3 everywhere; prefers-reduced-motion respected.

Deliverable: files modified, package additions (@uiw/react-md-editor, shiki), layout sketch, 1-paragraph rationale citing skill rules.