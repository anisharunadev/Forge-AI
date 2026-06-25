<purpose>
One-page newcomer-oriented tour of Forge Core. Output ONLY the `<reference>` content below. No additions.
</purpose>

<reference>
# Forge Core — Git. Ship. Done.

Plan-driven development for solo agentic work with Claude Code. Forge Core turns a vague idea into a hierarchical plan, then executes it phase by phase with state tracking and atomic commits.

## Start here (3 commands)

```text
/forge:new-project        # Greenfield: questioning → research → requirements → roadmap
/forge:plan-phase 1       # Create a detailed plan for phase 1
/forge:execute-phase 1    # Execute all plans in the phase
```

Existing codebase? Run `/forge:map-codebase` first to ground GSD in your code.

## Common commands

| Command | Purpose |
|---|---|
| `/forge:progress` | Where am I, what's next — also routes freeform intent with `--do "..."` |
| `/forge:quick` | Small ad-hoc task with GSD guarantees (planning dir + atomic commit) |
| `/forge:fast "<task>"` | Trivial inline change — no subagents, ≤3 file edits |
| `/forge:discuss-phase <N>` | Capture vision and decisions before planning |
| `/forge:debug "<symptom>"` | Persistent debug session, survives `/clear` |
| `/forge:capture` | Save an idea, todo, note, seed, or backlog item |
| `/forge:verify-work <N>` | Conversational UAT for a completed phase |
| `/forge:ship <N>` | Open a PR from a completed phase |
| `/forge:help --full` | Complete reference (every command, every flag) |

## Want more?

```text
/forge:help --brief         # 10-line refresher of top commands
/forge:help --full          # complete reference
/forge:help <topic>         # one section only — see topics below
/forge:help --brief <topic> # compact scoped lookup — signature + one-line summary
```

Topics: `workflow` · `planning` · `execute` · `quick` · `debug` · `capture` · `ship` · `config` · `milestones` · `spike` · `sketch` · `review` · `audit` · `progress`

## Update GSD

```bash
npx @forge-ai/forge-core@latest
```
</reference>
