// allow-test-rule: source-text-is-the-product
// Workflow .md / agent .md / command .md / reference .md files — their text
// IS what the runtime loads. Testing text content tests the deployed contract.
// Per CONTRIBUTING.md exception matrix.

/**
 * Regression tests for bug #1924: forge-update silently deletes user-generated files
 *
 * Running the installer (forge-update / re-install) must not delete:
 *   - forge-core/USER-PROFILE.md  (created by /forge-profile-user)
 *   - commands/forge/dev-preferences.md  (created by /forge-profile-user)
 *
 * Root cause:
 *   1. copyWithPathReplacement() calls fs.rmSync(destDir, {recursive:true}) before
 *      copying — no preserve allowlist. This wipes USER-PROFILE.md.
 *   2. ~line 5211 explicitly rmSync's commands/forge/ during global install legacy
 *      cleanup — no preserve. This wipes dev-preferences.md.
 *
 * Fix requirement:
 *   - install() must preserve USER-PROFILE.md across the forge-core/ wipe
 *   - install() must preserve dev-preferences.md across the commands/forge/ wipe
 *
 * Closes: #1924
 */

'use strict';

const { describe, test, beforeEach, afterEach, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');
const BUILD_SCRIPT = path.join(__dirname, '..', 'scripts', 'build-hooks.js');

// ─── Ensure hooks/dist/ is populated before any install test ─────────────────

before(() => {
  execFileSync(process.execPath, [BUILD_SCRIPT], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  // eslint-disable-next-line local/no-raw-rmsync-in-tests -- local cleanup() helper wrapping rmSync; cannot use imported cleanup() without naming collision
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Run the installer with CLAUDE_CONFIG_DIR redirected to a temp directory.
 * Explicitly removes GSD_TEST_MODE so the subprocess actually runs the installer
 * (not just the export block). Uses --yes to suppress interactive prompts.
 */
function runInstaller(configDir) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete env.GSD_TEST_MODE;
  // --no-sdk: this test covers user-artifact preservation only; skip SDK
  // build (covered by install-smoke.yml) to keep the test deterministic.
  execFileSync(process.execPath, [INSTALL_SCRIPT, '--claude', '--global', '--yes', '--no-sdk'], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env,
  });
}

// ─── Test 1: USER-PROFILE.md is preserved across re-install ─────────────────

describe('#1924: USER-PROFILE.md preserved across re-install (global Claude)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir('forge-1924-userprofile-');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('USER-PROFILE.md exists after initial install + user creation', () => {
    runInstaller(tmpDir);

    // Simulate /forge-profile-user creating USER-PROFILE.md inside forge-core/
    const profilePath = path.join(tmpDir, 'forge-core', 'USER-PROFILE.md');
    fs.writeFileSync(profilePath, '# My Profile\n\nCustom user content.\n');

    assert.ok(
      fs.existsSync(profilePath),
      'USER-PROFILE.md should exist after being created by /forge-profile-user'
    );
  });

  test('USER-PROFILE.md is preserved after re-install', () => {
    // First install
    runInstaller(tmpDir);

    // User runs /forge-profile-user, creating USER-PROFILE.md
    const profilePath = path.join(tmpDir, 'forge-core', 'USER-PROFILE.md');
    const originalContent = '# My Profile\n\nThis is my custom user profile content.\n';
    fs.writeFileSync(profilePath, originalContent);

    // Re-run installer (simulating forge-update)
    runInstaller(tmpDir);

    assert.ok(
      fs.existsSync(profilePath),
      'USER-PROFILE.md must survive re-install — forge-update must not delete user-generated profiles'
    );

    const afterContent = fs.readFileSync(profilePath, 'utf8');
    assert.strictEqual(
      afterContent,
      originalContent,
      'USER-PROFILE.md content must be identical after re-install'
    );
  });

  test('USER-PROFILE.md is preserved even when forge-core/ is wiped and recreated', () => {
    runInstaller(tmpDir);

    const gsdDir = path.join(tmpDir, 'forge-core');
    const profilePath = path.join(gsdDir, 'USER-PROFILE.md');

    // Confirm forge-core/ was created by install
    assert.ok(fs.existsSync(gsdDir), 'forge-core/ must exist after install');

    // Write profile
    fs.writeFileSync(profilePath, '# Profile\n\nMy coding style preferences.\n');

    // Re-install
    runInstaller(tmpDir);

    // forge-core/ must still exist AND profile must be intact
    assert.ok(fs.existsSync(gsdDir), 'forge-core/ must still exist after re-install');
    assert.ok(
      fs.existsSync(profilePath),
      'USER-PROFILE.md must still exist after forge-core/ was wiped and recreated'
    );
  });
});

// ─── Test 2: dev-preferences.md is preserved across re-install ───────────────

describe('#1924: dev-preferences.md preserved across re-install (global Claude)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir('forge-1924-devprefs-');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('dev-preferences.md is preserved when commands/forge/ is cleaned up during re-install', () => {
    // First install (creates skills/ structure for global Claude)
    runInstaller(tmpDir);

    // User runs /forge-profile-user — it creates dev-preferences.md in commands/forge/
    const commandsGsdDir = path.join(tmpDir, 'commands', 'forge');
    fs.mkdirSync(commandsGsdDir, { recursive: true });
    const devPrefsPath = path.join(commandsGsdDir, 'dev-preferences.md');
    const originalContent = '# Dev Preferences\n\nI prefer TDD. I like short functions.\n';
    fs.writeFileSync(devPrefsPath, originalContent);

    // Re-run installer (simulating forge-update).
    // In the layout-driven path (B2), legacy commands/forge/ is removed and
    // dev-preferences.md is migrated to skills/forge-dev-preferences/SKILL.md (#2973).
    runInstaller(tmpDir);

    // Content is migrated to the new canonical skills location (#2973).
    // The old commands/forge/ path is cleaned up; the skill file carries the content.
    const devPrefSkillPath = path.join(tmpDir, 'skills', 'forge-dev-preferences', 'SKILL.md');
    assert.ok(
      fs.existsSync(devPrefSkillPath),
      'dev-preferences.md must be migrated to skills/forge-dev-preferences/SKILL.md — forge-update legacy cleanup must not silently drop user-generated content'
    );

    const afterContent = fs.readFileSync(devPrefSkillPath, 'utf8');
    assert.strictEqual(
      afterContent,
      originalContent,
      'migrated dev-preferences content must be identical to the original'
    );
  });

  test('legacy non-user GSD commands are still cleaned up during re-install', () => {
    // First install
    runInstaller(tmpDir);

    // Simulate a legacy GSD command file being left in commands/forge/
    const commandsGsdDir = path.join(tmpDir, 'commands', 'forge');
    fs.mkdirSync(commandsGsdDir, { recursive: true });
    const legacyFile = path.join(commandsGsdDir, 'next.md');
    fs.writeFileSync(legacyFile, '---\nname: forge:next\n---\n\nLegacy content.');

    // But dev-preferences.md is also there (user-generated)
    const devPrefsContent = '# Dev Preferences\n\nMy preferences.\n';
    const devPrefsPath = path.join(commandsGsdDir, 'dev-preferences.md');
    fs.writeFileSync(devPrefsPath, devPrefsContent);

    // Re-install
    runInstaller(tmpDir);

    // In the layout-driven path (B2), commands/forge/ is fully removed but
    // dev-preferences.md content is migrated to the new canonical skill location.
    const devPrefSkillPath = path.join(tmpDir, 'skills', 'forge-dev-preferences', 'SKILL.md');
    assert.ok(
      fs.existsSync(devPrefSkillPath),
      'dev-preferences.md content must be migrated to skills/forge-dev-preferences/SKILL.md'
    );

    // The legacy GSD command (next.md) is NOT user-generated, must be removed
    // (it would exist only as a skill now in skills/forge-next/SKILL.md)
    assert.ok(
      !fs.existsSync(legacyFile),
      'legacy GSD command next.md in commands/forge/ must be removed during cleanup'
    );
  });
});

// ─── Test 3: profile-user.md backup path is outside forge-core/ ───────────

describe('#1924: profile-user.md backup path must be outside forge-core/', () => {
  test('profile-user.md backup uses ~/.claude/USER-PROFILE.backup.md not ~/.claude/forge-core/USER-PROFILE.backup.md', () => {
    const workflowPath = path.join(
      __dirname, '..', 'forge-core', 'workflows', 'profile-user.md'
    );
    const content = fs.readFileSync(workflowPath, 'utf8');

    // The backup must NOT be inside forge-core/ because that directory is wiped on update
    assert.ok(
      !content.includes('forge-core/USER-PROFILE.backup.md'),
      'backup path must NOT be inside forge-core/ — that directory is wiped on forge-update'
    );

    // The backup should be at ~/.claude/USER-PROFILE.backup.md (outside forge-core/)
    assert.ok(
      content.includes('USER-PROFILE.backup.md') &&
      !content.includes('/forge-core/USER-PROFILE.backup.md'),
      'backup path must be outside forge-core/ (e.g. ~/.claude/USER-PROFILE.backup.md)'
    );
  });
});

// ─── Test 4: preserveUserArtifacts helper exported from install.js ────────────

describe('#1924: preserveUserArtifacts helper exists in install.js', () => {
  test('install.js exports preserveUserArtifacts function', () => {
    // Set GSD_TEST_MODE so require() reaches the module.exports block
    const origMode = process.env.GSD_TEST_MODE;
    process.env.GSD_TEST_MODE = '1';
    let mod;
    try {
      mod = require(INSTALL_SCRIPT);
    } finally {
      if (origMode === undefined) {
        delete process.env.GSD_TEST_MODE;
      } else {
        process.env.GSD_TEST_MODE = origMode;
      }
    }

    assert.strictEqual(
      typeof mod.preserveUserArtifacts,
      'function',
      'install.js must export preserveUserArtifacts helper for testability'
    );
  });
});
