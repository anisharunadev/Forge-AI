> **Status:** completed
/goal

Polish the Forge Co-pilot in Forge AI Agent OS — built in Step 19 but the user reports it needs curation and modernization. Read .claude/design-system/ first.

CURRENT OBSERVATIONS (from screenshots):
- The conversation list just shows "Failed to load conversations." in red — no retry, no illustration, no help
- The greeting card feels small and generic — just a tiny sparkle icon and copy
- The capability chips all look identical except for the colored dot — no visual hierarchy or context
- The input area shows /dashboard context tag + $0.0000 + send button — but no model picker, no voice, no attachment, no slash command hint
- The fullscreen /copilot page has no breadcrumb, no header context, no recent activity
- No pinned conversations, no search, no history grouping
- The floating FAB (Step 19 Part A) — unclear if visible on every page; needs to be obviously present

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI chat assistant welcome empty state greeting onboarding" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "conversation list search pinned history grouping chat UI" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "chat input area model picker attachments voice slash commands" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error state recovery retry illustration helpful chat empty" --domain style -f markdown

Adopt every rule. Then fix:

==========================================================
FIX 1 — CONVERSATION LIST ERROR STATE (the most visible problem)
==========================================================

Current: bare red text "Failed to load conversations." Replace with proper error treatment.

CONVERSATION LIST — when fetch fails:
- bg rgba(244,63,94,0.06) container, --radius-lg, p-20px, mx-16px my-12px
- Lucide CloudOff 24px in --accent-rose
- h3 "Couldn't load conversations" --text-sm font-600 --fg-primary mt-3
- Body "Check your connection or try again. Your existing chats are safe." --text-xs --fg-secondary mt-1
- Actions: "Try again" primary button (small) + "Start new chat" outline button — both mt-3
- Wrap in role="alert" aria-live="assertive"

CONVERSATION LIST — when EMPTY (success but zero conversations):
- This is GOOD news, not an error
- Compact welcome prompt: "Your conversations will appear here." --text-xs --fg-tertiary + "Start chatting →" link that focuses the input
- Do NOT use the error treatment for empty

CONVERSATION LIST — when LOADED (the success path):
- Search input at top — w-full, lucide Search icon, placeholder "Search conversations..." with ⌘K hint
- Filter pills below search: All / Pinned (count) / Shared (count) / Today
- "Pinned" section (sticky): shows up to 5 pinned conversations with Pin icon
- Grouped list with sticky day headers: "Today" / "Yesterday" / "Last 7 days" / "Older"
- Each row (--bg-transparent, hover --bg-white/4):
  - Title --text-sm font-500 --fg-primary (1 line truncate)
  - Preview --text-xs --fg-tertiary (1 line truncate, last message)
  - Right side: timestamp (--text-xs --fg-muted) + 3-dot menu (Pin/Unpin / Rename / Share / Delete)
  - Active row: bg rgba(99,102,241,0.10) + 2px left rail --accent-primary
  - Drag handle on hover for reordering pins
- Footer: "+ New conversation" button (full-width, --bg-elevated outline, dashed border) — creates new conversation and focuses input

==========================================================
FIX 2 — RICHER WELCOME GREETING
==========================================================

Current: small Sparkles icon + plain greeting. Replace with a richer welcome card that has personality + utility.

WELCOME CARD (centered in conversation area when no messages):
- Container: max-w-380px, --bg-elevated, --radius-xl, p-24px, --shadow-sm, border --border-subtle
- TOP: 56×56 square --bg-inset --radius-lg with lucide Sparkles 28px in --accent-cyan, animate-pulse (subtle 3s)
- h2 "Hi, I'm your Forge Co-pilot." --text-lg font-600 --fg-primary mt-4
- Body "I can help you understand your project, draft artefacts, and navigate Forge." --text-sm --fg-secondary mt-2 text-center

CONTEXT STRIP (mt-4, --bg-base, --radius-md, p-12px flex-col gap-2):
- "What I can see right now:" label --text-xs --fg-tertiary uppercase tracking-widest
- Three context pills (auto-detected from current page):
  1. lucide MapPin "On /dashboard" (cyan)
  2. lucide Bot "3 agents active" (emerald) — pulls from Step 18's KPI data
  3. lucide Activity "1 run in progress" (indigo) — or "0 runs" if idle
- Each pill: --bg-elevated, --radius-md, --text-xs --fg-secondary, hover bg rgba(255,255,255,0.06)
- "Clear context" X icon in corner

MODE TABS (mt-4, segmented control):
- General (default) | Code | ADR | Debug | Architecture
- Active: bg --accent-primary, fg --fg-primary
- Each mode changes the chip suggestions below and the system prompt
- Description below tabs: "Ask anything about your project, runs, or how Forge works." (changes per mode)

SUGGESTED STARTERS (mt-4, vertical stack gap-2):
Instead of capability chips that all look the same, make these CONTEXTUAL cards:
- Each card: --bg-base, --radius-md, p-12px flex gap-3, border --border-subtle, hover lift + border --border-default, 200ms
- Left: 32×32 square --bg-elevated --radius-md with lucide icon in semantic color
- Right: title --text-sm font-500 + body --text-xs --fg-tertiary (1 line)
- Click → fills input with that prompt + sends

Smart starters (page-aware):
- On /dashboard: "Summarize today's activity" / "Why is the orchestrator down?" / "Show me the most expensive run"
- On /workflows: "Explain my Ideation → PRD pipeline" / "Add an approval gate after step 3" / "Show runs of this workflow"
- On /agents: "What does my Code Reviewer agent do?" / "Create a new agent for testing"
- On /audit: "Anything suspicious in the last 24h?" / "Who changed settings yesterday?"
- Default (no context): the 6 from Step 19

"Show more suggestions" link at bottom — expands to 10 more contextual starters

RECENT ACTIVITY (mt-6, collapsible):
- Compact timeline of last 5 events you were involved in (from audit log)
- "View full history →" link

==========================================================
FIX 3 — INPUT AREA ENHANCEMENTS
==========================================================

Current: just /dashboard context tag + cost + input + send. Major upgrade needed.

INPUT TOOLBAR (new, above input row, h-40px flex between):
- LEFT (gap-1):
  - Model picker Combobox — current selection shows "Claude Sonnet 4.5" + Sparkles icon + chevron. Click opens dropdown of available models (Claude Sonnet, Claude Opus, GPT-4o, "Auto") with description + cost per 1k tokens for each. Selected model persists in localStorage. Show small cost hint beside selected model "($3/$15 per 1M)"
  - Mode picker (slash command) — "/copilot" pill, click to change mode (General / Code / ADR / Debug). Each mode has a different icon + system prompt
- RIGHT (gap-1):
  - Attachments (lucide Paperclip, 32px icon button)
  - Voice input (lucide Mic, 32px icon button) — shows "Listening..." tooltip on press, mic turns rose with pulse
  - Context indicator (small dot showing "@context: 1 file attached") — only shows when context > 0

INPUT ROW (current, p-12px):
- Multi-line shadcn Textarea, auto-grow 1 to 6 lines (was 8 — too tall)
- Placeholder "Ask the Co-pilot anything..." (changes per mode: "Describe the ADR you want to write..." for ADR mode)
- "/" trigger: slash commands popover above input (same as Step 19)
- "@" trigger: context attachments popover (same as Step 19)
- Drag-drop file overlay: when dragging a file over the panel, dim the area + show "Drop to attach" overlay with file icon

COST & SEND ROW (below input, h-32px flex between):
- LEFT: estimated cost --text-xs --fg-tertiary. Format: "~$0.0023 · 1.2k tokens estimated". When idle (0 chars): hide or show "Free for preview" badge (indigo)
- CENTER: char counter --text-xs --fg-tertiary "247 / 8000" + Reset button when in mid-edit
- RIGHT: Send button — circular 36×36 (was 32), --accent-primary bg, lucide ArrowUp 18px white. Disabled state: --bg-inset --fg-muted. Loading state (sending): spinner inside button

KEYBOARD HINTS (below cost row, --text-xs --fg-tertiary):
- "Enter to send · Shift+Enter for newline · / for commands · @ for context · ⌘J to toggle"
- These can fade after first interaction

==========================================================
FIX 4 — HEADER ENHANCEMENTS
==========================================================

PANEL HEADER (56px, --bg-elevated, border-b --border-subtle, p-12px flex between):
- LEFT cluster:
  - lucide Sparkles 18px in --accent-cyan (always visible)
  - "Forge Co-pilot" --text-sm font-600 — when conversation is active, show conversation title next to it with chevron (click to switch conversation)
  - Conversation title is editable inline (click to rename)
- RIGHT cluster:
  - "Pinned" toggle (lucide Pin, fills when active)
  - "Share" icon button (lucide Share2) — generates shareable link to conversation
  - "Settings" icon button (lucide SlidersHorizontal) — opens preferences popover: default model, response style (concise/balanced/detailed), enable/disable slash commands, theme
  - "History" icon button (lucide History) — opens conversation list drawer
  - "Expand to fullscreen" icon button (lucide Maximize2) — only shows when panel mode; opens /copilot fullscreen
  - "Close" icon button (lucide X) — closes panel (or Esc)

CONVERSATION STATUS DOT (small, between title and right cluster):
- Cyan pulsing when Co-pilot is generating
- Emerald when conversation is "synced" (saved to history)
- Amber when there are unsaved local changes (offline mode)

==========================================================
FIX 5 — FAB (FLOATING ACTION BUTTON) — verify and improve
==========================================================

VERIFY: src/components/forge-copilot-launcher.tsx is mounted in app/layout.tsx and visible on every page.

If NOT visible: fix the mount first. Then:

FAB IMPROVEMENTS:
- Size: 60×60 (was 56×56 — slightly bigger for easier targeting)
- Position: fixed bottom-6 right-6, z-index 50
- Idle animation: gentle pulse (scale 1 → 1.04 → 1, 3s) — more subtle than current
- Gradient: linear-gradient(135deg, #6366F1 0%, #22D3EE 100%) — indigo to cyan, the brand colors
- Glow: 0 0 24px rgba(99,102,241,0.35) — softer than current
- Icon: lucide Sparkles 24px white
- Hover: scale 1.08 + glow intensifies
- Active: scale 0.96
- "Unread" badge: top-right corner, 18×18 --accent-rose circle with count
- "Thinking" state: gradient shifts (rotate through indigo → violet → cyan), icon swaps to 3 rotating dots
- "Drag" state: cursor grab, FAB grows 1.1x, leaves subtle trail

ADD: Context badge floating above FAB (only when on certain pages):
- Above the FAB (bottom-24 right-6), small pill --bg-elevated --shadow-md
- Shows current page icon + route: "On /workflows" with Workflow icon
- Click → opens panel with that page's context pre-attached
- Auto-hides after 3s, reappears on page change

ADD: Quick actions mini-menu when long-pressing FAB (or right-click):
- New conversation
- Summarize current page
- Voice mode
- Recent conversations
- Settings

ADD: Notification dot + preview tooltip when new AI message arrives while panel is closed:
- FAB pulses subtly (3 quick scale bumps)
- Hover FAB → tooltip "Forge Co-pilot: 2 new messages · Click to view"
- Click → opens panel AND scrolls to latest message

==========================================================
FIX 6 — FULLSCREEN /copilot PAGE ENHANCEMENTS
==========================================================

Current: just renders the panel in fullscreen. No page context.

/copilot PAGE LAYOUT (new):
- Full-page layout, NOT just a giant panel
- LEFT SIDEBAR (320px, --bg-base, border-r --border-subtle): conversation list (uses Fix 1 design) — same drawer but pinned open
- MAIN AREA (flex-1): chat panel content
- RIGHT SIDEBAR (320px, --bg-base, border-l --border-subtle, hidden <1280px): "About this conversation" panel
  - Context: what the Co-pilot can see (entities, files, runs)
  - Used tools: list of forge-* commands invoked during this conversation
  - Tokens used + cost breakdown
  - Export options (Download as Markdown / Copy / Share link)
- TOP BAR (64px, --bg-elevated, border-b --border-subtle):
  - Breadcrumb: "Workspace / Co-pilot" with home icon
  - Center: conversation title (editable inline)
  - Right: "+ New chat" button + Settings icon + Collapse sidebar left/right + Back to dashboard link

==========================================================
FIX 7 — MESSAGE BUBBLES (when conversation has messages)
==========================================================

These will show up after the welcome state — design them well even though the screenshot shows empty state:

USER MESSAGE:
- Right-aligned, max-width 85%, bg --accent-primary, --radius-2xl (top-right corner --radius-md for tail), p-12px-16px
- Body --text-sm --fg-primary, markdown rendered
- Hover: shows action row below (Edit / Copy / Delete)
- Attached files: chip row at bottom, lucide Paperclip icon + filename + size + remove X

ASSISTANT MESSAGE:
- Left-aligned, max-width 90%, NO bubble bg (clean modern chat — Linear-style)
- Above message: avatar (24×24 square --bg-elevated with lucide Sparkles 14px in --accent-cyan) + "Forge Co-pilot" --text-xs font-600 + model used --text-xs --fg-tertiary
- Body --text-sm --fg-primary, markdown with:
  - Code blocks: shadcn CodeBlock or shiki, dark theme, copy button top-right, language label
  - Inline code: bg --bg-inset --radius-sm px-4px mono --text-xs
  - Tables, lists, blockquotes styled per Step 1
- TOOL CALLS (when Co-pilot invokes a forge command):
  - Collapsible card between messages: lucide Wrench icon + command name + duration badge
  - Expanded: input + output JSON with syntax highlighting
  - Color: --bg-surface, --radius-md, border --border-subtle, --text-xs
- Action row below message:
  - Copy (lucide Copy + toast on click)
  - Regenerate (lucide RefreshCw)
  - Thumbs up / down (feedback)
  - "Pin message" (lucide Pin)
  - "Share" (lucide Share2)
- Sources/citations row (when applicable): chips with link icons

STREAMING MESSAGE:
- Renders word-by-word with cyan caret at the end (▍)
- Below: "Stop generating" ghost button (lucide Square)
- Stop button appears 200ms after streaming starts

DAY SEPARATORS between messages from different days: "Today" / "Yesterday" / "Jun 20"

QUICK REPLIES: 1-3 contextual follow-up chips below each assistant message (e.g., "Tell me more", "Show me the data", "Save as draft")

==========================================================
FIX 8 — SLASH COMMANDS (improve discoverability)
==========================================================

Currently Step 19 mentioned slash commands but they're not visible in the screenshot. Polish:

WHEN INPUT IS EMPTY + USER PRESSES "/":
- Popover appears above input with full command list
- Categories: Navigation / Run / Create / Toggles / Help
- Commands (with icons + descriptions + shortcuts):
  - /help — Show all commands
  - /clear — Clear conversation
  - /new — Start new conversation
  - /export — Export conversation
  - /agents [name] — Talk to specific agent
  - /run [command] — Run a forge command
  - /summarize — Summarize current page
  - /navigate [path] — Navigate to a page
  - /search [query] — Search the knowledge base
  - /model [name] — Switch model mid-conversation
  - /pin — Pin current conversation
- Up/Down arrow to navigate, Enter to select, Esc to close
- Search input at top of popover to filter

WHEN USER TYPES "/" with text after it:
- Filters the command list
- Selected command appears highlighted, description shown in preview pane to the right

==========================================================
FIX 9 — IMPROVED CONTEXT INDICATORS
==========================================================

CONTEXT PILLS BELOW INPUT (new row):
- Shows what's attached: "@Forge Platform · /dashboard · agent:Code-Reviewer"
- Each chip: --bg-elevated, --radius-full, --text-xs --fg-secondary, hover bg rgba(255,255,255,0.06)
- "+ Add context" button (lucide Plus) at the end
- Click any chip X to remove
- "@" mentions during typing auto-add chips

WHEN USER NAVIGATES while panel is open:
- Auto-update "Context: /new-path" pill
- Subtle toast "Context updated to /workflows" — or do not toast, just update silently

==========================================================
FIX 10 — RESPONSE LOADING STATE
==========================================================

After user sends a message:
- USER MESSAGE: appears immediately with send animation (slide up + fade, 200ms)
- TYPING INDICATOR: while waiting for first token:
  - 3 animated dots below the user's message, --accent-cyan, each pulsing with offset
  - Above dots: "Forge Co-pilot is thinking..." --text-xs --fg-tertiary
- STREAMING: replaces typing indicator, text appears word-by-word
- TIMEOUT (>10s with no response): show amber warning "This is taking longer than usual" + Cancel button
- ERROR: rose border + "Couldn't reach the AI service. Retry?" inline

==========================================================
CONSTRAINTS
==========================================================

- All existing component APIs from Step 19 stay the same — only prop additions
- Reuse: EmptyState from Step 3, error-state from Step 13, shadcn primitives
- Don't break the launcher FAB contract — every existing keyboard shortcut (⌘J, Esc) must keep working
- Persist: panel state, model preference, mode preference in localStorage
- All animations respect prefers-reduced-motion
- All interactive elements have aria-labels
- Dark mode only
- Streaming caret animation can be CSS, not JS

Deliverable: files modified, before/after for each fix, ASCII layout sketches, 1-paragraph rationale citing skill rules, plus a "what we deliberately did NOT change" note (the underlying engine, conversation data model, FAB behavior contract).
