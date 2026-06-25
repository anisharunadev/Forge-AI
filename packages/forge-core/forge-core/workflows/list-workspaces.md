<purpose>
List all GSD workspaces found in ~/forge-workspaces/ with their status.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 1. Setup

```bash
_GSD_SHIM_NAME="forge-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"; if [ -f "$GSD_TOOLS" ]; then forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif command -v forge-tools >/dev/null 2>&1; then GSD_TOOLS="$(command -v forge-tools)"; forge_run() { "$GSD_TOOLS" "$@"; }; elif [ -f "$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: forge-tools.cjs not found at $GSD_TOOLS and forge-tools is not on PATH. Run: npx -y @forge-ai/forge-core@latest --claude --local" >&2; exit 1; fi; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi
INIT=$(forge_run query init.list-workspaces)
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse JSON for: `workspace_base`, `workspaces`, `workspace_count`.

## 2. Display

**If `workspace_count` is 0:**

```
No workspaces found in ~/forge-workspaces/

Create one with:
  /forge:workspace --new --name my-workspace --repos repo1,repo2
```

Done.

**If workspaces exist:**

Display a table:

```
GSD Workspaces (~/forge-workspaces/)

| Name | Repos | Strategy | GSD Project |
|------|-------|----------|-------------|
| feature-a | 3 | worktree | Yes |
| feature-b | 2 | clone | No |

Manage:
  cd ~/forge-workspaces/<name>     # Enter a workspace
  /forge:workspace --remove <name>  # Remove a workspace
```

For each workspace, show:
- **Name** — directory name
- **Repos** — count from init data
- **Strategy** — from WORKSPACE.md
- **GSD Project** — whether `.planning/PROJECT.md` exists (Yes/No)

</process>
