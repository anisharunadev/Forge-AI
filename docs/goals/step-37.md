/goal

Polish the floating Forge Co-pilot panel in Forge AI Agent OS — currently feels cramped, has a stuck error state, the input area is too busy, header has too many icons, and the backdrop dims the wrong area. Make it clean, focused, more chat-like. Read .claude/design-system/ first.

USER INTENT (from the screenshot): the panel is too busy in the wrong places. Error state is dominating, context strip is too tall, input area has 4 stacked sub-rows, header has 6 icon buttons. Want: clean, focused, minimal chrome around the actual conversation.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "chat panel minimal clean input area compact header" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error state dismissible non-blocking toast notification" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "floating slide-over panel backdrop dim area focus mode" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — KILL THE STUCK ERROR STATE
==========================================================

The "Couldn't load conversations" error is taking up ~200px of prime real estate at the top of the panel. This is wrong because:
- It's a NON-BLOCKING error (user can still chat)
- It dominates the welcome state
- The retry button is in the wrong place (panel header is for navigation, not errors)

REPLACE with:
- Move error to a SMALL DISMISSIBLE BANNER just below the header (h-32px, --bg-rose/10, --text-xs, X to dismiss)
- OR move to a toast notification (top-right of viewport, auto-dismiss in 5s, action: "Retry")
- The WELCOME state should be visible by default — error should be subordinate
- If conversation list fails: greeting + capability chips + input area all still work; user can start new chat immediately
- "Start new chat" should be a top-of-welcome quick action, not buried in the error

==========================================================
FIX 2 — COLLAPSE "WHAT I CAN SEE RIGHT NOW" BY DEFAULT
==========================================================

Currently the context strip (3 pills: On /dashboard / 3 agents active / 1 run in progress) takes ~80px of vertical space and is always visible.

REPLACE with:
- Show as a single COMPACT ROW: small pill "📍 /dashboard · 3 agents · 1 run" with chevron to expand
- Click chevron → expands to show individual context pills (current state)
- Default COLLAPSED — single line, subtle, low priority
- "+ Add context" button moves into the expanded view only
- This frees ~60px for actual conversation area

==========================================================
FIX 3 — SIMPLIFY THE INPUT AREA (the big fix)
==========================================================

Current input area has 4 stacked sub-rows that feel overwhelming:
- Row 1: model picker + slash command tag + cost
- Row 2: input field
- Row 3: "FREE FOR PREVIEW" + char counter + send button
- Row 4: keyboard hints (Enter to send · Shift+Enter for newline · / commands · @ context · ⌘ toggle)

REPLACE WITH (clean Linear-style chat input):
┌─────────────────────────────────────────────┐ │ [Model: Claude S... ▼] /general 📎 🎙 ⌘J│ │ Ask the Co-pilot anything... │ │ │ │ @dashboard + Add context │ │ 247 / 8000 │ │ Enter to send · Shift+Enter for newline · /│ └─────────────────────────────────────────────┘


- TOP ROW (h-36px, --bg-elevated, border-b --border-subtle, p-8px flex between):
  - LEFT cluster: Model picker (small Combobox button "Claude Sonnet" + Sparkles + chevron, w-auto)
  - CENTER: Mode tag ("/general") — click to change mode, popover with mode list
  - RIGHT: attachments (Paperclip) + voice (Mic) + close panel (X) icon buttons, 28px each
- INPUT ROW (auto-grow, --bg-base, p-12px, max-h-160px scroll):
  - Textarea — single visible line, grows to max 6 lines
  - Placeholder "Ask the Co-pilot anything..."
  - "/" trigger: slash commands popover
  - "@" trigger: context attachments popover
- ATTACHED CONTEXT ROW (only when context > 0, h-32px):
  - Compact pills: "@dashboard · @Forge Platform" with X to remove each
  - "+ Add context" inline button
- FOOTER ROW (h-28px, --text-xs --fg-tertiary, p-8px flex between):
  - LEFT: "Enter to send · Shift+Enter for newline · / commands" (truncated to one line)
  - RIGHT: "247 / 8000" mono

REMOVED (cleaner):
- ❌ The $3 / $15 per 1M cost display (move to model picker tooltip only)
- ❌ "FREE FOR PREVIEW" badge (redundant with model picker showing free tier)
- ❌ ⌘J toggle hint in the input area (already in global shortcuts)

Send button: floating bottom-right of input area, circular 36×36, --accent-primary bg, ArrowUp icon, disabled when empty

==========================================================
FIX 4 — REDUCE HEADER ICONS
==========================================================

Current header has 6 icons: pin, share, settings, history, fullscreen, close. Too many.

KEEP only 3 essentials:
- Title: Sparkles icon + "Forge Co-pilot" + (optional) conversation title
- Pin: only if conversation is pinned (otherwise hidden)
- Close: X (always visible)

MOVE to a "More" menu (3-dot) the less critical ones:
- Pin/Unpin
- Share
- History (conversation list)
- Settings (model + preferences)
- Fullscreen

This gives 3-4 visible elements instead of 7. Much cleaner.

==========================================================
FIX 5 — FIX THE BACKDROP OVERLAY
==========================================================

The screenshot shows the backdrop dimming the LEFT side of the page (sidebar + content area visible but darkened). The panel itself is on the right and NOT dimmed. This is the opposite of what should happen.

FIX:
- Backdrop should dim the ENTIRE page (left, center, right) when panel is open
- The panel itself should be UN-dimmed (it's the focus)
- Backdrop opacity: bg-black/40 with backdrop-blur-sm
- OR: no backdrop at all on desktop (panel is enough visual focus), backdrop only on mobile where panel takes full screen
- RECOMMEND: no backdrop on desktop ≥1024px, full-screen panel + backdrop blur on mobile

==========================================================
FIX 6 — GREETING + WELCOME STATE SIMPLIFICATION
==========================================================

Current welcome:
- 80×80 sparkle icon (centered)
- "Hi, I'm your Forge Co-pilot." (large)
- 3-line description
- "What I can see right now" strip
- Mode tabs (5 tabs)
- Capability chips

SIMPLIFY:
- 56×56 sparkle icon (smaller, less imposing)
- "Hi Arun 👋" (use the user's name — personal)
- ONE line: "Ask me about your project, runs, or how Forge works."
- Mode tabs: keep but as a small segmented control, single line
- Capability chips: only show 3 instead of 6 (or as small text links: "Try: Summarize activity · Show costs · Write an ADR")
- "What I can see right now" → collapsed to single line (Fix 2)

Result: greeting fits in 200px instead of 500px. More room for actual content.

==========================================================
FIX 7 — COMPACT CONVERSATION LIST
==========================================================

When user clicks "History" icon, the conversation list should be a SUB-PANEL within the Co-pilot panel, not a separate drawer:
- Slide-in from the left, replaces the current view temporarily
- Search input + scrollable list of conversations
- Back arrow returns to current view
- "New chat" button at top

This keeps the user in context. Opening a separate drawer (current behavior) breaks the flow.

==========================================================
FIX 8 — INPUT GROWTH + SCROLL BEHAVIOR
==========================================================

When user types a long message:
- Textarea auto-grows 1 line → max 6 lines
- After 6 lines: internal scroll within the textarea
- Don't push the mode tabs / model picker off-screen
- Send button stays visible at all times (sticky bottom-right of input area)

==========================================================
FIX 9 — LOADING / EMPTY / ERROR STATES

==========================================================

- LOADING conversations: shimmer skeleton (1-2 rows visible in list)
- EMPTY conversations: "Your conversations will appear here" + "Start chatting →" link that focuses input
- ERROR loading: small dismissible banner (Fix 1) + retry button
- STREAMING response: cyan caret + "Stop generating" button (Step 24 already)
- STREAMING TIMEOUT (>10s): amber "This is taking longer than usual" + Cancel

==========================================================
FIX 10 — MOBILE BEHAVIOR (when panel is opened on small screens)
==========================================================

- <768px: panel becomes full-screen sheet (slide up from bottom)
- No backdrop needed (it's full screen)
- Header: back arrow + title + close (X)
- Input area at bottom (sticky), same simplified layout
- All other content scrolls

==========================================================
CONSTRAINTS
==========================================================

- Keep all Step 19/24 functionality (FAB, context injection, slash commands, streaming, model picker, etc.)
- Don't break ⌘J global toggle
- Don't break conversation persistence in localStorage
- Keep conversation status dot (cyan pulse when generating, emerald when synced, amber when offline)
- All animations respect prefers-reduced-motion
- Dark mode only
- Lucide icons only
- Panel width on desktop: 420px (don't change)

==========================================================
DELIVERABLE
==========================================================

- files modified
- Before/after sketch (text-based) of the panel showing the cleanup
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep all Step 19/24 functionality, keep FAB, keep all slash commands, keep streaming behavior