// allow-test-rule: source-text-is-the-product #1367
// Installed command `.md` files — their on-disk path determines the slash-command
// namespace registered by Claude Code. Asserting the layout (flat vs. subdirectory)
// IS a behavioral test of the deploy contract, not source-grep theater.

/**
 * Regression for #1367 — project-local Claude Code install writes command files to
 * `.claude/commands/forge/<cmd>.md` (subdirectory, bare names), causing Claude Code
 * to register them as `/forge:<cmd>` (colon namespace). The fix changes the layout to
 * write flat `forge-<cmd>.md` files at `.claude/commands/` level so Claude Code
 * registers `/forge-<cmd>` (hyphen form, matching hooks, statusline, and cross-command
 * references everywhere in the framework).
 *
 * Root cause: `bin/install.js` (the `else` branch for claude local) wrote to a
 * `commands/forge/` subdirectory using `copyWithPathReplacement`. Claude Code treats
 * the directory name as a namespace, so `commands/forge/update.md` became `/forge:update`.
 *
 * Fix: write each command as `forge-<stem>.md` directly in `commands/` (flat layout).
 * This is the same approach used for OpenCode/Kilo (see `copyFlattenedCommands`).
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALL_PATH = path.join(REPO_ROOT, 'bin', 'install.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `node install.js --claude --local --no-sdk` in cwd.
 * GSD_TEST_MODE must be cleared so the install() main block executes.
 */
function runClaudeLocalInstall(cwd) {
  const env = { ...process.env };
  delete env.GSD_TEST_MODE;
  execFileSync(process.execPath, [INSTALL_PATH, '--claude', '--local', '--no-sdk'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

// ---------------------------------------------------------------------------
// Suite — #1367 regression: flat forge-<cmd>.md layout for claude local install
// ---------------------------------------------------------------------------

describe('bug #1367 — Claude local install uses flat forge-<cmd>.md command layout', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-1367-'));
    runClaudeLocalInstall(tmpDir);
  });

  after(() => {
    cleanup(tmpDir);
  });

  test('L0: commands/ directory exists after local claude install', () => {
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    assert.ok(
      fs.existsSync(commandsDir),
      `commands/ must be created by local claude install at ${commandsDir}`,
    );
  });

  test('L1: command files use flat forge-<cmd>.md names (not bare names in a subdirectory)', () => {
    // The fix: commands land as .claude/commands/forge-<cmd>.md (flat, hyphen-prefixed).
    // Claude Code reads the stem of each file in commands/ as the command name,
    // so forge-update.md → /forge-update (hyphen). The old layout (commands/forge/update.md)
    // made Claude Code use the directory as a namespace → /forge:update (colon).
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    assert.ok(fs.existsSync(commandsDir), 'commands/ must exist for this check to be meaningful');

    const flatGsdFiles = fs.readdirSync(commandsDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.startsWith('forge-') && e.name.endsWith('.md'));

    assert.ok(
      flatGsdFiles.length > 0,
      `commands/ must contain flat forge-*.md files (e.g. forge-help.md, forge-update.md). ` +
      `Found none. Install may still be writing to commands/forge/<cmd>.md subdirectory ` +
      `which causes /forge:<cmd> colon namespace in Claude Code.`,
    );
  });

  test('L2: known commands land as flat forge-<cmd>.md files', () => {
    // Spot-check: the three commands mentioned in the issue must be present
    // as flat hyphen-prefixed files.
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    const knownCommands = ['forge-update.md', 'forge-plan-phase.md', 'forge-help.md'];
    for (const name of knownCommands) {
      const filePath = path.join(commandsDir, name);
      assert.ok(
        fs.existsSync(filePath),
        `${name} must exist as a flat file at commands/${name}. ` +
        `If missing, the flat layout is not being written correctly.`,
      );
    }
  });

  test('L3: commands/forge/ subdirectory does NOT exist (old colon-namespace layout)', () => {
    // The old layout wrote to commands/forge/<cmd>.md. That directory must not
    // exist after a fresh install with the fix applied.
    const oldSubdir = path.join(tmpDir, '.claude', 'commands', 'forge');
    assert.ok(
      !fs.existsSync(oldSubdir),
      `commands/forge/ subdir must NOT exist after install. ` +
      `Its presence means the old layout is still being used — Claude Code would ` +
      `register commands as /forge:<cmd> (colon) instead of /forge-<cmd> (hyphen).`,
    );
  });

  test('L4: total flat command file count matches the staged source', () => {
    // There should be a substantial number of commands (not 0, not 1).
    // The exact count varies with profile but must be >= 20 for a full install.
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    const count = fs.readdirSync(commandsDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.startsWith('forge-') && e.name.endsWith('.md'))
      .length;
    assert.ok(
      count >= 20,
      `commands/ must have >= 20 flat forge-*.md files for a full install. ` +
      `Got ${count}. Install may be silently dropping commands.`,
    );
  });

  test('L5: legacy migration — re-install on a pre-#1367 tree removes old commands/forge/ subdir', () => {
    // Simulate a pre-#1367 install: create a commands/forge/ subdirectory with a bare-name file.
    // Then re-run the installer and verify the old subdir is cleaned up.
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    const legacyDir = path.join(commandsDir, 'forge');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'update.md'), '# legacy update');

    // Re-run install — should remove commands/forge/ and write flat forge-*.md
    runClaudeLocalInstall(tmpDir);

    assert.ok(
      !fs.existsSync(legacyDir),
      `commands/forge/ legacy subdir must be removed by re-install. ` +
      `The installer's legacy cleanup must remove old commands/forge/ on upgrade.`,
    );
    // Flat form must still be present
    assert.ok(
      fs.existsSync(path.join(commandsDir, 'forge-update.md')),
      `forge-update.md must exist as flat file after re-install.`,
    );
  });
});
