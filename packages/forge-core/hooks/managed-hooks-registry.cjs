'use strict';

/**
 * Authoritative list of GSD-managed hook files.
 *
 * Extracted from the worker script into a shared CJS module so that:
 *  1. forge-check-update-worker.js can require() it directly (no source-level
 *     duplication).
 *  2. Tests can assert against the exported array instead of regex-parsing
 *     the worker source (retiring the pending-migration-to-typed-ir token
 *     on managed-hooks.test.cjs and orphaned-hooks.test.cjs, per #455).
 *
 * These are the files GSD ships into ~/.claude/hooks/ (or equivalent) and
 * checks for staleness after an update. Orphaned files from removed features
 * (e.g., forge-intel-*.js) must NOT be listed here — that would cause permanent
 * stale warnings for users who haven't cleaned up manually (#1750).
 */
const MANAGED_HOOKS = [
  'forge-check-update-worker.js',
  'forge-check-update.js',
  'forge-config-reload.js',
  'forge-context-monitor.js',
  'forge-cursor-post-tool.js',
  'forge-cursor-session-start.js',
  'forge-ensure-canonical-path.js',
  'forge-graphify-update.sh',
  'forge-phase-boundary.sh',
  'forge-prompt-guard.js',
  'forge-read-guard.js',
  'forge-read-injection-scanner.js',
  'forge-session-state.sh',
  'forge-statusline.js',
  'forge-update-banner.js',
  'forge-validate-commit.sh',
  'forge-workflow-guard.js',
  'forge-worktree-path-guard.js',
];

module.exports = { MANAGED_HOOKS };
