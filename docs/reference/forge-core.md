# Reference: forge-core (Methodology Package)

> **Status:** ✅ Canonical — Rule 9 source of truth for skills/agents/commands
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/packages/forge-core/`
> **Last updated:** 2026-06-30
> **Constitutional rule:** R9 (forge-core is canonical)

---

## Purpose

`forge-core` is the **canonical methodology package** for Forge AI Agent OS. It contains all `forge-*` skills, agents, commands, and workflow methodology. The frontend auto-discovers them — never hardcode lists in `apps/forge`.

This document is the **reference for the package itself**, not for any specific command. For per-command docs, see `/docs/features/command-center.md`.

---

## Source of truth

- **This file** — `/docs/reference/forge-core.md`
- **Package location** — `packages/forge-core/`
- **Package CLAUDE.md** — `packages/forge-core/CLAUDE.md`
- **Loader** — `apps/forge/lib/forge-core/loader.ts` (auto-discovers commands)
- **UI consumer** — Command Center (`/forge-command-center`) + ⌘K palette

---

## Package structure

```
packages/forge-core/
├── .claude-plugin/              # Plugin metadata (marketplace manifest)
├── bin/                         # CLI entrypoints
├── capabilities/                # Per-CLI integrations (claude, codex, copilot, ...)
│   ├── claude/                  # Claude Code integration
│   ├── codex/                   # OpenAI Codex integration
│   ├── copilot/                 # GitHub Copilot integration
│   ├── antigravity/             # Antigravity CLI integration
│   ├── augment/                 # Augment Code integration
│   └── ...                      # 30+ capabilities
├── agents/                      # Agent specs (12+ agents)
├── commands/forge/              # 69 forge-* command specs
├── workflows/                   # Workflow methodology
├── contexts/                    # Context files
├── templates/                   # Document templates
└── references/                  # Reference docs
```

---

## Why this package exists (R9)

**The problem:** Without a canonical source for skills/agents/commands:
- Different UIs duplicate the same command list (Command Center, ⌘K palette, Co-pilot tool picker, Agents registry, ...)
- Drift: each list updates differently
- New commands have to be added in 4+ places
- Renames break some surfaces, not others

**The solution:** `forge-core` is the **single source of truth**. The UI auto-discovers commands from the package at build time. Add a command once; it shows up everywhere.

**The rule (R9):**

> "When you add a skill here, the UI auto-discovers it. Never hardcode lists in `apps/forge`."

---

## Commands (69 total)

All commands live in `packages/forge-core/commands/forge/` and follow the naming pattern `^forge-[a-z][a-z0-9-]*$` (validated at import time; fails fast on invalid names).

### 13 categories

The Command Center groups commands into **13 categories**:

| Category | Examples |
|---|---|
| **Plan** | `forge-new-project`, `forge-new-milestone`, `forge-plan-phase`, `forge-spec-phase` |
| **Execute** | `forge-execute-phase`, `forge-phase`, `forge-discuss-phase` |
| **Validate** | `forge-code-review`, `forge-validate-phase`, `forge-eval-review` |
| **Test** | `forge-add-tests`, `forge-secure-phase`, `forge-audit-uat` |
| **Ship** | `forge-ship`, `forge-pr-branch`, `forge-complete-milestone` |
| **Audit** | `forge-audit-milestone`, `forge-audit-fix`, `forge-audit-uat` |
| **Capture** | `forge-capture`, `forge-mempalace-capture`, `forge-mempalace-recall` |
| **Workspace** | `forge-workspace`, `forge-thread`, `forge-progress` |
| **Inbox** | `forge-inbox`, `forge-surface`, `forge-review-backlog` |
| **Settings** | `forge-settings`, `forge-config`, `forge-update` |
| **Manager** | `forge-manager`, `forge-stats`, `forge-health` |
| **Autonomous** | `forge-autonomous`, `forge-fast`, `forge-quick` |
| **Helpers** | `forge-help`, `forge-debug`, `forge-sketch`, `forge-spike` |

### Full command list (69)

```
add-tests                       code-review                    debug
ai-integration-phase            complete-milestone             discuss-phase
audit-fix                       config                         docs-update
audit-milestone                 eval-review                    execute-phase
audit-uat                       explore                        extract-learnings
autonomous                      fast                           forensics
capture                         graphify                       health
cleanup                         help                           import
inbox                           ingest-docs                    manager
map-codebase                    mempalace-capture              mempalace-recall
milestone-summary               mvp-phase                      new-milestone
new-project                     ns-context                     ns-ideate
ns-manage                       ns-project                     ns-review
ns-workflow                     pause-work                     phase
plan-phase                      plan-review-convergence        pr-branch
profile-user                    progress                       quick
resume-work                     review                         review-backlog
secure-phase                    settings                       ship
sketch                          spec-phase                     spike
stats                           surface                        thread
ui-phase                        ui-review                      ultraplan-phase
undo                            update                         validate-phase
verify-work                     workspace                      workstreams
```

### Sample command (`forge-code-review.md`)

```yaml
---
name: forge:code-review
description: Review source files changed during a phase for bugs, security issues, and code quality problems
argument-hint: "<phase-number> [--depth=quick|standard|deep] [--files file1,file2,...] [--fix [--all] [--auto]]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Agent
requires: [config, import, phase, quick, review]
---

<objective>
Review source files changed during a phase for bugs, security vulnerabilities, and code quality problems.

Spawns the forge-code-reviewer agent to analyze code at the specified depth level. Produces REVIEW.md artifact in the phase directory with severity-classified findings.
</objective>
```

---

## Agents (12+)

Located in `packages/forge-core/agents/`:

| Agent | Purpose |
|---|---|
| `pm-agent` | Product Manager agent (delegated to forge-pi for scoring) |
| `qa-agent` | Visual QA agent (delegated to forge-browser) |
| `canary-agent` | Post-deploy smoke testing (delegated to forge-browser) |
| `forge-code-reviewer` | Code review at quick/standard/deep depth |
| `forge-code-fixer` | Auto-apply fixes from code review |
| `forge-planner` | Phase planning + roadmap |
| ... | ... |

**Note:** Some agents in `forge-core/agents/` are **specifications only**; the actual implementation lives in `forge-pi` (R10) or `forge-browser` (R11). The core package owns the contract; the implementation package owns the runtime.

---

## Capabilities (30+ CLI integrations)

Located in `packages/forge-core/capabilities/`:

| Capability | Purpose |
|---|---|
| `claude/` | Claude Code integration (slash commands, hooks) |
| `codex/` | OpenAI Codex integration |
| `copilot/` | GitHub Copilot integration |
| `antigravity/` | Antigravity CLI |
| `augment/` | Augment Code |
| `cline/` | Cline CLI |
| `codebuddy/` | Codebuddy |
| `kilo/` | Kilo CLI |
| `gemini/` | Gemini CLI |
| `kimi/` | Kimi CLI |
| ... | ... |

**Each capability is a thin wrapper** that translates `forge-*` commands into the CLI's native format. The UI auto-detects which CLI the user has installed.

---

## Workflows (methodology)

Located in `packages/forge-core/workflows/`. These are **specifications** for how agents coordinate:

- `code-review.md` — depth levels, fix iteration loop, REVIEW.md output
- `phase.md` — phase lifecycle (Plan → Execute → Validate → Ship)
- `milestone.md` — milestone structure + transition rules
- `inbox.md` — pending work triage

**Workflows are not executable code.** They're Markdown specs that guide agent behavior.

---

## Auto-discovery (frontend)

### Loader (`apps/forge/lib/forge-core/loader.ts`)

```typescript
// apps/forge/lib/forge-core/loader.ts
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const COMMANDS_DIR = path.join(
  process.cwd(),
  'packages/forge-core/commands/forge',
);

export async function loadCommands(): Promise<ForgeCommand[]> {
  const files = fs.readdirSync(COMMANDS_DIR);
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(COMMANDS_DIR, f), 'utf-8');
      const { data, content } = matter(raw);

      // Validate name pattern
      const name = data.name as string;
      if (!/^forge-[a-z][a-z0-9-]*$/.test(name)) {
        throw new Error(`Invalid command name: ${name}`);
      }

      return {
        name,
        description: data.description,
        category: inferCategory(name),
        allowedTools: data['allowed-tools'] ?? [],
        requires: data.requires ?? [],
        body: content,
      };
    });
}
```

**Validation:** The regex `^forge-[a-z][a-z0-9-]*$` is enforced at import time. Invalid names fail fast.

### UI consumption

```typescript
// apps/forge/components/command-center/CommandPalette.tsx
import { loadCommands } from '@/lib/forge-core/loader';

export async function CommandPalette() {
  const commands = await loadCommands();  // 69 commands from forge-core
  // Render in ⌘K palette + categorize by 13-category inference
  return <CommandList commands={commands} />;
}
```

**Zero duplication.** Add a command to `packages/forge-core/commands/forge/foo.md`; it appears in ⌘K, Co-pilot tool picker, Command Center list — automatically.

---

## Categories inference

The loader infers categories from command name prefixes:

```typescript
function inferCategory(name: string): string {
  if (name.startsWith('forge-plan') || name.startsWith('forge-spec')) return 'Plan';
  if (name.startsWith('forge-execute') || name === 'forge-phase') return 'Execute';
  if (name.startsWith('forge-code-review') || name.startsWith('forge-validate')) return 'Validate';
  if (name.startsWith('forge-add-tests') || name.startsWith('forge-secure')) return 'Test';
  if (name.startsWith('forge-ship') || name.startsWith('forge-pr')) return 'Ship';
  if (name.startsWith('forge-audit')) return 'Audit';
  if (name.startsWith('forge-capture') || name.startsWith('forge-mempalace')) return 'Capture';
  if (name.startsWith('forge-workspace') || name.startsWith('forge-thread')) return 'Workspace';
  if (name.startsWith('forge-inbox') || name.startsWith('forge-surface')) return 'Inbox';
  if (name.startsWith('forge-settings') || name.startsWith('forge-config')) return 'Settings';
  if (name.startsWith('forge-manager') || name.startsWith('forge-stats')) return 'Manager';
  if (name.startsWith('forge-autonomous') || name === 'forge-fast') return 'Autonomous';
  return 'Helpers';
}
```

---

## Adding a new command

### Step 1: Create the spec

```bash
# Create packages/forge-core/commands/forge/foo-bar.md
touch packages/forge-core/commands/forge/foo-bar.md
```

### Step 2: Write the YAML frontmatter + body

```markdown
---
name: forge:foo-bar
description: One-line description for ⌘K palette + tool picker
argument-hint: "<required-arg> [--optional-flag]"
allowed-tools:
  - Read
  - Write
requires: [config, import]
---

<objective>
What this command does in detail.
</objective>

<execution_context>
@~/.claude/forge-core/workflows/foo-bar.md
</execution_context>

<process>
1. Parse args
2. ...
</process>

<output_format>
Where the output goes (file path, JSON shape, etc.)
</output_format>
```

### Step 3: Validate

```bash
pnpm tsx scripts/validate-forge-commands.ts
```

The validator checks:
- Name matches `^forge-[a-z][a-z0-9-]*$`
- Required fields present
- Body sections (`<objective>`, `<execution_context>`, etc.) defined
- No duplicate names

### Step 4: Verify auto-discovery

```bash
pnpm dev
# Open ⌘K palette → search "foo" → forge:foo-bar appears
# Open Command Center → check category
# Trigger via Co-pilot tool picker
```

**That's it.** The command is available everywhere via auto-discovery.

---

## White-label boundary (DL-024)

`forge-core` may contain internal references to `gsd:*` (the underlying engine). Per DL-024, **users never see these**. The `FORGE_COMMAND_MAP` in `backend/app/services/forge_commands.py` translates:

```python
# backend/app/services/forge_commands.py
FORGE_COMMAND_MAP = {
    "forge:code-review": "gsd:phase:review",
    "forge:ship": "gsd:milestone:complete",
    "forge:plan-phase": "gsd:phase:plan",
    # ... 63 entries across 13 categories
}
```

If a log line, error message, or audit record ever references the internal command, it uses `gsd:<area>:<verb>` (still opaque to users). The forge layer is the user-facing abstraction.

---

## Versioning

`forge-core` is versioned separately from the main app:

```bash
# packages/forge-core/package.json
{
  "name": "@forge-ai/forge-core",
  "version": "1.2.3",
  "description": "Forge methodology package — skills, agents, commands, workflows"
}
```

**SemVer:**
- **MAJOR** — breaking changes to command signatures
- **MINOR** — new commands, new agents, new capabilities
- **PATCH** — bug fixes, doc updates, refactor

**Main app pins to a specific version:**

```json
// apps/forge/package.json
{
  "dependencies": {
    "@forge-ai/forge-core": "1.2.3"
  }
}
```

---

## Related packages (R10, R11)

### `forge-pi` — Product Intelligence

Powers: codebase scanning, KG construction, idea scoring, customer-voice clustering, market-signal processing, PRD generation, architecture-diagram auto-gen, API-contract discovery.

**Rule (R10):** If a UI feature claims to ingest a codebase, score an idea, or build a knowledge graph, it MUST delegate to `forge-pi`. Never reimplement in `apps/forge`.

See: `/docs/reference/forge-core.md` (this file has cross-refs only)

### `forge-browser` — Visual Automation

Powers: visual regression testing, post-deploy smoke testing, UAT automation, WCAG accessibility audits, the QA Agent, the Canary Agent.

**Rule (R11):** If a UI feature claims to take screenshots, compare pixels, or run a11y checks, it MUST delegate to `forge-browser`. Never reimplement in `apps/forge`.

---

## Verification checklist (per command)

- [ ] Name matches `^forge-[a-z][a-z0-9-]*$`
- [ ] Description is one line, ≤ 200 chars
- [ ] `argument-hint` declared
- [ ] `allowed-tools` enumerated
- [ ] `requires` lists dependencies
- [ ] `<objective>`, `<execution_context>`, `<process>`, `<output_format>` sections present
- [ ] No duplicate name
- [ ] Validator passes
- [ ] Auto-discovered in ⌘K + Command Center + Co-pilot tool picker
- [ ] White-label boundary respected (no `gsd:*` references in UI surface)

---

## Related docs

- [Standards: architecture-rules](../standards/architecture-rules.md) — R9, R10, R11
- [Product: vision](../product/vision.md) — 3-package architecture
- [Product: architecture-summary](../product/architecture-summary.md) — High-level diagram
- [Features: command-center](../features/command-center.md) — UI consumer
- [Reference: litellm-bridge](./litellm-bridge.md) — Endpoint map
- [Reference: api-catalog](./api-catalog.md) — Every route
- [Reference: db-schema](./db-schema.md) — Every table

---

**`forge-core` is the contract. The UI auto-discovers it. R9 keeps it honest.**