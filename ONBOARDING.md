# Welcome to Forge AI Team

## How We Use Claude

Based on arunachalam v's usage over the last 30 days (138 sessions):

Work Type Breakdown:
  Build Feature       ████████░░░░░░░░░░░░  42%
  Debug Fix           █████░░░░░░░░░░░░░░░░  25%
  Improve Quality     ████░░░░░░░░░░░░░░░░░  21%
  Plan Design         ██░░░░░░░░░░░░░░░░░░░  12%

Top Skills & Commands:
  /goal               ████████████████████  80x/month
  /clear              ███████████████░░░░░  60x/month
  /plan               ████░░░░░░░░░░░░░░░░  15x/month
  /gsd-manager        ██░░░░░░░░░░░░░░░░░░░   8x/month
  /gsd-new-project    █░░░░░░░░░░░░░░░░░░░░   4x/month
  /ultrawork          ░░░░░░░░░░░░░░░░░░░░░   3x/month
  /gsd-help           ░░░░░░░░░░░░░░░░░░░░░   3x/month
  /plugin             ░░░░░░░░░░░░░░░░░░░░░   3x/month

Top MCP Servers:
  next-devtools       ████████████████████  69 calls
  serena              ███░░░░░░░░░░░░░░░░░░  11 calls
  context7            ██░░░░░░░░░░░░░░░░░░░   7 calls

## Your Setup Checklist

### Codebases
- [ ] forge-ai — https://github.com/anisharunadev/forge-ai

### MCP Servers to Activate
- [ ] next-devtools — Live query of the running Next.js dev server: build errors, route map, server actions, page metadata, dev logs. Get access by running `pnpm --filter forge-dashboard dev` first; the `.mcp.json` registers the server automatically per CLAUDE.md scope rules.
- [ ] serena — Symbol-level codebase navigation (find declarations, references, implementations) plus memory store for cross-session notes. Activated via `.mcp.json`; check the Serena Instructions Manual with `mcp__serena__initial_instructions` on first use.
- [ ] context7 — Pulls version-accurate docs from Context7 for any library/framework mentioned in code (Next.js, React, Tailwind, etc.). Use `resolve-library-id` → `query-docs` workflow.

### Skills to Know About
- `/goal` — Paste a goal markdown and start implementing it; the dominant pattern in this repo (80×/month). Look in `docs/goals/step-*.md`.
- `/plan` — Plan before code; called 15×/month.
- `/gsd-manager` / `/gsd-new-project` / `/gsd-help` — GSD spec-driven methodology orchestrators. The team's primary workflow.
- `/gsd-execute-phase`, `/gsd-plan-phase`, `/gsd-verify-work` — Core phase lifecycle skills.
- `/clear` — Used heavily (60×/month) to reset context between unrelated tasks.
- `/ultrawork` — Autonomous multi-agent run mode; exit cleanly with `/oh-my-claudecode:cancel`.

## Team Tips

The team is organized by area of ownership — pick one (or more) based on what you want to ship. The sub-team boundaries map to the upcoming Integration Phases (Phase 2 → Phase 13) and the `/goal` workflow against `docs/goals/step-*.md`.

- **Front-end team** — owns `apps/forge` (Next.js 16, React 19, Tailwind 3.4). Dashboard, Co-pilot, Command Center, all UI surfaces. Heavy `/goal` usage lives here. Use `next-devtools` MCP to query the running dev server first when debugging.
- **Back-end team** — owns `backend/` (Python 3.13, FastAPI, SQLAlchemy 2 async, Pydantic v2, httpx). API endpoints, integrations, audit, governance, observability. Rule 1: never import `openai`/`anthropic`/`google.generativeai`/etc. — all LLM traffic flows through LiteLLM Proxy via `app/core/llm.py`.
- **Documentation team** — owns `docs-site/` (Astro + Starlight, dark theme). Rule 18: every feature needs a docs page; CI fails if `scripts/check-feature-docs.sh` exits non-zero.
- **Integration team** — owns `mcp-servers/` (GitHub, Jira, Figma, AWS, Slack, SonarQube, Databricks, Kiro, etc.). Runtime adapters invoked by agents, not registered in `.mcp.json` (that's dev-only tooling).
- **Platform team** — owns `packages/forge-core/`, `packages/forge-pi/`, `packages/forge-browser/` (the 3-package spec-driven architecture). Skills, agents, and commands live here and are auto-discovered by the UI (Rule 9). UI surfaces must read from here — never hardcode lists.
- **Infrastructure team** — owns `infra/` (Docker Compose, Terraform AWS, GitHub Actions, floci S3 emulator). Owns deployment, CI, observability stack.

**Cross-cutting rules every sub-team owns together:** Rule 2 (every query scoped to `tenant_id` + `project_id`), Rule 3 (no auto-cross of Architecture/Security/Deployment gates), Rule 6 + 7 (audit + observability are day-one, not deferrable).

## Get Started

1. Pick the sub-team you want to join (see Team Tips above) — your pick shapes which `CLAUDE.md` to read first (`apps/forge/CLAUDE.md` or `backend/CLAUDE.md`).
2. Read `.claude/CLAUDE.md` end-to-end — Rules 1–18 are constitutional; skim especially Rule 2 (multi-tenancy), Rule 9 (forge-core is canonical), Rule 12 (FAB + ⌘K must work everywhere), Rule 18 (every feature needs docs).
3. Bring the local stack up: `docker compose up -d postgres redis floci` → `cd backend && alembic upgrade head && uvicorn app.main:app --reload` → `pnpm --filter forge-dashboard dev`.
4. Run `pnpm --filter forge-dashboard test && pnpm --filter forge-dashboard typecheck` to confirm the baseline passes before you change anything.
5. Look at `docs/goals/step-*.md` for the next open phase and `/goal` it.

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->