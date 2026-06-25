# Forge Core — Gemini CLI context

This context is loaded by the **forge-core Gemini CLI extension**. It gives Gemini
the operating context for [Forge Core](https://github.com/forge-ai/forge-core), a
meta-prompting, context-engineering, and spec-driven development system for AI
coding agents.

## What GSD is

GSD turns a vague goal into shipped software through an explicit,
resumable workflow: **explore → plan → execute → verify → ship**. Work is
organised into milestones and phases under a `.planning/` directory, with each
phase carrying a SPEC, a PLAN, and verification criteria. The system favours
small, atomic, test-backed commits and keeps durable context in version-tracked
files rather than in the conversation.

## The slash commands (installed separately)

> **This extension ships only the context above — not the slash commands.** It
> loads gsd's operating context into your Gemini sessions and is managed through
> `gemini extensions list / update / uninstall`. To install the `/forge:*` command
> set, agents, and hooks into `~/.gemini/`, run the dedicated installer:
>
> ```bash
> npx forge-core --gemini --global
> ```
>
> The two paths are complementary and the manual installer remains fully
> supported. The commands below are available only once that installer has run.

If you have installed the gsd commands, the workflow is driven by these `/forge:*`
slash commands (Gemini registers gsd's commands under the `gsd` namespace, so the
colon form is canonical):

- `/forge:new-project` — initialise a project and gather deep context.
- `/forge:progress` — the unified situational command: check progress, advance the
  workflow, or dispatch a freeform intent.
- `/forge:plan-phase <N>` — produce a detailed phase plan with a verification loop.
- `/forge:execute-phase <N>` — execute a phase's plans with wave-based parallelism.
- `/forge:verify-work` — validate built features through conversational UAT.
- `/forge:ship` — open a PR, run review, and prepare for merge.
- `/forge:help` — list every available command.

## Working with GSD

- Treat `.planning/` as the source of truth for project state — read it before
  acting, and keep it current as work progresses.
- Prefer the smallest change that satisfies the phase's verification criteria.
- Run the project's tests and linters before declaring a phase done.
- When unsure what to do next, and the gsd commands are installed, `/forge:progress`
  is the situational entry point.

Learn more: <https://github.com/forge-ai/forge-core>
