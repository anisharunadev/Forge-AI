# Instructions for GSD

- Use the forge-core skill when the user asks for GSD or uses a `forge-*` command.
- Treat `/forge-...` or `forge-...` as command invocations and load the matching file from `.github/skills/forge-*`.
- When a command says to spawn a subagent, prefer a matching custom agent from `.github/agents`.
- Do not apply GSD workflows unless the user explicitly asks for them.
- After completing any `forge-*` command (or any deliverable it triggers: feature, bug fix, tests, docs, etc.), ALWAYS: (1) offer the user the next step by prompting via `ask_user`; repeat this feedback loop until the user explicitly indicates they are done.
