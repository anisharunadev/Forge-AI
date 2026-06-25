/**
 * Regression tests for bug #3584
 *
 * Runtime/user-facing strings emitted by forge-core/bin/lib/*.cjs hardcoded
 * the deprecated `/forge:<cmd>` colon form (16 files, ~50 occurrences). After
 * #2808 unified GSD installs to register skills under the hyphen form
 * (`name: forge-execute-phase`), pasting the emitted `/forge:execute-phase` into
 * Claude Code yields `Unknown command: /forge:execute-phase. Did you mean
 * /forge-execute-phase?`. Codex installs require `$gsd-<cmd>` (shell-var) form.
 *
 * Fix: a runtime-aware slash formatter (`runtime-slash.cjs`) is now the single
 * source of truth for emitting `/forge-<cmd>` (hyphen) for skills-based runtimes
 * and `$gsd-<cmd>` for Codex. Tests assert on the formatter's typed output and
 * — for the integration tests in `bug-3584-runtime-slash-emitters.test.cjs` —
 * on the structured `--json` payloads from the runtime command handlers.
 */

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { formatGsdSlash, resolveRuntime } = require(
  path.join(ROOT, 'forge-core', 'bin', 'lib', 'runtime-slash.cjs'),
);
const { cleanup } = require('./helpers.cjs');

describe('formatGsdSlash — runtime-aware slash command formatter', () => {
  describe('hyphen-form runtimes (claude, cursor, opencode, kilo, etc.)', () => {
    test('emits /forge-<cmd> for claude', () => {
      assert.strictEqual(formatGsdSlash('execute-phase', 'claude'), '/forge-execute-phase');
    });

    test('emits /forge-<cmd> for cursor', () => {
      assert.strictEqual(formatGsdSlash('plan-phase', 'cursor'), '/forge-plan-phase');
    });

    test('emits /forge-<cmd> for opencode', () => {
      assert.strictEqual(formatGsdSlash('discuss-phase', 'opencode'), '/forge-discuss-phase');
    });

    test('emits /forge-<cmd> for kilo', () => {
      assert.strictEqual(formatGsdSlash('health', 'kilo'), '/forge-health');
    });

    test('unknown runtime defaults to hyphen form', () => {
      assert.strictEqual(
        formatGsdSlash('new-project', 'some-future-runtime'),
        '/forge-new-project',
      );
    });

    test('null/undefined runtime defaults to hyphen form (claude)', () => {
      assert.strictEqual(formatGsdSlash('new-milestone', null), '/forge-new-milestone');
      assert.strictEqual(formatGsdSlash('new-milestone', undefined), '/forge-new-milestone');
    });

    test('runtime aliases for non-codex runtimes still emit hyphen form', () => {
      assert.strictEqual(formatGsdSlash('new-project', 'claude-code'), '/forge-new-project');
      assert.strictEqual(formatGsdSlash('new-project', 'gemini-cli'), '/forge-new-project');
      assert.strictEqual(formatGsdSlash('new-project', 'opencode-cli'), '/forge-new-project');
    });
  });

  describe('codex shell-var form', () => {
    test('emits $gsd-<cmd> for codex', () => {
      assert.strictEqual(formatGsdSlash('execute-phase', 'codex'), '$forge-execute-phase');
    });

    test('emits $gsd-<cmd> for codex aliases (app/cli)', () => {
      assert.strictEqual(formatGsdSlash('execute-phase', 'codex-app'), '$forge-execute-phase');
      assert.strictEqual(formatGsdSlash('execute-phase', 'codex_cli'), '$forge-execute-phase');
    });

    test('codex output is lowercased', () => {
      assert.strictEqual(
        formatGsdSlash('Execute-Phase', 'codex'),
        '$forge-execute-phase',
      );
    });
  });

  describe('input normalization', () => {
    test('strips existing /forge: colon prefix', () => {
      assert.strictEqual(
        formatGsdSlash('/forge:execute-phase', 'claude'),
        '/forge-execute-phase',
      );
    });

    test('strips existing /forge- hyphen prefix (idempotent)', () => {
      assert.strictEqual(
        formatGsdSlash('/forge-plan-phase', 'claude'),
        '/forge-plan-phase',
      );
    });

    test('strips bare forge: prefix without leading slash', () => {
      assert.strictEqual(
        formatGsdSlash('forge:new-project', 'claude'),
        '/forge-new-project',
      );
    });

    test('strips existing $gsd- shell prefix (codex idempotent)', () => {
      assert.strictEqual(
        formatGsdSlash('$forge-execute-phase', 'codex'),
        '$forge-execute-phase',
      );
    });

    test('runtime swap: /forge:execute-phase + codex → $forge-execute-phase', () => {
      assert.strictEqual(
        formatGsdSlash('/forge:execute-phase', 'codex'),
        '$forge-execute-phase',
      );
    });

    test('case-insensitive prefix stripping', () => {
      assert.strictEqual(
        formatGsdSlash('GSD:execute-phase', 'claude'),
        '/forge-execute-phase',
      );
    });
  });

  describe('defensive returns for unsafe inputs', () => {
    test('non-string commandName returns input unchanged', () => {
      assert.strictEqual(formatGsdSlash(null, 'claude'), null);
      assert.strictEqual(formatGsdSlash(undefined, 'claude'), undefined);
      assert.strictEqual(formatGsdSlash(42, 'claude'), 42);
    });

    test('empty string returns empty string', () => {
      assert.strictEqual(formatGsdSlash('', 'claude'), '');
    });

    test('whitespace-only string returns empty string (no spurious /forge- emission)', () => {
      assert.strictEqual(formatGsdSlash('   ', 'claude'), '');
      assert.strictEqual(formatGsdSlash('\t\n', 'codex'), '');
    });

    test('degenerate prefix-only input returns empty (does NOT re-emit colon form)', () => {
      // Regression guard for the CodeRabbit finding on the original PR:
      // a previous fallback returned `commandName` unchanged when the bare
      // tail was empty, which re-introduced the deprecated `/forge:` shape for
      // inputs like `/forge:`, `forge:`, or `forge-`. The formatter must never
      // emit the colon form — return empty so callers detect "no command"
      // instead of receiving an unroutable string.
      assert.strictEqual(formatGsdSlash('/forge:', 'claude'), '');
      assert.strictEqual(formatGsdSlash('forge:', 'claude'), '');
      assert.strictEqual(formatGsdSlash('forge-', 'claude'), '');
      assert.strictEqual(formatGsdSlash('/forge-', 'codex'), '');
      assert.strictEqual(formatGsdSlash('$gsd-', 'codex'), '');
    });

    test('commands with arguments preserve the argument tail', () => {
      // `execute-phase 03` is a valid call shape — the formatter only
      // rewrites the command token; everything after the first whitespace
      // belongs to the caller.
      assert.strictEqual(
        formatGsdSlash('execute-phase 03', 'claude'),
        '/forge-execute-phase 03',
      );
      assert.strictEqual(
        formatGsdSlash('/forge:execute-phase 03', 'claude'),
        '/forge-execute-phase 03',
      );
    });

    test('codex form lowercases only the command token, not the argument tail', () => {
      // Regression for codex review finding: a previous implementation
      // lowercased the full input including arguments, which would corrupt
      // Windows paths and case-sensitive flag values passed as args.
      assert.strictEqual(
        formatGsdSlash('Map-Codebase --paths C:\\Users\\Me\\Project', 'codex'),
        '$gsd-map-codebase --paths C:\\Users\\Me\\Project',
      );
      assert.strictEqual(
        formatGsdSlash('execute-phase 03 --Name FooBar', 'codex'),
        '$forge-execute-phase 03 --Name FooBar',
      );
    });

    test('hyphen form preserves token case (it does not get lowercased)', () => {
      // Symmetry with codex: only codex lowercases the token. Hyphen-form
      // runtimes preserve whatever case the caller supplied for the token.
      assert.strictEqual(
        formatGsdSlash('Plan-Phase 03', 'claude'),
        '/forge-Plan-Phase 03',
      );
    });
  });
});

describe('formatGsdSlash — descriptor-driven commandStyle (ADR-857 phase 5c)', () => {
  // These three assertions are the non-vacuous equivalence anchor for the
  // descriptor-driven branch: the formatter reads commandStyle from the
  // capability registry instead of hardcoding `if (rt === 'codex')`.

  test('codex (commandStyle=shell-var) → $gsd- with lowercased token', () => {
    // The registry carries commandStyle=shell-var for codex. The formatter
    // must look it up and emit the shell-var form, lowercasing only the token.
    assert.strictEqual(formatGsdSlash('Foo', 'codex'), '$gsd-foo');
  });

  test('slash-hyphen runtime (claude) → /forge- with case-preserved token', () => {
    // claude descriptor has commandStyle=slash-hyphen. Token case is preserved.
    assert.strictEqual(formatGsdSlash('Foo', 'claude'), '/forge-Foo');
  });

  test('slash-hyphen runtime (cursor) → /forge- with case-preserved token', () => {
    // cursor descriptor has commandStyle=slash-hyphen.
    assert.strictEqual(formatGsdSlash('Foo', 'cursor'), '/forge-Foo');
  });

  test('unknown runtime (no registry entry) → /forge- default (slash-hyphen fallback)', () => {
    // An unknown runtime has no descriptor entry → runtimes[rt] is undefined →
    // style is undefined → not 'shell-var' → falls through to /forge- default.
    assert.strictEqual(formatGsdSlash('foo', 'doesnotexist'), '/forge-foo');
  });
});

describe('formatGsdSlash — registry-parity: prefix and casing are a pure function of commandStyle', () => {
  // Non-vacuous proof that the REGISTRY drives the decision, not a hardcoded
  // `rt === 'codex'` check. For every runtime id in capability-registry.cjs we
  // derive the expected prefix and lowercasing linkage directly from the
  // registry's commandStyle field and assert that formatGsdSlash matches.
  //
  // This fails if:
  //   (a) anyone reverts the formatter to a hardcode that diverges from the
  //       registry (e.g. a future runtime gets commandStyle=shell-var but the
  //       formatter still only special-cases 'codex'); or
  //   (b) a runtime's commandStyle is changed in the registry without
  //       formatGsdSlash following suit.
  const { runtimes } = require(
    path.join(ROOT, 'forge-core', 'bin', 'lib', 'capability-registry.cjs'),
  );

  const TOKEN_MIXED = 'SomeCmd'; // mixed-case to distinguish lowercasing behaviour

  for (const [id, descriptor] of Object.entries(runtimes)) {
    const style = descriptor.runtime.commandStyle;

    test(`${id}: commandStyle=${style} → formatGsdSlash prefix and casing match registry`, () => {
      const result = formatGsdSlash(TOKEN_MIXED, id);

      if (style === 'shell-var') {
        // shell-var runtimes must emit $gsd-<lowercased-token>
        assert.ok(
          result.startsWith('$gsd-'),
          `[${id}] expected $gsd- prefix (commandStyle=shell-var), got: ${result}`,
        );
        assert.strictEqual(
          result,
          `$gsd-${TOKEN_MIXED.toLowerCase()}`,
          `[${id}] shell-var must lowercase the token`,
        );
      } else {
        // slash-hyphen (or any other non-shell-var value) must emit /forge-<token>
        // with case preserved (no lowercasing)
        assert.ok(
          result.startsWith('/forge-'),
          `[${id}] expected /forge- prefix (commandStyle=${style}), got: ${result}`,
        );
        assert.strictEqual(
          result,
          `/forge-${TOKEN_MIXED}`,
          `[${id}] slash-hyphen must preserve token case`,
        );
      }
    });
  }
});

describe('resolveRuntime — env > config > default', () => {
  test('process.env.GSD_RUNTIME wins over everything', () => {
    const saved = process.env.GSD_RUNTIME;
    try {
      process.env.GSD_RUNTIME = 'codex';
      assert.strictEqual(resolveRuntime(null), 'codex');
      assert.strictEqual(resolveRuntime('/nonexistent'), 'codex');
    } finally {
      if (saved === undefined) delete process.env.GSD_RUNTIME;
      else process.env.GSD_RUNTIME = saved;
    }
  });

  test('canonicalizes codex env aliases', () => {
    const saved = process.env.GSD_RUNTIME;
    try {
      process.env.GSD_RUNTIME = 'codex-app';
      assert.strictEqual(resolveRuntime(null), 'codex');
      process.env.GSD_RUNTIME = 'codex_cli';
      assert.strictEqual(resolveRuntime('/nonexistent'), 'codex');
    } finally {
      if (saved === undefined) delete process.env.GSD_RUNTIME;
      else process.env.GSD_RUNTIME = saved;
    }
  });

  test('defaults to claude when env is unset and projectDir missing', () => {
    const saved = process.env.GSD_RUNTIME;
    try {
      delete process.env.GSD_RUNTIME;
      assert.strictEqual(resolveRuntime(null), 'claude');
      assert.strictEqual(resolveRuntime(undefined), 'claude');
    } finally {
      if (saved !== undefined) process.env.GSD_RUNTIME = saved;
    }
  });

  test('reads config.runtime when env is unset and projectDir has a config', (t) => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-3584-'));
    t.after(() => cleanup(tmp));

    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ runtime: 'codex' }),
    );

    const saved = process.env.GSD_RUNTIME;
    try {
      delete process.env.GSD_RUNTIME;
      assert.strictEqual(resolveRuntime(tmp), 'codex');
    } finally {
      if (saved !== undefined) process.env.GSD_RUNTIME = saved;
    }
  });

  test('canonicalizes codex config aliases', (t) => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-3584-'));
    t.after(() => cleanup(tmp));

    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ runtime: 'codex-cli' }),
    );

    const saved = process.env.GSD_RUNTIME;
    try {
      delete process.env.GSD_RUNTIME;
      assert.strictEqual(resolveRuntime(tmp), 'codex');
    } finally {
      if (saved !== undefined) process.env.GSD_RUNTIME = saved;
    }
  });

  test('canonicalizes non-codex config aliases', (t) => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-3584-'));
    t.after(() => cleanup(tmp));

    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ runtime: 'claude-code' }),
    );

    const saved = process.env.GSD_RUNTIME;
    try {
      delete process.env.GSD_RUNTIME;
      assert.strictEqual(resolveRuntime(tmp), 'claude');
    } finally {
      if (saved !== undefined) process.env.GSD_RUNTIME = saved;
    }
  });

  test('lowercases the resolved runtime', () => {
    const saved = process.env.GSD_RUNTIME;
    try {
      process.env.GSD_RUNTIME = 'CLAUDE';
      assert.strictEqual(resolveRuntime(null), 'claude');
    } finally {
      if (saved === undefined) delete process.env.GSD_RUNTIME;
      else process.env.GSD_RUNTIME = saved;
    }
  });
});
