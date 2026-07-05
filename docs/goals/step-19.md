> **Status:** completed
/goal

Modernize the Forge Co-pilot and add a persistent floating AI widget available from every page. Tokens, shell, empty/error states, and Steps 7–18 are done. Read .claude/design-system/ first.

CURRENT STATE (bad): the standalone /copilot page just says "the panel is opening on the right" while the panel is already open — redundant. The panel itself has a broken conversation list and a bare-bones input. The user wants: modernize the panel AND add a floating widget that summons Co-pilot from any page.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI assistant chat panel conversation history streaming" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "floating action button FAB persistent global widget chat" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "chat UI streaming response markdown code highlight tool call" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "global widget keyboard shortcut accessibility focus management" --domain ux-guideline -f markdown

Adopt every rule. Then build:

THIS STEP HAS TWO DELIVERABLES — build both:
A) The floating widget (always visible, global, persistent)
B) The Co-pilot panel it opens (modernized chat experience)
C) Refactor /copilot page to use the same panel + add a focused "full-screen Co-pilot" mode

==========================================================
PART A — FLOATING WIDGET (THE KEY USER REQUEST)
==========================================================

CREATE src/components/forge-copilot-launcher.tsx — a persistent client component mounted in the root layout (app/layout.tsx) so it renders on EVERY page.

VISIBLE STATES:

COLLAPSED (default) — FAB at bottom-right, fixed position, 24px from edges:
- Size: 56×56 circular, --accent-cyan to --accent-primary gradient bg, --shadow-lg + custom glow shadow (0 0 24px rgba(99,102,241,0.4))
- Icon: lucide Sparkles 24px, white, with a subtle continuous animation: gentle pulse (scale 1 → 1.05 → 1, 3s ease-in-out loop) + a tiny orbital dot orbiting the icon (cyan, 8s linear infinite)
- Hover: scale 1.08, glow intensifies (0 0 32px rgba(99,102,241,0.6)), cursor pointer
- Active/pressed: scale 0.95
- Tooltip on hover after 500ms: "Forge Co-pilot · ⌘J" with brief description
- UNREAD STATE: replace the orbital dot with a rose notification badge (top-right of FAB, 16×16 circle with count, --accent-rose bg, white number, pulsing)
- "THINKING" STATE: when Co-pilot is processing, swap icon to a custom animated spinner (3 rotating dots in cyan), gradient shifts to warmer (cyan → violet) to signal activity
- "DRAG" STATE: cursor becomes grab, FAB slightly enlarges, drops a subtle trail
- Position: fixed bottom-6 right-6, z-index 50 (above content, below modals)

EXPANDED — when clicked:
- FAB animates into the panel header (Framer Motion layoutId): scale up, translate to top-right of where the panel will be
- Panel slides in from right (same pattern as current Co-pilot panel, 420px wide, full viewport height, --bg-elevated, --shadow-lg on the left edge)
- z-index 60
- Backdrop (only on mobile <1024px): bg-black/40, backdrop-blur-sm

COLLAPSED BACK — close button (X) in panel header, or Esc, or click outside (desktop only):
- Panel slides out right
- FAB returns to bottom-right with bounce animation

KEYBOARD:
- ⌘J / Ctrl+J: toggle open/close from ANY page (global hotkey — register in launcher component, useEffect on mount)
- Esc: close panel, return focus to FAB
- Tab inside panel: trap focus while open
- Up/Down arrow keys when input is focused: cycle through last 5 prompts from history
- Enter: send message; Shift+Enter: newline

PERSISTENT STATE:
- Remember last open conversation in localStorage
- Remember panel open/closed state per page (don't auto-open on every nav — annoying)
- Unread badge clears when panel opens
- If user closes panel mid-response: response keeps generating in background, FAB shows "thinking" state

DRAGGABLE (nice-to-have, optional):
- FAB can be dragged to any corner (snaps to nearest corner with 100ms spring)
- Default bottom-right
- Position persists in localStorage
- Drag handle: 200ms hold on FAB activates drag mode (prevent accidental drags)

==========================================================
PART B — CO-PILOT PANEL (THE EXPERIENCE INSIDE)
==========================================================

REBUILD src/components/copilot-panel.tsx — used by both the floating widget and the /copilot page.

STRUCTURE (top to bottom, 420px wide):

HEADER (56px, --bg-elevated, border-b --border-subtle):
- Left: lucide Sparkles 20px in --accent-cyan + "Forge Co-pilot" --text-sm font-600
- Middle (flex-1): conversation title — editable inline on hover (click to rename, Enter saves)
- Right: icon buttons — "New conversation" (Plus), "History" (History, opens conversation list), "Settings" (Sliders, opens model picker + preferences), "Expand to fullscreen" (Maximize2, only shows in non-fullscreen contexts), "Close" (X)

CONVERSATION LIST DRAWER (slides in from left when "History" clicked):
- Replaces conversation area temporarily
- Search input "Search conversations..." w-full
- List (grouped by Today / Yesterday / Last 7 days / Older):
  - Each row: title --text-sm font-500 --fg-primary + last message preview --text-xs --fg-tertiary (1 line clamp) + timestamp --text-xs --fg-muted + message count badge
  - Active row: bg rgba(99,102,241,0.10) + 2px left rail --accent-primary
  - Hover: bg rgba(255,255,255,0.04) + 3-dot menu (Rename / Pin / Delete)
- Empty state: Step 3 EmptyState inline variant, illustration = MessageSquare, title "No conversations yet", description "Start chatting to see your history here."
- "New conversation" button bottom
- Pin section above the list

EMPTY / WELCOME STATE (when no conversation is active — current screenshot shows this, replace it):

CENTERED GREETING:
- 80×80 square --bg-elevated --radius-xl with lucide Sparkles 40px in --accent-cyan, animate-pulse (subtle)
- h2 "Hi, I'm your Forge Co-pilot." --text-lg font-600 --fg-primary mt-6
- Body "I can help you understand your project, draft artefacts, and navigate Forge. Ask me anything." --text-sm --fg-secondary mt-2 text-center max-w-320px

CAPABILITY CHIPS (mt-6, flex-wrap gap-2 max-w-360px):
- 6 chips, click to pre-fill input:
  1. lucide BookOpen "Summarize my knowledge base" (cyan)
  2. lucide Activity "Show me recent activity" (emerald)
  3. lucide FileText "Help me write an ADR" (violet)
  4. lucide GitBranch "Connect my first repo" (indigo)
  5. lucide BarChart3 "What changed in costs?" (amber)
  6. lucide ShieldCheck "Audit my last deploy" (rose)
- Each chip: --bg-elevated, --radius-md, --text-xs --fg-secondary, hover bg rgba(255,255,255,0.06)

CONVERSATION AREA (flex-1, overflow-y-auto, custom thin scrollbar, p-16px):

MESSAGE BUBBLES — two types:
USER MESSAGE:
- Right-aligned, max-width 85%
- bg --accent-primary, --radius-2xl (top-right smaller --radius-md for "tail" feel), p-12px
- Body --text-sm --fg-primary, markdown rendered
- Below: timestamp --text-xs --fg-tertiary + edit icon (re-edit and resubmit)
- Optional: attached files below message as small chips with file icon + name + size

ASSISTANT MESSAGE:
- Left-aligned, max-width 90%, no bubble bg (transparent — modern chat UI)
- Above the message: avatar (lucide Sparkles 16px in cyan square 24×24) + "Forge Co-pilot" --text-xs font-600 + model name --text-xs --fg-tertiary
- Body --text-sm --fg-primary, markdown rendered with:
  - Code blocks: shadcn CodeBlock or shiki, dark theme, copy button top-right, language label
  - Inline code: bg --bg-inset, --radius-sm, px-4px, mono font, --text-xs
  - Links: --accent-primary, hover underline
  - Tables: shadcn Table styling
  - Lists: proper indent + bullets
- TOOL CALLS — when Co-pilot invokes a tool/agent, show a collapsible "tool call" card:
  - Collapsed: lucide Wrench icon + tool name + "Called 2s ago" --text-xs --fg-tertiary
  - Expanded: input JSON (syntax highlighted) + output JSON + duration badge
  - Color: --bg-surface, --radius-md, border --border-subtle
- Below message: action row — Copy (lucide Copy icon + "Copied" toast on click), Regenerate (lucide RefreshCw), Thumbs up/down (feedback)
- Below that: sources/citations if any (chip row with link icons)

STREAMING STATE (when Co-pilot is generating):
- Avatar appears immediately
- Body fills in word-by-word with a subtle caret (▍) at the end, cyan color
- Below: "Stop generating" ghost button (lucide Square icon)
- Stop button visible after first 200ms of streaming

ERROR STATE (response failed):
- Body shows error message in --accent-rose
- Action row: "Try again" + "Report issue"

CONVERSATION SCROLL BEHAVIOR:
- Auto-scroll to bottom on new messages (smooth)
- "Jump to latest" floating button (lucide ArrowDown) appears when user scrolls up — pulse briefly when new message arrives
- Maintain scroll position when loading older messages (pagination)

DAY SEPARATORS:
- Between message groups on different days: centered timestamp "Today" / "Yesterday" / "Jun 20" --text-xs --fg-muted with hr lines

QUICK REPLY SUGGESTIONS:
- After each assistant message, show 1-3 contextual follow-up suggestions as chips (e.g., "Tell me more", "Show the data", "Save as draft"). Co-pilot can suggest these; for now, hardcode generic ones

INPUT AREA (bottom, --bg-elevated, border-t --border-subtle, p-12px):

TOOLBAR ROW (above input):
- Left: model picker Combobox (currently Claude Sonnet 4.5 — show "Claude Sonnet 4.5" with sparkle icon + dropdown of available models: GPT-4o, Claude Opus, etc, plus "Auto" option that picks best per query)
- Mode picker: "/copilot" tag (slash command indicator showing current mode — General / Code / ADR / Debug). Click to change. Each mode has a different system prompt
- Right: attachments button (lucide Paperclip) + voice input (lucide Mic, optional)

TEXTAREA:
- shadcn Textarea, auto-grow (1 to 8 lines)
- Placeholder "Ask the Co-pilot anything..."
- Mono font ONLY inside code blocks (not for general text)
- "/" trigger: slash commands menu (type "/" to see /help, /clear, /export, /agents, /run etc — command palette style popover above input)
- "@" trigger: context attachments menu (type "@" to see @agent-name, @project-name, @file-name, @run-id — attaches as context to next message)
- File drag-and-drop on the entire panel: drops file, shows attachment chip below input

COST & SEND ROW (below input):
- Left: estimated cost --text-xs --fg-tertiary "$0.0023 estimated · 1.2k tokens" (live updates as you type)
- Right: char counter --text-xs --fg-tertiary "247 / 8000" + Send button (lucide ArrowUp, circular 32×32, --accent-primary bg, disabled when empty or streaming). Send on Enter, Shift+Enter newline

CONTEXTUAL AWARENESS (advanced):
- Co-pilot can see the current page route. Show subtle indicator: "Context: /agents" above input when active. User can dismiss
- Co-pilot can reference entities from current page (e.g., on /agents page, it can reference specific agents without user typing @)
- A "+ Add context" button next to model picker opens a popover with searchable entity list

==========================================================
PART C — /copilot PAGE (REFACTOR)
==========================================================

The current /copilot page is a dead-end ("panel is opening on the right"). Refactor it to:

OPTION 1 (recommended): full-screen Co-pilot mode
- src/app/(workspace)/copilot/page.tsx renders the same CopilotPanel but in full-screen mode (no FAB, takes whole content area, header shows "Forge Co-pilot" h1 + back to dashboard breadcrumb)
- When user visits /copilot, the floating widget's FAB hides (since the panel is already shown in full)
- Use the same component, different prop `mode="fullscreen"` vs `mode="panel"`

OPTION 2 (alternate): keep /copilot as a marketing/intro page
- Hero with bigger Sparkles animation + extended capability list + "Start chatting" CTA that opens the panel
- Less code but worse UX

DO OPTION 1.

==========================================================
DESIGN RULES (apply throughout)
==========================================================

- Streaming response text uses cyan caret — only visible color change to indicate "AI is typing"
- Tool-call cards use --bg-surface (subtle elevation) and collapse by default to keep chat clean
- Code blocks always have a "Copy" button + language label
- Long messages: code blocks scroll horizontally inside bubble, never overflow the panel
- All timestamps relative by default ("2m ago"), absolute on hover (tooltip)
- Dark mode only
- prefers-reduced-motion: disable streaming caret pulse, FAB orbital dot, panel slide; keep instant transitions
- All animations respect prefers-reduced-motion
- Panel must work at 320px width (mobile) and at 420px (desktop)
- On mobile: panel becomes full-screen sheet (slide up from bottom)

==========================================================
ACCESSIBILITY
==========================================================

- Panel is a dialog — role="dialog" aria-modal="true" aria-labelledby="copilot-title"
- Focus moves to input on open
- Focus returns to FAB on close
- All interactive elements have aria-labels
- Streaming region: aria-live="polite" on the message area
- Send button: aria-label="Send message"
- Slash command popover: keyboard navigable, Esc closes
- Color contrast verified on all text
- Co-pilot panel does NOT steal focus when closed (FAB stays focused)
- When user types in input elsewhere (e.g., a form field), global ⌘J should NOT steal focus from that field

==========================================================
CONSTRAINTS
==================================

- Use lucide-react only (no emojis as UI icons)
- Use Framer Motion for: FAB ↔ panel transition (layoutId), panel slide-in/out, message fade-in, streaming caret
- Use shadcn: Button, Input, Textarea, Command (for slash menu), Popover, Dialog
- Streaming: use server-sent events OR mocked with setInterval for now
- Conversation list: mock with sample data for now, localStorage for persistence
- File attachments: mock — show UI but don't actually upload yet
- Voice input: mock button (does nothing yet, placeholder for future Web Speech API integration)
- This step is BIG — it touches: layout, global component, new components/, the existing CopilotPanel refactor, and a page. Build it in order: A (FAB) → B (panel internals) → C (page refactor)

Deliverable: list of files created + modified, full prop interface for CopilotPanel, keyboard shortcut table, and 1-paragraph design rationale citing which skill rules shaped the experience.
