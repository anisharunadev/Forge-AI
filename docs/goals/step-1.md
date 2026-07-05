> **Status:** completed
/goal

Modernize Forge AI Agent OS (React + TS + Next.js + Tailwind + shadcn/ui + Framer Motion + lucide-react).

STEP 1 OF 6 — DESIGN SYSTEM FOUNDATION. Do not touch layouts, pages, or components in this step. Only establish the token layer.

INVOKE THE SKILL FIRST — run all four, persist everything:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "AI agent platform developer infrastructure B2B SaaS dark mode" --design-system -p "ForgeAgentOS" --persist
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "modern dashboard sidebar typography" --domain typography -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dark mode SaaS primary palette accent" --domain color -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "admin console navigation hierarchy" --domain ux-guideline -f markdown

Read every output JSON. The skill is the source of truth — adopt its tokens, type scale, palette, and UX rules. Then augment with these mandatory additions the skill won't generate on its own:

LAYERED SURFACES — replace flat #000 with depth:
  --bg-base:     #09090B
  --bg-surface:  #131316
  --bg-elevated: #1A1A1F
  --bg-inset:    #0E0E11
  --border-subtle:  rgba(255,255,255,0.06)
  --border-default: rgba(255,255,255,0.10)
  --border-strong:  rgba(255,255,255,0.16)

TYPOGRAPHY — max 2 families (Inter UI + JetBrains Mono numbers/code):
  --text-xs 12/16, --text-sm 13/18, --text-base 14/20, --text-md 15/22,
  --text-lg 17/24, --text-xl 20/28, --text-2xl 24/32, --text-3xl 30/36
  weights: 400 / 500 / 600 / 700

SEMANTIC COLOR TOKENS — beyond just the primary:
  --fg-primary #FAFAFA, --fg-secondary #A1A1AA, --fg-tertiary #71717A, --fg-muted #52525B
  --accent-primary #6366F1 (indigo)
  --accent-cyan    #22D3EE
  --accent-emerald #10B981
  --accent-amber   #F59E0B
  --accent-rose    #F43F5E
  --accent-violet  #A855F7

RADIUS: 6 / 8 / 12 / 16. SHADOWS: sm/md/lg + indigo glow. ANIMATION: 100/200/400ms, ease-out cubic-bezier(0.16, 1, 0.3, 1).

Wire all of the above into tailwind.config.ts as theme extensions AND globals.css as CSS variables. Create src/styles/tokens.ts exporting them as TS constants for components. Update body and html to use --bg-base. Do not change any component yet — only the foundation.

Deliverable: tailwind.config.ts diff, globals.css diff, tokens.ts file, the four skill outputs saved to .claude/design-system/, one-line summary.
