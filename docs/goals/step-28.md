/goal

Modernize the Ideation Center in Forge AI Agent OS — built in Step 5. The user's organization has a bigger vision now: **one-click pipeline from idea → PRD → Jira ticket → Confluence page → AI IDE execution**, with continuous ingest from multiple sources. This is the "Continuous Context Orchestration" hub shown in the user's exec deck. Read .claude/design-system/ first.

USER INTENT (from the PowerPoint slide + their brief):
- INGEST FROM: Support feedback (Zendesk, Jira Service Desk), Market & competitor signals (web intelligence), Existing tech stack & debt (Git, SonarQube)
- PROCESS VIA: Forge Ideation Agent (RAG + LLM Reasoning Engine) — with visible reasoning chain
- SYNC TO: Jira (Epics, User Stories, effort estimates), Confluence (PRD + Architecture Spec), AI IDE via MCP (executes within architecture guardrails)
- THE WOW FEATURE: "one click PRD to ticket to Confluence" — full pipeline

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "orchestration pipeline visualization ingestion sync hub dark" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI reasoning transparency chain of thought RAG explanation" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-source capture voice video text idea input" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "customer feedback clustering theme grouping ticket analysis" --domain chart -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "kanban board idea pipeline approval workflow stages" --domain style -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/ideation/page.tsx. Keep route. Rebuild with multiple new sub-views + the pipeline visualization. The 5 tabs (Ideas / Roadmap / PRDs / Architecture Previews / My Approvals) stay; ADD new tabs for Sources, Destinations, Pipeline View, Market Signals, Customer Voice.

==========================================================
ZONE 1 — HEADER (now more substantial — this is a hub)
==========================================================

HERO BAND (animated gradient border like Step 4):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Ideation Center" --text-3xl font-700 with lucide Lightbulb icon in --accent-amber
- Body "Capture ideas, score them, plan the roadmap, draft PRDs, preview architecture, and sync to Jira + Confluence + AI IDE — all from one place."
- Top-right: status cluster:
  - "Daily ingest" pill (emerald pulse + "Next in 4h 12m" OR amber + "Running now · 23%" with mini progress bar) — the scheduled job that pulls from sources
  - "+ New Idea" primary button (Plus icon) — opens capture modal (see Zone 6)
  - 3-dot menu: "Pipeline settings" + "Export all" + "Help"

==========================================================
ZONE 2 — TABS (expanded to 9)
==========================================================

TAB BAR (segmented control with horizontal scroll on overflow):
- **Pipeline** (NEW — default landing) — the orchestration overview
- **Ideas** — the kanban board (Step 5)
- **Roadmap** — timeline (Step 5)
- **PRDs** — list (Step 5)
- **Architecture Previews** — grid (Step 5)
- **My Approvals** — inbox (Step 5)
- **Sources** (NEW) — manage ingest connectors
- **Destinations** (NEW) — manage sync destinations
- **Market Signals** (NEW) — competitor + trend feed

Count badges on Ideas, PRDs, My Approvals.

==========================================================
ZONE 3 — PIPELINE TAB (new default landing)
==========================================================

The visual hub matching the user's PowerPoint. Three columns: INGEST → PROCESS → SYNC.

LAYOUT (3-column bento, mt-6, gap-4):

COLUMN 1: "WHAT FORGE INGESTS" (--bg-surface, --radius-xl, p-20px)
- Header: lucide Download icon in cyan + "WHAT FORGE INGESTS" eyebrow + count "3 active sources"
- Source cards (vertical stack):
  1. **Support feedback** card:
     - lucide Headphones icon (cyan) + "Support feedback"
     - Body "Customer tickets and feature requests from Zendesk and Jira Service Desk."
     - Status: emerald pulse + "Synced 12m ago · 247 new"
     - Mini KPI: "247 new this week · +18% vs last"
     - Hover: shows last 3 ticket topics
     - Footer: "View tickets →" + ⚙ settings
  2. **Market & competitor signals** card:
     - lucide TrendingUp icon (amber) + "Market signals"
     - Body "Web intelligence and industry shifts surfaced in real time."
     - Status: "5 new signals today"
     - Mini KPI: "5 signals · 2 high-priority"
     - Footer: "View signals →" + ⚙ settings
  3. **Tech stack & debt** card:
     - lucide Code icon (indigo) + "Tech stack & debt"
     - Body "Tech debt scores, architecture patterns, and codebase signals from Git and SonarQube."
     - Status: "Last scan 2h ago"
     - Mini KPI: "12 hot spots · 3 critical"
     - Footer: "View signals →" + ⚙ settings
- Footer of column: "+ Add source" outline button — opens source picker (Slack, Linear, Notion, custom webhook, RSS)

COLUMN 2: "FORGE IDEATION AGENT" (--bg-elevated, --radius-xl, p-24px, border 1px --accent-amber glow)
- Header: lucide Brain icon in --accent-amber (40px) + "Forge Ideation Agent"
- Subtitle: "RAG + LLM Reasoning Engine" --text-sm --fg-secondary
- Live reasoning preview (the wow feature):
  - When processing: shows current reasoning step in real time
  - Example: "Reading support tickets from Zendesk (247)... clustering by theme... surfacing 3 high-impact themes... linking to codebase signals... scoring... drafting PRD..."
  - Animated text appearing word-by-word (cyan caret, like Co-pilot streaming)
  - Progress: 3-step indicator (Cluster → Score → Draft)
- Live metrics: "3 ideas being scored · 1 PRD drafting · 0 errors"
- "Process now" primary button (Zap icon) — manually trigger ingestion + processing
- Footer: "Configure agent →" link

COLUMN 3: "SYNCS TO YOUR TOOLS" (--bg-surface, --radius-xl, p-20px)
- Header: lucide Upload icon in emerald + "SYNCS TO YOUR TOOLS" eyebrow + count "3 active destinations"
- Destination cards (vertical stack):
  1. **Jira** card:
     - lucide Trello icon (indigo) + "Jira"
     - Body "Auto-populated Epics, User Stories, and effort estimates ready for sprint planning."
     - Status: emerald check + "Connected · Last sync 4m ago"
     - Mini KPI: "12 epics · 47 stories · 3 sprints"
     - Footer: "View in Jira →" + ⚙ settings
  2. **Confluence** card:
     - lucide BookOpen icon (cyan) + "Confluence"
     - Body "PRD and Architecture Spec auto-generated from the validated concept."
     - Status: emerald check + "Connected · 8 pages generated this month"
     - Mini KPI: "8 PRDs · 3 arch specs"
     - Footer: "View in Confluence →" + ⚙ settings
  3. **AI IDE via MCP** card:
     - lucide Sparkles icon (violet) + "AI IDE via MCP"
     - Body "Picks up context-rich tickets and executes within architecture guardrails."
     - Status: cyan pulse + "3 tickets in progress"
     - Mini KPI: "3 active · 18 completed · 96% success"
     - Footer: "View runs →" + ⚙ settings
- Footer of column: "+ Add destination" outline button

CONNECTION LINES (between columns):
- Animated dashed lines from each source card → center column → each destination card
- Color: cyan (ingest) → amber (process) → emerald (sync)
- Pulse animation when data is flowing
- Hover a line: tooltip showing "23 tickets flowing · 12 PRDs drafted · 8 epics created" (live metrics)

PIPELINE STATUS BAR (full width below columns):
- Single-row status of the whole pipeline
- "🟢 Healthy · 247 ingested · 23 scored · 3 PRDs drafted · 8 synced to Jira · 3 in IDE execution"
- Click any segment → jumps to the relevant detail page

==========================================================
ZONE 4 — IDEAS TAB (enhanced from Step 5)
==========================================================

Keep the kanban board from Step 5, but ADD:

IDEA CARD — new fields:
- "Source" badge in top-right corner: shows where this idea came from (Zendesk cyan, Jira indigo, GitHub violet, Manual amber, Market signal rose)
- "Synced to" indicator at bottom: chips showing "Jira ✓ · Confluence ✓ · IDE →" — status of downstream sync
- "AI reasoning" button (lucide Brain icon) — opens a popover showing the score breakdown (see Zone 5)

IDEA DETAIL DRAWER (right slide-in, 720px):
- All Step 5 content PLUS:
- **SOURCE CARD** (where this idea came from):
  - Source type icon + name + original link
  - For tickets: original ticket title + URL + reporter + priority
  - For market signals: source URL + date + summary
- **AI REASONING CARD** (the wow feature — transparency):
  - "Why this score?" expandable section
  - Shows the LLM's chain of thought:
    - Cluster: "Grouped with 4 similar tickets about 'slow checkout'"
    - Feasibility: "Detected existing payment service — high reuse"
    - Impact: "247 affected customers · $X monthly revenue"
    - Risk: "Touches payment flow — high blast radius"
    - Final score: 8.4 / 10
  - Confidence indicator: emerald check / amber warning / rose low-confidence
- **SYNC STATUS CARD**:
  - "Jira" row: status (Created / Syncing / Failed) + link to Jira ticket + last sync time
  - "Confluence" row: status + link + last sync
  - "IDE" row: status + active runs + link
  - "Sync now" button + "Re-sync" if failed
- **PIPELINE BUTTONS** (bottom):
  - "Generate PRD" (if not done) → goes to PRD generation flow
  - "Push to Jira" → creates epic + story in Jira
  - "Generate Confluence page" → creates PRD page
  - "Send to AI IDE" → creates runnable ticket

ONE-CLICK PIPELINE (the headline feature):
- Add a big primary button on idea cards when in "Approved" status: "🚀 Send to build pipeline"
- Click → opens confirmation modal showing the full pipeline preview:
  - "This will: Generate PRD → Create Jira epic + story → Push to Confluence → Queue for AI IDE"
  - Estimated time: "2-4 minutes"
  - "Start pipeline" button
- During pipeline: progress drawer shows each step with status (success emerald check, running cyan spinner, pending muted)
- When complete: success toast with all the links

==========================================================
ZONE 5 — AI REASONING PANEL (transparency)
==========================================================

NEW COMPONENT: <ReasoningChain>
- Used in: idea detail, agent run detail, PRD preview
- Visual: vertical timeline of reasoning steps, each expandable
- Each step:
  - Step number + icon (in semantic color)
  - Title (e.g., "Clustered 4 similar tickets")
  - Content (LLM explanation, 1-3 lines)
  - Confidence badge
  - Source references (chips showing where this reasoning came from)
- Steps examples:
  1. "Read context" — "Pulled 247 Zendesk tickets from last 30 days"
  2. "Cluster by theme" — "Identified 12 themes. Top: checkout slowness (47 tickets)"
  3. "Match to codebase" — "Found existing PaymentService. 78% reusable code"
  4. "Score feasibility" — "8.2/10 — moderate complexity, 2-week estimate"
  5. "Score impact" — "8.6/10 — 247 affected customers, $X revenue"
  6. "Final score" — "8.4/10 — combined weighted"

==========================================================
ZONE 6 — NEW IDEA CAPTURE (multi-modal)
==========================================================

CAPTURE MODAL (from "+ New Idea" button):
- Dialog, --bg-elevated, max-width 640px
- Tab strip at top: Text | Paste | URL | Voice | Screen | File
- Each tab:
  - **Text**: simple textarea + AI auto-complete (suggests completing sentences)
  - **Paste**: textarea, auto-detects lists, bullets, structured content
  - **URL**: input field, paste any URL (Zendesk ticket, GitHub issue, blog post) → AI extracts the key insight
  - **Voice**: lucide Mic big button + waveform animation while recording. Transcribes in real time. "Stop" button to finish
  - **Screen**: "Record screen" button → records up to 2 min, extracts ideas + visuals
  - **File**: drag-drop zone, accepts PDF, DOCX, MD, TXT, images
- Below tabs: Title (auto-fills from content) + Description (auto-fills)
- Right side: "AI assist" toggle — when ON, AI asks clarifying questions as you type ("What's the user problem?", "What's the desired outcome?")
- Footer: "Save as draft" + "Save and score" primary buttons

VOICE CAPTURE (WOW):
- Press Mic button → browser requests mic permission
- Recording state: large pulse animation + live waveform + elapsed time
- Real-time transcription appears in textarea as you speak
- "AI detected 3 ideas in this recording" → shows extracted ideas as chips
- Click chip → expands into individual idea card

SCREEN CAPTURE (WOW):
- "Record screen" → screen share dialog
- Recording up to 2 minutes
- During recording: shows timer + "Click to mark important moment" (adds bookmark)
- After stop: AI extracts:
  - Transcript of any audio
  - Text visible on screen (OCR)
  - Detected actions (clicks, scrolls, form fills)
  - Suggests 1-3 ideas extracted from the recording
- Preview before saving

==========================================================
ZONE 7 — SOURCES TAB
==========================================================

List of configured ingest sources + ability to add new ones.

AVAILABLE SOURCES (grid of cards):
- ✅ Zendesk — connected
- ✅ Jira Service Desk — connected
- ✅ GitHub Issues — connected
- 🔌 Slack — connect button
- 🔌 Linear — connect button
- 🔌 Notion — connect button
- 🔌 Intercom — connect button
- 🔌 Custom webhook — connect button
- 🔌 RSS feeds — connect button
- 🔌 Email forwarding (ideas@yourcompany.com) — connect button

Each card shows:
- Icon + name + status (connected/disconnected)
- Last sync time + frequency
- Records ingested today / week
- "Configure" + "Disconnect" buttons
- Preview of last 3 ingested items

==========================================================
ZONE 8 — DESTINATIONS TAB
==========================================================

Same grid pattern as Sources but for output destinations:
- ✅ Jira — connected
- ✅ Confluence — connected
- ✅ AI IDE via MCP — connected
- 🔌 Slack (notifications) — connect
- 🔌 Microsoft Teams — connect
- 🔌 Email digest — connect
- 🔌 GitHub Issues (mirror) — connect

Each card: same structure as Sources.

==========================================================
ZONE 9 — MARKET SIGNALS TAB
==========================================================

Live feed of market intelligence:
- HEADER: "Market signals" + filter (All / Competitor / Trend / Tech) + "Add custom source" button
- FEED (vertical timeline):
  - Each signal: lucide icon (TrendingUp amber, Newspaper cyan, Building indigo) + title + source (TechCrunch, Hacker News, competitor blog) + date + "Why this matters for us" AI annotation
  - Click → opens detail with full article + "Generate idea from this" button (creates idea card pre-filled with the insight)
- KPI strip at top: "Signals today / This week / Actionable / Generated ideas from signals"

==========================================================
ZONE 10 — CUSTOMER VOICE TAB (NEW — wow feature)
==========================================================

Cluster view of customer feedback themes (from Zendesk + Jira + Intercom):

LAYOUT (split view):
- LEFT (40%): Theme list — clusters of related feedback
  - Each cluster: lucide MessageCircle icon + theme name + ticket count + impact score + trend arrow
  - Top themes: "Checkout slowness (47 tickets, ↑32%)", "Mobile app crashes (28, ↓8%)", "Refund flow confusing (15, ↑15%)"
  - Sort by: volume / trend / impact
- RIGHT (60%): Selected cluster detail
  - Theme name + total ticket count
  - Timeline (chart): ticket volume over last 30 days
  - Sentiment breakdown: positive / neutral / negative (Recharts PieChart or stacked bar)
  - Top 5 ticket excerpts (anonymized, just the issue text)
  - Sample customer quotes (real quotes from tickets, with permission)
  - Linked codebase signals: "Affects PaymentService.ts · Checkout flow"
  - "Convert to idea" primary button → creates idea card pre-filled with theme + excerpts

EMPTY STATE (when no customer feedback ingested):
- Illustration: lucide MessageSquare
- "Connect a customer feedback source to see themes"
- "Connect Zendesk" / "Connect Jira" / "Connect Intercom" buttons

==========================================================
ZONE 11 — KEYBOARD SHORTCUTS
==========================================================

- ⌘N: New idea
- ⌘⇧V: Voice capture
- ⌘⇧S: Screen capture
- ⌘K: Search
- ⌘⇧P: Process now (trigger agent)
- ⌘/: Show shortcuts

==========================================================
PERFORMANCE & CONSTRAINTS
==========================================================

- Use virtualization for any list > 100 items (market signals, customer themes)
- Streaming reasoning: use SSE or mock with setInterval (word-by-word appearance)
- All animations respect prefers-reduced-motion
- Daily ingest runs as background job — show status, don't block UI
- Pipeline progress: WebSocket for live updates (mock for now)
- Voice capture uses Web Speech API (browser-native, no extra library)
- Screen capture uses MediaRecorder API
- All file uploads: client-side validation, size limit 25MB
- Dark mode only
- Lucide icons throughout

==========================================================
DELIVERABLE
==========================================================

- files modified, new components in src/components/ideation/
- Sample data files for sources, destinations, market signals, customer themes
- The pipeline visualization with animated connecting lines
- One-click "Send to build pipeline" feature working end-to-end (mocked)
- Voice + screen capture wired up (browser APIs)
- <ReasoningChain> component used in 3+ places
- 1-paragraph rationale citing skill rules
- "What we deliberately did NOT change" — keep Step 5's kanban board intact, don't break existing idea data model, don't add real OAuth for sources (mock connections)