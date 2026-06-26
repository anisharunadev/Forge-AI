/goal

Modernize the Project Onboarding wizard in Forge AI Agent OS. Tokens, shell, empty states, and Steps 7–8 are done. Read .claude/design-system/ first.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-step wizard form progress dark mode" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "wizard step indicator form validation contextual help sidebar" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error warning banner inline form validation" --domain ux-guideline -f markdown

Adopt every rule. Then build:

SCOPE: src/app/(workspace)/onboarding/page.tsx. Keep route. Rebuild as a 6-step wizard.

LAYOUT (2-column on desktop ≥1280px: form left 60%, "What's happening" right 40%; stacked <1024px):

WARNING BANNER (full width, conditional — only when backend stub is unreachable):
- bg rgba(245, 158, 11, 0.08), border 1px rgba(245, 158, 11, 0.30), --radius-lg, p-16px
- Left: TriangleAlert icon in --accent-amber
- Title "Orchestrator stub not running" --text-sm font-500 --fg-primary
- Body "The wizard can collect your inputs, but the final Confirm step has no backend to provision against. Start the dev orchestrator stub on http://localhost:4000 to enable project creation. or run the full stack: pnpm dev:stack" --text-xs --fg-secondary
- Inline code chips: "pnpm dev:stub" and "pnpm dev:stack" each as a copyable kbd-style pill (lucide Copy icon on hover)
- Right: dismiss X icon

STEP HEADER (below banner):
- Eyebrow "CENTER" --text-xs --fg-tertiary
- h1 "Project Onboarding" --text-3xl font-700 with a Compass icon
- "Step 1: Tenant setup — Name, region, and tenant-level policies." --text-sm --fg-secondary

PROGRESS BAR (full width):
- Track: --bg-inset, --radius-full, h-2
- Fill: animated gradient (indigo → violet → cyan), --radius-full, h-2, transition 400ms
- Above bar: left "STEP 1 OF 6" --text-xs --fg-tertiary uppercase tracking-widest, right "0%" --text-xs --fg-tertiary
- STEP NODES: 6 numbered chips below the bar, connected by lines. States: completed (emerald check, --accent-emerald bg), current (--accent-primary bg, glow shadow, white text), upcoming (--bg-inset bg, --fg-tertiary text)
- Click a completed step to jump back; current and upcoming are non-interactive
- Labels under chips (only when active or on hover): "Tenant setup", "Connect repos", "Detect stack", "Configure agents", "Run first intel", "Review & confirm"

FORM AREA (left col):
- Section title "Tenant setup" --text-md font-600 + sub "Configure the tenant-level identity, region, and cost ceiling." --text-sm --fg-secondary
- Field group 2-col grid: Tenant name (Input, required, monospace) | Region (Select with searchable list of regions, "us-east-1" default)
- Field group 2-col grid: Default timezone (Select with timezone search) | Cost ceiling USD/day (Input number, prefix "$", suffix "/day", helper text below)
- Divider --border-subtle
- Toggle group: "Enable sandbox runtimes" (Switch, default on) + "Auto-quarantine unhealthy connectors" (Switch, default on)
- Each toggle: label --text-sm font-500 + helper --text-xs --fg-tertiary below

FOOTER (full width of form column):
- Left: "← Back" ghost button (disabled on step 1)
- Right: "Next →" primary button (disabled until required fields valid). Use shadcn Button with arrow icon

"HOW THIS STEP WORKS" PANEL (right col, sticky):
- bg --bg-surface, --radius-lg, p-20px, border --border-subtle
- Title "What is happening" --text-sm font-600 with a Lightbulb icon in --accent-amber
- Body "Name, region, and tenant-level policies. Tenant name appears in URL paths and audit logs. Region affects data residency." --text-sm --fg-secondary
- Numbered list of all 6 steps in --text-xs --fg-tertiary (current one bold --fg-primary)
- Optional "Tip" callout at bottom: lucide Sparkles icon + "Use a short, memorable slug — it shows up everywhere."

STEPS 2–6 CONTENT (define the schema, render dynamically):
- Step 2 Connect repos: list of connected source-control repos with status dot + "Connect new" button
- Step 3 Detect stack: read-only list of detected stacks (auto-populated), each with confidence badge + override dropdown
- Step 4 Configure agents: multi-select of agents to enable, each row has toggle + brief description
- Step 5 Run first intel: animated progress visualization (think Recharts radial bar) showing intel-gathering phases, ETA
- Step 6 Review & confirm: read-only summary card of all 5 previous steps + "Confirm & provision" primary button

CONSTRAINTS: every step persists form state in URL search params + Zustand store so refresh doesn't lose progress; field validation inline (red border + helper text) on blur; Next button enables only when valid; step transitions use Framer Motion AnimatePresence (slide left/right depending on direction); prefers-reduced-motion → no slide, just fade; max-width 1280px.

Deliverable: files modified, package additions if any (zustand, framer-motion already assumed), 1-paragraph rationale citing skill rules.