/goal

Modernize the Terminal page in Forge AI Agent OS. Tokens, shell, empty states, error states, and Steps 7–14 are done. Read .claude/skills/ui-ux-pro-max first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "terminal emulator xterm.js dark mode layout" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-session tabbed interface connection status warning" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "websocket reconnect status indicator retry pattern" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/terminal/page.tsx. Keep route. Rebuild.

HERO BAND (animated gradient border like Step 4):
- Eyebrow "FORGE TERMINAL CENTER" --text-xs --fg-tertiary
- h1 "Live terminal sessions" --text-3xl font-700 with lucide Terminal icon in --accent-primary
- Top-right: two dropdowns side-by-side — Workspace selector (default) + Agent selector (Claude Code, Codex, Aider, etc). Right of dropdowns: "+ New session" primary button (+ icon)

SIDECAR WARNING BANNER (conditional, when WS disconnected — current screenshot):
- bg rgba(245, 158, 11, 0.08), border 1px rgba(245, 158, 11, 0.30), --radius-lg, p-16px
- Left: TriangleAlert icon in --accent-amber (16px)
- Title "Terminal sidecar not running" --text-sm font-500
- Body "The xterm.js pane can render but cannot execute commands until the local PTY sidecar is started on ws://localhost:4001." --text-xs --fg-secondary
- Inline code chips: "pnpm dev:terminal" and "pnpm dev:stack" — copy on click
- Right: "Retry connection" ghost button + "Hide" X icon
- Auto-retry with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) — show "Retrying in Xs..." inline
- When connected: banner animates out (slide up + fade) and connection status badge replaces it (emerald dot + "Connected to ws://localhost:4001")

MAIN AREA (3-column on desktop ≥1440px, 2-column on smaller, stacked <1024px):

LEFT/MAIN: TERMINAL PANEL
- Session tabs bar (top): each tab = session label + status dot + close X on hover. Active tab: bg --bg-elevated + --fg-primary + bottom border 2px --accent-primary. "+" button to start new session. Tab drag-to-reorder (use @dnd-kit from Step 5)
- Below tabs: LAYOUT switcher (segmented control) — Single (current) / Split horizontal / Split vertical / Grid 2×2
- Terminal area: xterm.js with FitAddon, WebLinksAddon, SearchAddon. bg #000, fg #E5E7EB, cursor #6366F1 (--accent-primary), selection bg rgba(99,102,241,0.30). Theme: xterm "forge-dark" matching app palette
- Top-right of terminal: small toolbar — Search (Ctrl+Shift+F), Copy (Ctrl+Shift+C), Paste (Ctrl+Shift+V), Clear (Ctrl+L), Fullscreen toggle, Settings gear
- Bottom status bar: connection status (emerald/amber/rose dot + latency in ms) + current session id + agent name + "Ctrl+Shift+P for command palette" hint

RIGHT: AUDIT LOG (320px, sticky)
- Header "Audit log" --text-sm font-600 + "Last N commands across all sessions." --text-xs --fg-tertiary
- List: each row = timestamp --text-xs mono --fg-tertiary + command (mono) + exit code badge (0 emerald, non-zero rose). Click row → scrolls terminal to that point and highlights the command block
- Empty state: muted "No commands yet. Run a command from the Command Center." --text-xs --fg-muted

CONNECTION STATES — handle each distinctly:
- Connecting (initial): terminal shows animated ASCII-art spinner + "Connecting to ws://localhost:4001..." in cyan
- Connected: emerald dot + latency, terminal prompt active
- Reconnecting (after drop): amber dot + "Reconnecting in Xs..." + retry counter "Attempt 3/∞"
- Failed (after 5 retries): rose dot + "Connection failed" + "Try again" primary button + "View logs" link

SESSION LIFECYCLE — handle:
- Creating: tab shows "Session ts_xxx..." with spinner, terminal area shows "Initializing..." 
- Active: as designed above
- Closed: tab fades to muted, "Reopen" action in tab menu
- Error: tab shows rose dot, terminal shows error message + retry

NEW SESSION FLOW:
- Click "+ New session" → opens small Dialog: session name (auto-filled from agent+timestamp, editable), agent picker (reuses top dropdown), workspace picker (reuses top dropdown), color tag (8 presets for tab visual distinction)
- On create: new tab animates in (slide from right + fade), terminal area transitions

KEYBOARD:
- Ctrl+Shift+T: new session
- Ctrl+Shift+W: close session
- Ctrl+Tab: next session, Ctrl+Shift+Tab: previous
- Ctrl+1..9: jump to session N
- All standard xterm shortcuts work inside terminal

CONSTRAINTS: xterm.js theme must match palette; web links in terminal open in new tab; search highlights matches; prefers-reduced-motion disables connection pulse and tab slide; max-width 1800px container.

Deliverable: files modified, xterm theme config file, layout sketch, 1-paragraph rationale citing skill rules.