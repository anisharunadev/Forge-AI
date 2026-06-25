/**
 * Regression test for #3610: fresh `npx @forge-ai/forge-core@latest --codex`
 * hard-aborts when the target ~/.codex/hooks/ contains the bundled GSD
 * hook files (`forge-check-update-worker.js`, `forge-prompt-guard.js`, …)
 * left over from a previous version. The installer-migration report
 * classifies them as "GSD-looking file is not proven manifest-managed
 * and needs explicit user choice" and `assertInstallerMigrationsUnblocked`
 * throws.
 *
 * The files in question are NOT user-owned — they are the GSD bundled
 * hooks shipped under `hooks/forge-*` in the npm package. The fix adds a
 * `bundled-gsd-hook` classification to `classifyPromptUserAction` so the
 * resolver removes them (the installer then writes the fresh bundled
 * versions in their place).
 *
 * Because this classification is unambiguous (these are not user files),
 * it must apply regardless of whether stdin is a TTY — the reporter's
 * `npx ... --codex` run was interactive and the existing non-TTY
 * resolver gate at install.js:8069 skipped the safe-default pass.
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runInstallerMigrations,
} = require('../forge-core/bin/lib/installer-migrations.cjs');
const {
  assertInstallerMigrationsUnblocked,
  resolveInstallerMigrationPromptsForNonTty,
  classifyPromptUserAction,
} = require('../forge-core/bin/lib/installer-migration-report.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

function writeFile(root, relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function writeManifest(root, files) {
  fs.writeFileSync(
    path.join(root, 'forge-file-manifest.json'),
    JSON.stringify(
      {
        version: '1.41.2',
        timestamp: '2026-05-10T00:00:00.000Z',
        mode: 'full',
        files,
      },
      null,
      2,
    ),
    'utf8',
  );
}

// Reporter's exact list of blocked files from the v1.42.2 → v1.42.0 upgrade
// abort. Each is a real `hooks/forge-*` file shipped under hooks/ in the npm
// package (verified by `ls hooks/`).
const BUNDLED_HOOK_RELPATHS = [
  'hooks/forge-check-update-worker.js',
  'hooks/forge-check-update.js',
  'hooks/forge-context-monitor.js',
  'hooks/forge-phase-boundary.sh',
  'hooks/forge-prompt-guard.js',
  'hooks/forge-read-guard.js',
  'hooks/forge-read-injection-scanner.js',
  'hooks/forge-session-state.sh',
  'hooks/forge-statusline.js',
  'hooks/forge-update-banner.js',
  'hooks/forge-validate-commit.sh',
  'hooks/forge-workflow-guard.js',
];

describe('bug #3610: classifyPromptUserAction recognizes bundled GSD hooks', () => {
  test('classifies hooks/forge-*.js as bundled-gsd-hook → remove', () => {
    const result = classifyPromptUserAction({
      relPath: 'hooks/forge-prompt-guard.js',
    });
    assert.ok(result, 'classifier returned null for a bundled GSD hook (.js)');
    assert.strictEqual(result.category, 'bundled-gsd-hook');
    assert.strictEqual(
      result.choice,
      'remove',
      'bundled hook must default to remove so the installer can write the fresh bundled version',
    );
  });

  test('classifies hooks/forge-*.sh as bundled-gsd-hook → remove', () => {
    const result = classifyPromptUserAction({
      relPath: 'hooks/forge-validate-commit.sh',
    });
    assert.ok(result);
    assert.strictEqual(result.category, 'bundled-gsd-hook');
    assert.strictEqual(result.choice, 'remove');
  });

  test('does NOT classify non-gsd hooks (preserves user-owned hook files)', () => {
    // A user's custom hook that happens to live under hooks/ must NOT be
    // auto-classified as bundled — the existing block-then-choose flow
    // continues to apply, preserving the user's control over their files.
    const result = classifyPromptUserAction({
      relPath: 'hooks/my-custom-hook.js',
    });
    assert.strictEqual(
      result,
      null,
      'non-gsd-prefixed hook must NOT auto-classify (would clobber user files)',
    );
  });

  test('does NOT classify deeper paths under hooks/forge-* (e.g. hooks/lib/) as bundled-gsd-hook', () => {
    // The bundled GSD distribution has hooks/lib/ (helper modules). Those
    // are managed differently — verify the classifier limits itself to
    // top-level hooks/forge-<name>.<ext> files, not nested directories.
    const result = classifyPromptUserAction({
      relPath: 'hooks/forge-helpers/index.js',
    });
    assert.strictEqual(result, null);
  });
});

describe('bug #3610: fresh upgrade with leftover bundled hooks does not throw', () => {
  let configDir;

  beforeEach(() => {
    configDir = createTempDir('forge-3610-');
  });

  afterEach(() => {
    cleanup(configDir);
  });

  test('end-to-end: 12 leftover bundled hooks + empty manifest → resolver clears all blockers', () => {
    // Recreate the reporter's environment: 12 bundled `forge-*` hook files
    // present at target, but the manifest has not yet seeded their baseline
    // entries (first-time-baseline scan).
    for (const rel of BUNDLED_HOOK_RELPATHS) {
      writeFile(configDir, rel, '#!/usr/bin/env node\n// stale 1.42.0 hook\n');
    }
    writeManifest(configDir, {});

    const result = runInstallerMigrations({
      configDir,
      runtime: 'codex',
      scope: 'global',
      baselineScan: true,
    });

    // Precondition: all 12 leftover hooks classify as prompt-user blockers.
    const blockedPaths = (result.blocked || []).map((a) => a.relPath).sort();
    assert.deepStrictEqual(
      blockedPaths,
      [...BUNDLED_HOOK_RELPATHS].sort(),
      'precondition: every leftover hooks/forge-* should be a prompt-user blocker',
    );

    // Resolve through the safe-default classifier (passing isTty=false to
    // exercise the same code path the bundled-hook classification will hit
    // regardless of TTY once the fix removes the gate).
    const resolved = resolveInstallerMigrationPromptsForNonTty(result, { isTty: false });

    assert.strictEqual(
      resolved.resolutions.length,
      BUNDLED_HOOK_RELPATHS.length,
      'every bundled hook should produce a safe-default resolution entry',
    );

    for (const entry of resolved.resolutions) {
      assert.strictEqual(entry.category, 'bundled-gsd-hook');
      assert.strictEqual(entry.choice, 'remove');
      assert.strictEqual(entry.resolvedActionType, 'backup-and-remove');
    }

    assert.strictEqual(
      (resolved.result.blocked || []).length,
      0,
      'no blockers should remain after bundled-hook classification fires',
    );
    assert.doesNotThrow(() => assertInstallerMigrationsUnblocked(resolved.result));
  });
});
