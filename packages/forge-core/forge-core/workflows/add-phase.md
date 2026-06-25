<purpose>
Add a new integer phase to the end of the current milestone in the roadmap. Automatically calculates next phase number, creates phase directory, and updates roadmap structure.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse the command arguments:
- All arguments become the phase description
- Example: `/forge-add-phase Add authentication` → description = "Add authentication"
- Example: `/forge-add-phase Fix critical performance issues` → description = "Fix critical performance issues"

If no arguments provided:

```
ERROR: Phase description required
Usage: /forge-add-phase <description>
Example: /forge-add-phase Add authentication system
```

Exit.
</step>

<step name="init_context">
Load phase operation context:

```bash
_GSD_SHIM_NAME="forge-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"; if [ -f "$GSD_TOOLS" ]; then forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif command -v forge-tools >/dev/null 2>&1; then GSD_TOOLS="$(command -v forge-tools)"; forge_run() { "$GSD_TOOLS" "$@"; }; elif [ -f "$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: forge-tools.cjs not found at $GSD_TOOLS and forge-tools is not on PATH. Run: npx -y @forge-ai/forge-core@latest --claude --local" >&2; exit 1; fi; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi
INIT=$(forge_run query init.phase-op "0")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Check `roadmap_exists` from init JSON. If false:
```
ERROR: No roadmap found (.planning/ROADMAP.md)
Run /forge:new-project to initialize.
```
Exit.
</step>

<step name="add_phase">
**Delegate the phase addition to `forge-tools.cjs query phase.add`:**

```bash
RESULT=$(forge_run query phase.add "${description}")
```

The CLI handles:
- Finding the highest existing integer phase number
- Calculating next phase number (max + 1)
- Generating slug from description
- Creating the phase directory (`.planning/phases/{NN}-{slug}/`)
- Inserting the phase entry into ROADMAP.md with Goal, Depends on, and Plans sections

Extract from result: `phase_number`, `padded`, `name`, `slug`, `directory`.
</step>

<step name="update_project_state">
Update STATE.md to reflect the new phase:

1. Read `.planning/STATE.md`
2. Under "## Accumulated Context" → "### Roadmap Evolution" add entry:
   ```
   - Phase {N} added: {description}
   ```

If "Roadmap Evolution" section doesn't exist, create it.
</step>

<step name="completion">
Present completion summary:

```
Phase {N} added to current milestone:
- Description: {description}
- Directory: .planning/phases/{phase-num}-{slug}/
- Status: Not planned yet

Roadmap updated: .planning/ROADMAP.md

---

## ▶ Next Up — [${PROJECT_CODE}] ${PROJECT_TITLE}

**Phase {N}: {description}**

`/clear` then:

`/forge:plan-phase {N}`

---

**Also available:**
- `/forge-add-phase <description>` — add another phase
- Review roadmap

---
```
</step>

</process>

<success_criteria>
- [ ] `forge-tools.cjs query phase.add` executed successfully
- [ ] Phase directory created
- [ ] Roadmap updated with new phase entry
- [ ] STATE.md updated with roadmap evolution note
- [ ] User informed of next steps
</success_criteria>
