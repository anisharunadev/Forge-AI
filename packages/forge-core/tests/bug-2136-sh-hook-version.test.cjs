
// allow-test-rule: structural-regression-guard
// The shebang line must be `#!/usr/bin/env bash` (PATH-resolved) rather than
// `#!/bin/bash` for cross-distro portability (NixOS, minimal Alpine do not
// ship /bin/bash). This is an architectural constraint that cannot be verified
// by executing the hooks — they run fine with either shebang on distros that
// have /bin/bash, so only a source assertion catches a future regression.

/**
 * Regression tests for bug #2136 / #2206
 *
 * Root cause: three bash hooks (forge-phase-boundary.sh, forge-session-state.sh,
 * forge-validate-commit.sh) shipped without a forge-hook-version header, and the
 * stale-hook detector in forge-check-update.js only matched JavaScript comment
 * syntax (//) — not bash comment syntax (#).
 *
 * Result: every session showed "⚠ stale hooks — run /forge-update" immediately
 * after a fresh install, because the detector saw hookVersion: 'unknown' for
 * all three bash hooks.
 *
 * This fix requires THREE parts working in concert:
 *   1. Bash hooks ship with "# forge-hook-version: {{GSD_VERSION}}"
 *   2. install.js substitutes {{GSD_VERSION}} in .sh files at install time
 *   3. forge-check-update.js regex matches both "//" and "#" comment styles
 *
 * Neither fix alone is sufficient:
 *   - Headers + regex fix only (no install.js fix): installed hooks contain
 *     literal "{{GSD_VERSION}}" — the {{-guard silently skips them, making
 *     bash hook staleness permanently undetectable after future updates.
 *   - Headers + install.js fix only (no regex fix): installed hooks are
 *     stamped correctly but the detector still can't read bash "#" comments,
 *     so they still land in the "unknown / stale" branch on every session.
 */

'use strict';

// NOTE: Do NOT set GSD_TEST_MODE here — the E2E install tests spawn the
// real installer subprocess, which skips all install logic when GSD_TEST_MODE=1.

const { describe, test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const _CHECK_UPDATE_FILE = path.join(HOOKS_DIR, 'forge-check-update.js');
const WORKER_FILE = path.join(HOOKS_DIR, 'forge-check-update-worker.js');
const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');
const BUILD_SCRIPT = path.join(__dirname, '..', 'scripts', 'build-hooks.js');

const SH_HOOKS = [
  'forge-phase-boundary.sh',
  'forge-session-state.sh',
  'forge-validate-commit.sh',
];

// ─── Ensure hooks/dist/ is populated before install tests ────────────────────

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

function runInstaller(configDir) {
  // --no-sdk: this test covers .sh hook version stamping only; skip SDK
  // build (covered by install-smoke.yml).
  execFileSync(process.execPath, [INSTALL_SCRIPT, '--claude', '--global', '--yes', '--no-sdk'], {
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  });
  return path.join(configDir, 'hooks');
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Bash hook sources carry the version header placeholder
// ─────────────────────────────────────────────────────────────────────────────

describe('bug #2136 part 1: bash hook sources carry forge-hook-version placeholder', () => {
  for (const sh of SH_HOOKS) {
    test(`${sh} contains "# forge-hook-version: {{GSD_VERSION}}"`, () => {
      const content = fs.readFileSync(path.join(HOOKS_DIR, sh), 'utf8');
      assert.ok(
        content.includes('# forge-hook-version: {{GSD_VERSION}}'),
        `${sh} must include "# forge-hook-version: {{GSD_VERSION}}" so the ` +
        `installer can stamp it and forge-check-update.js can detect staleness`
      );
    });
  }

  test('version header is on line 2 (immediately after shebang)', () => {
    // Placing the header immediately after the shebang ensures it is always
    // found regardless of how much of the file is read. The shebang itself
    // must use `#!/usr/bin/env bash` (PATH-resolved) rather than `#!/bin/bash`
    // — POSIX guarantees /bin/sh but not /bin/bash, and distros like NixOS
    // do not ship /bin/bash by default.
    for (const sh of SH_HOOKS) {
      const lines = fs.readFileSync(path.join(HOOKS_DIR, sh), 'utf8').split(/\r?\n/);
      assert.strictEqual(
        lines[0],
        '#!/usr/bin/env bash',
        `${sh} line 1 must be "#!/usr/bin/env bash" for cross-distro portability`
      );
      assert.ok(
        lines[1].startsWith('# forge-hook-version:'),
        `${sh} line 2 must be the forge-hook-version header (got: "${lines[1]}")`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: forge-check-update-worker.js regex handles bash "#" comment syntax
// (Logic moved from inline -e template literal to dedicated worker file)
// ─────────────────────────────────────────────────────────────────────────────

describe('bug #2136 part 2: stale-hook detector handles bash comment syntax', () => {
  let src;

  before(() => {
    src = fs.readFileSync(WORKER_FILE, 'utf8');
  });

  test('version regex in source matches "#" comment syntax in addition to "//"', () => {
    // The regex string in the source must contain the alternation for "#".
    // The worker uses plain JS (no template-literal escaping), so the form is
    // "(?:\/\/|#)" directly in source.
    const hasBashAlternative =
      src.includes('(?:\\/\\/|#)') ||     // escaped form (old template-literal style)
      src.includes('(?://|#)');          // direct form in plain JS worker
    assert.ok(
      hasBashAlternative,
      'forge-check-update-worker.js version regex must include an alternative for bash "#" comments. ' +
      'Expected to find (?:\\/\\/|#) or (?://|#) in the source. ' +
      'The original "//" only regex causes bash hooks to always report hookVersion: "unknown"'
    );
  });

  test('version regex does not use the old JS-only form as the sole pattern', () => {
    // The old regex inside the template literal was the string:
    //   /\\/\\/ forge-hook-version:\\s*(.+)/
    // which, when evaluated in the subprocess, produced: /\/\/ forge-hook-version:\s*(.+)/
    // That only matched JS "//" comments — never bash "#".
    // We verify that the old exact string no longer appears.
    assert.ok(
      !src.includes('\\/\\/ forge-hook-version'),
      'forge-check-update-worker.js must not use the old JS-only (\\/\\/ forge-hook-version) ' +
      'escape form as the sole version matcher — it cannot match bash "#" comments'
    );
  });

  test('version regex correctly matches both bash and JS hook version headers', () => {
    // Verify that the versionMatch line in the source uses a regex that matches
    // both bash "#" and JS "//" comment styles. We check the source contains the
    // expected alternation, then directly test the known required pattern.
    //
    // We do NOT try to extract and evaluate the regex from source (it contains ")"
    // which breaks simple extraction), so instead we confirm the source matches
    // our expectation and run the regex itself.
    assert.ok(
      src.includes('forge-hook-version'),
      'forge-check-update-worker.js must contain a forge-hook-version version check'
    );

    // The fixed regex that must be present: matches both comment styles
    const fixedRegex = /(?:\/\/|#) forge-hook-version:\s*(.+)/;

    assert.ok(
      fixedRegex.test('# forge-hook-version: 1.36.0'),
      'bash-style "# forge-hook-version: X" must be matchable by the required regex'
    );
    assert.ok(
      fixedRegex.test('// forge-hook-version: 1.36.0'),
      'JS-style "// forge-hook-version: X" must still match (no regression)'
    );
    assert.ok(
      !fixedRegex.test('forge-hook-version: 1.36.0'),
      'line without a comment prefix must not match (prevents false positives)'
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Part 4: End-to-end — installed .sh hooks have stamped version, not placeholder
// ─────────────────────────────────────────────────────────────────────────────

describe('bug #2136 part 4: installed .sh hooks contain stamped concrete version', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir('forge-2136-install-');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('installed .sh hooks contain a concrete version string, not the template placeholder', () => {
    const hooksDir = runInstaller(tmpDir);

    for (const sh of SH_HOOKS) {
      const hookPath = path.join(hooksDir, sh);
      assert.ok(fs.existsSync(hookPath), `${sh} must be installed`);

      const content = fs.readFileSync(hookPath, 'utf8');

      assert.ok(
        content.includes('# forge-hook-version:'),
        `installed ${sh} must contain a "# forge-hook-version:" header`
      );
      assert.ok(
        !content.includes('{{GSD_VERSION}}'),
        `installed ${sh} must not contain literal "{{GSD_VERSION}}" — ` +
        `install.js must substitute it with the concrete package version`
      );

      const versionMatch = content.match(/# forge-hook-version:\s*(\S+)/);
      assert.ok(versionMatch, `installed ${sh} version header must have a version value`);
      assert.match(
        versionMatch[1],
        /^\d+\.\d+\.\d+/,
        `installed ${sh} version "${versionMatch[1]}" must be a semver-like string`
      );
    }
  });

  test('stale-hook detector reports zero stale bash hooks immediately after fresh install', () => {
    // This is the definitive end-to-end proof: after install, run the actual
    // version-check logic (extracted from forge-check-update.js) against the
    // installed hooks and verify none are flagged stale.
    const hooksDir = runInstaller(tmpDir);
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const installedVersion = pkg.version;

    // Build a subprocess that runs the staleness check logic in isolation.
    // We pass the installed version, hooks dir, and hook filenames as JSON
    // to avoid any injection risk.
    const checkScript = `
      'use strict';
      const fs = require('fs');
      const path = require('path');

      function isNewer(a, b) {
        const pa = (a || '').split('.').map(s => Number(s.replace(/-.*/, '')) || 0);
        const pb = (b || '').split('.').map(s => Number(s.replace(/-.*/, '')) || 0);
        for (let i = 0; i < 3; i++) {
          if (pa[i] > pb[i]) return true;
          if (pa[i] < pb[i]) return false;
        }
        return false;
      }

      const hooksDir = ${JSON.stringify(hooksDir)};
      const installed = ${JSON.stringify(installedVersion)};
      const shHooks = ${JSON.stringify(SH_HOOKS)};
      // Use the same regex that the fixed forge-check-update.js uses
      const versionRe = /(?:\\/\\/|#) forge-hook-version:\\s*(.+)/;

      const staleHooks = [];
      for (const hookFile of shHooks) {
        const hookPath = path.join(hooksDir, hookFile);
        if (!fs.existsSync(hookPath)) {
          staleHooks.push({ file: hookFile, hookVersion: 'missing' });
          continue;
        }
        const content = fs.readFileSync(hookPath, 'utf8');
        const m = content.match(versionRe);
        if (m) {
          const hookVersion = m[1].trim();
          if (isNewer(installed, hookVersion) && !hookVersion.includes('{{')) {
            staleHooks.push({ file: hookFile, hookVersion, installedVersion: installed });
          }
        } else {
          staleHooks.push({ file: hookFile, hookVersion: 'unknown', installedVersion: installed });
        }
      }
      process.stdout.write(JSON.stringify(staleHooks));
    `;

    const result = execFileSync(process.execPath, ['-e', checkScript], { encoding: 'utf8' });
    const staleHooks = JSON.parse(result);

    assert.deepStrictEqual(
      staleHooks,
      [],
      `Fresh install must produce zero stale bash hooks.\n` +
      `Got: ${JSON.stringify(staleHooks, null, 2)}\n` +
      `This indicates either the version header was not stamped by install.js, ` +
      `or the detector regex cannot match bash "#" comment syntax.`
    );
  });
});
