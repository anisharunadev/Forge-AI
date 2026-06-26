Forge AI — Design Vision Prompt (Curated)
Role: Lead Product Designer, Forge AI Mission: Define the visual, interaction, and system language for an AI-powered Software Delivery Operating System — not a project management tool.

1. Positioning
Forge AI orchestrates multiple AI agents across the entire SDLC: Idea → PRD → Architecture → Tasks → Development → Testing → Review → Deployment.

The moment a user opens Forge, they should perceive five things without being told:

AI is working for them
Work is autonomous
Agents are collaborating
Delivery is accelerating
Everything is observable
One-line brief: Mission control for an engineering org where AI is the team.

2. Brand Personality
Trait	What it means	What it is NOT
Intelligent	Quietly smart, anticipates needs	Flashy, gimmicky
Technical	Engineer-native, no hand-holding	Jargon-bloated, condescending
Premium	Enterprise-grade polish	Sterile, corporate
Fast	Sub-200ms perceived interactions	Sluggish, decorative
Autonomous	User supervises, agents execute	Wizard-heavy, form-heavy
Futuristic	Feels 2 years ahead	Sci-fi cosplay, neon overload
3. Visual DNA — The Reference Quartet
Blend signals from these four, no more:

Linear — spacing, navigation, hierarchy, keyboard-first feel
Vercel — minimalism, typography, restraint, deployment-grade confidence
GitHub — developer workflow patterns, PR / issue mental models
Cursor + Anthropic Console — AI-native interactions, agent-centric surfaces, streaming reasoning
The vibe check for every screen: Would this feel at home next to Linear, Cursor, GitHub, and Vercel? If no, redesign.

4. Design Principles
4.1 Information First
No decorative UI. Every pixel earns its place.

❌ Giant hero sections
❌ Oversized cards
❌ Decorative gradients
❌ Empty-state illustrations that say nothing
4.2 Density With Clarity
Engineers want signal. Optimize for high signal-to-noise.

Tables over cards when data is dense
Inline detail over drill-down where possible
Status is always visible — never hidden behind a click
4.3 Dark Mode First
Forge is used all day. Dark mode is the primary experience; light mode is the companion. Design dark first, derive light second.

4.4 AI Native
The system is alive. At any moment, the user should see:

Which agents are running
What they are thinking (reasoning summary)
Current execution state
Progress, confidence, cost, context
5. Design Tokens
5.1 Color — Dark (Primary)
text

Copy
Background:    #09090B

Surface:       #111113

Card:          #18181B

Border:        #27272A

Hover:         #1F1F23


Text:          #FAFAFA

Muted:         #A1A1AA

Subtle:        #71717A


Primary:       #6366F1   /* user actions, selection, links */

Agent:         #06B6D4   /* agent identity */

Execution:     #8B5CF6   /* running work */

Review:        #F97316   /* human / AI review */

Success:       #22C55E

Warning:       #F59E0B

Error:         #EF4444
5.2 Color — Light (Companion)
Same hues, surfaces flipped:

text

Copy
Background:    #FFFFFF

Surface:       #F8F8FA

Card:          #FFFFFF

Border:        #E4E4E7

Text:          #09090B

Muted:         #52525B
5.3 Typography
Sans (UI): Inter Variable — 13/14px base, 1.5 line-height
Mono (code, IDs, tokens): JetBrains Mono
Display: Inter, weight tracking tightened
Type scale (1.25 modular): 12, 13, 14, 16, 20, 24, 32, 48
5.4 Spacing & Radius (4px base)
Spacing: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64
Radius: Controls 6px · Cards 8px · Modals 12px
5.5 Motion
Micro: 150ms ease-out
Standard: 200ms ease-out
State change: 250ms ease-out
No bounces, no springs > 0.8, no motion > 400ms
Rule: motion communicates state, never decorates
6. Agent Status Language
State	Color	Glyph	Pulse
Idle	#71717A Gray	○	none
Thinking	#3B82F6 Blue	◐	slow
Executing	#8B5CF6 Violet	●	active
Reviewing	#F97316 Orange	◑	slow
Completed	#22C55E Green	✓	none
Failed	#EF4444 Red	✕	fast → static
Use this language everywhere — sidebar, headers, cards, feeds, charts. Consistency is the brand. Status is always paired with icon + label, never color alone.

7. Core Screens
7.1 Dashboard — AI Command Center
Mission control, not a report.

Widgets (high signal, low chrome):

Active Agents — live count + avatars
Running Tasks — real-time list
Delivery Velocity — 7 / 30 / 90-day trend
AI Utilization — tokens, cost, % autonomy
Open Risks + Blockers — actionable, click-to-triage
Sprint Health — one composite score
7.2 Agent Workspace — the heart of the product
Each agent surfaces as a living worker, not a card.

Per-agent panel:

Avatar + name + role
Status (color + glyph + pulse)
Current task + progress bar
Reasoning summary (streamed, expandable)
Token usage (input / output / cost)
Execution logs (collapsible, searchable)
Dependencies (upstream / downstream agents)
7.3 SDLC Pipeline
Horizontal flow: Idea → PRD → Architecture → Tasks → Development → Testing → Review → Deployment

Each stage shows: completion %, owner agent, status, blockers, time-in-stage.

7.4 Story Workspace
Linear-inspired. Single source of truth per story. Sections: Details · Requirements · Design · Tasks · Code Changes · PR Status · Agent Discussion

7.5 Agent Chat
Cursor-inspired. Chat is a work surface, not a help widget.

Streaming responses with token-level cursor
Tool execution inline (collapsed by default, expandable)
Artifacts (code, files, PRs) inline as cards
Reasoning summary always visible — never hidden in a tab
Cost meter pinned in the header
8. Component Library
Component	Purpose
AgentCard	Compact agent identity + state
AgentTimeline	Chronological activity per agent
ExecutionGraph	DAG of agent dependencies
CostTracker	Real-time token + dollar burn
DeliveryHealth	Composite org-health score
SprintVelocity	Trend over time, no pie
AgentActivityFeed	Global firehose, filterable
WorkflowVisualizer	SDLC pipeline as live canvas
ReasoningPanel	Collapsible agent thought stream
TaskDependencyMap	Interactive dependency graph
CommandPalette	⌘K — global, everywhere
StatusPill	Agent / task state with color + glyph + pulse
9. Navigation
text

Copy
Dashboard

Agents

  ├─ Active

  ├─ Registry

  └─ Templates

Projects

Stories

Workflows

Knowledge

Artifacts

Analytics

Settings
Persistent left rail. Collapsible. Keyboard-driven. Active route always indicated.

10. Interaction Patterns
Command Palette (⌘K) — the primary navigation surface, available everywhere
Global Search — stories, tasks, agents, code, documents
Keyboard Shortcuts — every power action has one; surfaced in a cheat sheet
Streaming — every AI output streams with a cursor; no spinners > 200ms
Optimistic UI — actions feel instant; failures correct silently
11. Data Visualization
Prefer: timelines, trend lines, flow diagrams, execution graphs, sparklines. Avoid: pie charts, donuts, 3D, dashboard clutter, more than 2 y-axes.

Every chart is interactive: hover for exact values, click to drill in.

12. Accessibility
WCAG 2.2 AA — contrast, focus rings, motion-reduce
Keyboard-first: every action reachable without a mouse
Full screen reader support with semantic regions
prefers-reduced-motion honored globally
Status colors always paired with icon + text label (never color alone)
13. Definition of Done
A screen is "done" only when all of these pass:

1.
✅ Dark mode feels primary, not adapted
2.
✅ Every AI state is visible without clicking
3.
✅ No decorative element survives a 5-second audit
4.
✅ A power user can drive it keyboard-only
5.
✅ It would not look out of place beside Linear, Cursor, GitHub, or Vercel
6.
✅ Density is ~2x the information of a typical SaaS dashboard at the same size
7.
✅ Cost, progress, and confidence are always visible when an agent is active
14. Deliverables
1.
forge-design-system.md — principles + token overview
2.
forge-theme-system.md — theming architecture
3.
forge-color-tokens.ts — color scale + semantic mapping
4.
forge-typography.ts — type scale + font stack
5.
forge-spacing.ts — spacing, radius, elevation
6.
forge-dark-theme.ts — dark token export
7.
forge-light-theme.ts — light token export
8.
forge-component-library.md — every component with API, states, anatomy
9.
forge-screen-redesign.md — per-screen redesign spec with wireframes
10.
forge-ui-modernization-report.md — before / after, rationale, vibe-check pass
Then: refactor the application screen by screen until Forge AI feels like a world-class AI engineering platform. Never ship a generic admin dashboard.

15. Anti-Patterns (auto-reject if seen)
Pie / donut / 3D charts
"Welcome to your dashboard" hero with stock illustration
Gradient mesh backgrounds
Cards with title + 3-line subtitle + "View more" button
Color-only state indicators
Spinners > 200ms where streaming is possible
Modal stacks deeper than 2 levels
Empty states without a next action