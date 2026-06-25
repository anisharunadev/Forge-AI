---
name: forge-import
description: "Ingest external plans with conflict detection against project decisions before writing anything."
argument-hint: "--from <filepath> | --from-forge2"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---


<objective>
Import external plan files into the GSD planning system with conflict detection against PROJECT.md decisions.

- **--from**: Import an external plan file, detect conflicts, write as GSD PLAN.md, validate via forge-plan-checker.
- **--from-forge2**: Reverse-migrate a GSD-2 project (`.forge/` directory) back to GSD v1 (`.planning/`) format. Runs `forge-tools.cjs from-forge2`. Pass `--path <dir>` to migrate a project at a different path.
</objective>

<execution_context>
@~/.claude/forge-core/workflows/import.md
@~/.claude/forge-core/references/ui-brand.md
@~/.claude/forge-core/references/gate-prompts.md
@~/.claude/forge-core/references/doc-conflict-engine.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
If `--from-forge2` is in $ARGUMENTS:
Run the reverse-migration (append `--path <dir>` if provided):
```bash
_GSD_SHIM_NAME="forge-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"; if [ -f "$GSD_TOOLS" ]; then forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif command -v forge-tools >/dev/null 2>&1; then GSD_TOOLS="$(command -v forge-tools)"; forge_run() { "$GSD_TOOLS" "$@"; }; elif [ -f "$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: forge-tools.cjs not found at $GSD_TOOLS and forge-tools is not on PATH. Run: npx -y @forge-ai/forge-core@latest --claude --local" >&2; exit 1; fi
forge_run from-forge2
```
Present the migration result to the user.
Stop here (do not run the standard import workflow).

Otherwise, execute the import workflow end-to-end.
</process>
