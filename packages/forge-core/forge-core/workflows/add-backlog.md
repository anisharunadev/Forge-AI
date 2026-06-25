# Add Backlog Item Workflow

Invoked by `/forge:capture --backlog` (`commands/forge/capture.md`).

Adds an idea to the ROADMAP.md backlog parking lot using 999.x numbering. Backlog items
are unsequenced ideas that aren't ready for active planning — they live outside the normal
phase sequence and accumulate context over time.

<process>

## Step 1: Read ROADMAP.md

Check for existing backlog entries:

```bash
cat .planning/ROADMAP.md
```

## Step 2: Find next backlog number

```bash
_GSD_SHIM_NAME="forge-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"; if [ -f "$GSD_TOOLS" ]; then forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.codex/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif command -v forge-tools >/dev/null 2>&1; then GSD_TOOLS="$(command -v forge-tools)"; forge_run() { "$GSD_TOOLS" "$@"; }; elif [ -f "$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${HERMES_HOME:-$HOME/.hermes}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CURSOR_CONFIG_DIR:-$HOME/.cursor}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEX_HOME:-$HOME/.codex}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GEMINI_CONFIG_DIR:-$HOME/.gemini}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${COPILOT_CONFIG_DIR:-$HOME/.copilot}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${AUGMENT_CONFIG_DIR:-$HOME/.augment}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${TRAE_CONFIG_DIR:-$HOME/.trae}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${QWEN_CONFIG_DIR:-$HOME/.qwen}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${CLINE_CONFIG_DIR:-$HOME/.cline}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${GROK_AGENTS_HOME:-$HOME/.agents}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; elif [ -f "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}" ]; then GSD_TOOLS="${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/forge-core/bin/${_GSD_SHIM_NAME}"; forge_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: forge-tools.cjs not found at $GSD_TOOLS and forge-tools is not on PATH. Run: npx -y @forge-ai/forge-core@latest --claude --local" >&2; exit 1; fi; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi
NEXT=$(forge_run query phase.next-decimal 999 --raw)
```

If no 999.x phases exist yet, `phase.next-decimal` returns `999.1`. Sparse numbering
is fine (e.g. 999.1, 999.3) — always use `phase.next-decimal`, never guess.

## Step 3: Write ROADMAP entry

**Write the ROADMAP entry BEFORE creating the directory.** Directory existence is a
reliable indicator that the phase is already registered, which prevents false duplicate
detection in any hook that checks for existing 999.x directories (#2280).

Add under a `## Backlog` section. If the section doesn't exist, create it at the end
of ROADMAP.md:

```markdown
## Backlog

### Phase {NEXT}: {description} (BACKLOG)

**Goal:** [Captured for future planning]
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /forge:review-backlog when ready)
```

## Step 4: Create the phase directory

Apply the `project_code` prefix (if set in `.planning/config.json`) so the backlog directory name is consistent with all other phase-creation paths:

```bash
SLUG=$(forge_run query generate-slug "$ARGUMENTS" --raw)
PROJECT_CODE=$(forge_run query config-get project_code --raw 2>/dev/null || echo "")
PREFIX=$([ -n "$PROJECT_CODE" ] && echo "${PROJECT_CODE}-" || echo "")
PHASE_DIR=".planning/phases/${PREFIX}${NEXT}-${SLUG}"
mkdir -p "${PHASE_DIR}"
touch "${PHASE_DIR}/.gitkeep"
```

## Step 5: Commit

```bash
forge_run query commit "docs: add backlog item ${NEXT} — ${ARGUMENTS}" --files .planning/ROADMAP.md "${PHASE_DIR}/.gitkeep"
```

## Step 6: Report

```
## 📋 Backlog Item Added

Phase {NEXT}: {description}
Directory: {PHASE_DIR}/

This item lives in the backlog parking lot.
Use /forge:discuss-phase {NEXT} to explore it further.
Use /forge:review-backlog to promote items to active milestone.
```

</process>

<notes>
- 999.x numbering keeps backlog items out of the active phase sequence
- Phase directories are created immediately so /forge:discuss-phase and /forge:plan-phase work on them
- No `Depends on:` field — backlog items are unsequenced by definition
- Sparse numbering is fine (999.1, 999.3) — always uses next-decimal
- Promote backlog items to the active milestone with /forge:review-backlog
</notes>
