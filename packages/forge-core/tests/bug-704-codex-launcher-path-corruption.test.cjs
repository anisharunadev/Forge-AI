// allow-test-rule: source-text-is-the-product
'use strict';

/**
 * Regression test for issue #704:
 * "v1.3.1 global install ships literal $forge-core launcher paths in workflows"
 *
 * ROOT CAUSE: `convertSlashCommandsToCodexSkillMentions` had a regex
 *   /(?<![a-zA-Z0-9./])\/forge-([a-z0-9-]+)/
 * The lookbehind did NOT include `}`, so shell variable expressions like
 *   `${_GSD_RUNTIME_ROOT}/forge-core/bin/...`
 * had their `/forge-core` matched (the char before `/` was `}`, not in the
 * exclusion set), converting it to `$forge-core` and breaking all Codex
 * workflow launcher paths.
 *
 * FIX: Add `}` to the lookbehind set so `${VAR}/forge-core/` is excluded.
 */

process.env.GSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  convertClaudeCommandToCodexSkill,
  convertSlashCommandsToCodexSkillMentions,
} = require('../bin/install.js');

// The canonical launcher snippet path that was being corrupted
const RUNTIME_ROOT_PATH = '${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}';
// The exact bad token reported in issue #704
const BAD_TOKEN = '$forge-core';

describe('#704 — Codex global install launcher path corruption', () => {
  test('convertClaudeCommandToCodexSkill does not corrupt ${VAR}/forge-core/ or $(cmd)/forge-* paths', () => {
    // Minimal fixture with the launcher snippet and command-substitution patterns
    // that were being corrupted (#704).
    const input = [
      '---',
      'description: Test skill',
      '---',
      '',
      '```bash',
      '_GSD_SHIM_NAME="forge-tools.cjs"',
      '_GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"',
      'GSD_TOOLS="${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"',
      'if [ -f "$GSD_TOOLS" ]; then',
      '  forge_run() { node "$GSD_TOOLS" "$@"; }',
      'elif [ -f "${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then',
      '  GSD_TOOLS="${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"',
      '  forge_run() { node "$GSD_TOOLS" "$@"; }',
      'elif [ -f "$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}" ]; then',
      '  GSD_TOOLS="$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"',
      '  forge_run() { node "$GSD_TOOLS" "$@"; }',
      'fi',
      '# Command-substitution path form (reapply-patches pattern)',
      'candidate="$(expand_home "$KILO_CONFIG_DIR")/forge-local-patches"',
      '```',
    ].join('\n');

    const output = convertClaudeCommandToCodexSkill(input, 'forge-test-704');

    // Shell-context corruption patterns from issue #704:
    //   - `}$gsd-*` from shell variable expressions `${VAR}/forge-*`
    //   - `)$gsd-*` from command-substitution paths `$(cmd)/forge-*`
    const shellCorruptionPatterns = [
      { pattern: '}' + BAD_TOKEN, description: 'shell-variable }$forge-core' },
      { pattern: ')$gsd-local', description: 'command-substitution )$gsd-local-patches' },
    ];
    for (const { pattern, description } of shellCorruptionPatterns) {
      assert.ok(
        !output.includes(pattern),
        `Codex skill conversion must not produce "${pattern}" (${description}). ` +
          `Offending fragment: ${
            output.includes(pattern)
              ? output.substring(output.indexOf(pattern) - 50, output.indexOf(pattern) + 80)
              : '(not found)'
          }`,
      );
    }

    // The correct path forms must be preserved — the canonical launcher path
    // (RUNTIME_ROOT_PATH) must survive Codex conversion intact.
    assert.ok(
      output.includes(RUNTIME_ROOT_PATH),
      `Expected canonical launcher path "${RUNTIME_ROOT_PATH}" to appear in the converted output. ` +
        `Got:\n${output.substring(0, 500)}`,
    );
    assert.ok(
      output.includes(')/forge-local-patches'),
      `Expected ")/forge-local-patches" to appear in the converted output. ` +
        `Got:\n${output.substring(0, 500)}`,
    );
  });

  test('convertClaudeCommandToCodexSkill preserves all shell path forms (}, ) closers)', () => {
    // All these paths appear after a shell-closing character (} or )) and must
    // NOT be converted to $gsd-* by the Codex slash-command converter.
    const shellPaths = [
      // Shell variable expression forms (} closer)
      { path: '"${_GSD_RUNTIME_ROOT}/forge-core/bin/${_GSD_SHIM_NAME}"', corruptedForm: '}$forge-core' },
      { path: '"${_GSD_RUNTIME_ROOT}/.claude/forge-core/bin/${_GSD_SHIM_NAME}"', corruptedForm: '}$forge-core' },
      { path: '"$HOME/.claude/forge-core/bin/${_GSD_SHIM_NAME}"', corruptedForm: '}$forge-core' },
      // Command-substitution forms () closer) — reapply-patches pattern
      { path: 'candidate="$(expand_home "$KILO_CONFIG_DIR")/forge-local-patches"', corruptedForm: ')$gsd-local' },
      { path: 'candidate="$(dirname "$(expand_home "$OPENCODE_CONFIG")")/forge-local-patches"', corruptedForm: ')$gsd-local' },
    ];

    for (const { path: p, corruptedForm } of shellPaths) {
      const input = `---\ndescription: Test\n---\n\n\`\`\`bash\n${p}\n\`\`\``;
      const output = convertClaudeCommandToCodexSkill(input, 'forge-test-704-paths');
      assert.ok(
        !output.includes(corruptedForm),
        `Path "${p}" was corrupted to contain "${corruptedForm}" after Codex conversion.\n` +
          `Got:\n${output}`,
      );
    }
  });

  test('convertClaudeCommandToCodexSkill still converts legitimate /forge-<cmd> slash mentions', () => {
    // Slash-command mentions (not preceded by }) should still be converted
    const input = [
      '---',
      'description: Test',
      '---',
      '',
      'Use /forge-discuss-phase to start a discussion.',
      'Or use /forge-plan-phase for planning.',
      'Also: /forge:capture --backlog adds items.',
    ].join('\n');

    const output = convertClaudeCommandToCodexSkill(input, 'forge-test-704-cmds');

    assert.ok(
      output.includes('$forge-discuss-phase'),
      'Expected /forge-discuss-phase to be converted to $forge-discuss-phase',
    );
    assert.ok(
      output.includes('$forge-plan-phase'),
      'Expected /forge-plan-phase to be converted to $forge-plan-phase',
    );
    assert.ok(
      output.includes('$gsd-capture'),
      'Expected /forge:capture to be converted to $gsd-capture',
    );
  });

  test('actual shipped workflow files: shell-variable launcher paths contain no $forge-core', () => {
    // Walk forge-core/workflows/ and assert that no file produces $forge-core
    // inside a shell variable expansion context after Codex conversion.
    //
    // NOTE: The backtick-wrapped prose-path case (`/forge-core/workflows/update.md`)
    // was a pre-existing gap with the #704 lookbehind fix and is now addressed by
    // the positive-boundary regex introduced in #712. That case is covered by the
    // "#712" describe block below.
    //
    // We probe for the specific shell-context pattern from the issue report:
    //   BAD:  ${_GSD_RUNTIME_ROOT}$forge-core/bin/
    //   GOOD: ${_GSD_RUNTIME_ROOT}/forge-core/bin/
    const workflowsDir = path.join(__dirname, '..', 'forge-core', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      // If the directory doesn't exist, skip gracefully (non-standard layout)
      return;
    }

    const files = fs.readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(workflowsDir, f));

    assert.ok(files.length > 0, 'Expected at least one workflow .md file');

    // Shell-context corruption patterns from issue #704:
    //   - `}$gsd-*`: closing brace from `${VAR}/forge-*` shell variable expressions
    //   - `)$gsd-*`: closing paren from `$(cmd)/forge-*` command substitutions
    const SHELL_CORRUPTION_RE = /[})](\$gsd-[a-z])/;

    const offending = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const skillName = `forge-${path.basename(file, '.md')}`;
      const converted = convertClaudeCommandToCodexSkill(content, skillName);
      const match = converted.match(SHELL_CORRUPTION_RE);
      if (match) {
        const idx = converted.indexOf(match[0]);
        offending.push({
          file: path.relative(workflowsDir, file),
          context: converted.substring(Math.max(0, idx - 40), idx + 80),
        });
      }
    }

    assert.deepStrictEqual(
      offending,
      [],
      `Found shell-context path corruption ([})]$gsd-*) in Codex-converted workflow files (#704):\n` +
        offending.map((o) => `  ${o.file}: ...${o.context}...`).join('\n'),
    );
  });

  test('commands/forge/*.md: shell-variable launcher paths contain no $forge-core', () => {
    // Walk commands/forge/ and assert that no command file produces the shell-context
    // }$forge-core corruption — since commands also go through
    // convertClaudeCommandToCodexSkill when installed globally for Codex.
    const commandsDir = path.join(__dirname, '..', 'commands', 'forge');
    if (!fs.existsSync(commandsDir)) return;

    const files = fs.readdirSync(commandsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(commandsDir, f));

    assert.ok(files.length > 0, 'Expected at least one command .md file');

    const SHELL_CORRUPTION_RE = /[})](\$gsd-[a-z])/;

    const offending = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const skillName = `forge-${path.basename(file, '.md')}`;
      const converted = convertClaudeCommandToCodexSkill(content, skillName);
      const match = converted.match(SHELL_CORRUPTION_RE);
      if (match) {
        const idx = converted.indexOf(match[0]);
        offending.push({
          file: path.relative(commandsDir, file),
          context: converted.substring(Math.max(0, idx - 40), idx + 80),
        });
      }
    }

    assert.deepStrictEqual(
      offending,
      [],
      `Found shell-context path corruption ([})]$gsd-*) in Codex-converted command files (#704):\n` +
        offending.map((o) => `  ${o.file}: ...${o.context}...`).join('\n'),
    );
  });
});

describe('#712: positive-boundary slash-command conversion', () => {
  // Tests call convertSlashCommandsToCodexSkillMentions directly so the regex
  // is exercised in isolation — no frontmatter wrapping, no ADAPTER_CLOSE
  // stripping, no .claude→.codex rewrite masking the result.

  // ── MUST-NOT-CONVERT (negative) cases ─────────────────────────────────────
  // These inputs must be returned UNCHANGED — no $gsd-* substitution.

  test('backtick-wrapped path: `/forge-core/workflows/update.md` is NOT converted (THE new fix)', () => {
    const input = 'See `/forge-core/workflows/update.md` for details.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.strictEqual(
      result,
      input,
      `Expected backtick-wrapped path to be unchanged. Got: ${result}`,
    );
  });

  test('backtick-wrapped path deeper: `/forge-pi/bin/foo.cjs` is NOT converted', () => {
    const input = 'Run `/forge-pi/bin/foo.cjs` directly.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.strictEqual(
      result,
      input,
      `Expected deep backtick-wrapped path to be unchanged. Got: ${result}`,
    );
  });

  test('shell var expansion: ${_GSD_RUNTIME_ROOT}/forge-core/bin/x is NOT converted (regression guard)', () => {
    const input = 'PATH="${_GSD_RUNTIME_ROOT}/forge-core/bin/x"';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      !result.includes('$forge-core'),
      `Expected no $forge-core substitution in shell var path. Got: ${result}`,
    );
    assert.ok(
      result.includes('/forge-core/bin/x'),
      `Expected original path to be preserved. Got: ${result}`,
    );
  });

  test('command substitution: $(expand_home ~/.claude)/forge-local-patches is NOT converted (regression guard)', () => {
    const input = 'candidate="$(expand_home ~/.claude)/forge-local-patches"';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      !result.includes(')$gsd-local'),
      `Expected no )$gsd-local substitution. Got: ${result}`,
    );
    assert.ok(
      result.includes(')/forge-local-patches'),
      `Expected original path to be preserved. Got: ${result}`,
    );
  });

  test('plain path segment: bin/forge-tools.cjs is NOT converted', () => {
    const input = 'node bin/forge-tools.cjs --help';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.strictEqual(
      result,
      input,
      `Expected plain path segment to be unchanged. Got: ${result}`,
    );
  });

  test('plain path segment: .claude/forge-core/agents — /forge-core portion is NOT slash-command converted', () => {
    // Tests the regex in isolation: the .claude→.codex path rewrite that happens
    // inside convertClaudeToCodexMarkdown does NOT run here. We assert directly
    // that the slash-command regex leaves /forge-core after the slash intact —
    // i.e. the `e` in `/forge-core` is NOT treated as a command boundary.
    const input = 'Look in .claude/forge-core/agents for the agent files.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      !result.includes('$forge-core'),
      `Expected no $forge-core substitution in .claude/forge-core path. Got: ${result}`,
    );
    assert.ok(
      result.includes('/forge-core/agents'),
      `Expected /forge-core/agents to remain as a path segment. Got: ${result}`,
    );
  });

  // ── MUST-CONVERT (positive) cases ─────────────────────────────────────────
  // These inputs contain legitimate /forge-<cmd> mentions that MUST be converted.

  test('space-preceded prose: Use /forge-discuss-phase to start. → $forge-discuss-phase', () => {
    const input = 'Use /forge-discuss-phase to start.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      result.includes('$forge-discuss-phase'),
      `Expected /forge-discuss-phase to be converted. Got: ${result}`,
    );
    assert.ok(
      !result.includes('/forge-discuss-phase'),
      `Expected original /forge-discuss-phase to be replaced. Got: ${result}`,
    );
  });

  test('backtick-WRAPPED MENTION (single segment): Run `/forge-execute-phase` now → `$forge-execute-phase`', () => {
    // A backtick-wrapped COMMAND (single segment, no path continuation) MUST
    // still be converted — this guards against a naive whitespace-only fix.
    const input = 'Run `/forge-execute-phase` now.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      result.includes('`$forge-execute-phase`'),
      `Expected backtick-wrapped command to be converted to \`$forge-execute-phase\`. Got: ${result}`,
    );
    assert.ok(
      !result.includes('`/forge-execute-phase`'),
      `Expected original \`/forge-execute-phase\` to be replaced. Got: ${result}`,
    );
  });

  test('parenthetical/backtick list like CONTEXT.md:59: (`/forge-plan-phase`, `/forge-progress`) → converted', () => {
    const input = 'Available commands: (`/forge-plan-phase`, `/forge-progress`) — pick one.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      result.includes('`$forge-plan-phase`'),
      `Expected /forge-plan-phase to be converted. Got: ${result}`,
    );
    assert.ok(
      result.includes('`$forge-progress`'),
      `Expected /forge-progress to be converted. Got: ${result}`,
    );
  });

  test('start-of-string: /forge-manager runs → $gsd-manager runs (exercises the ^ branch of lookbehind)', () => {
    // This case is IMPOSSIBLE to test through the frontmatter-wrapping pipeline
    // (the body always has preceding chars). Direct call exercises the ^ branch.
    const input = '/forge-manager runs the pipeline.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      result.includes('$gsd-manager'),
      `Expected /forge-manager to be converted. Got: ${result}`,
    );
    assert.ok(
      !result.includes('/forge-manager'),
      `Expected original /forge-manager to be replaced. Got: ${result}`,
    );
  });

  test('double-quote wrapped: "/forge-resume" → "$gsd-resume"', () => {
    const input = 'Call "/forge-resume" to continue.';
    const result = convertSlashCommandsToCodexSkillMentions(input);
    assert.ok(
      result.includes('"$gsd-resume"'),
      `Expected "/forge-resume" to be converted to "$gsd-resume". Got: ${result}`,
    );
    assert.ok(
      !result.includes('"/forge-resume"'),
      `Expected original "/forge-resume" to be replaced. Got: ${result}`,
    );
  });

  // ── End-to-end: headline #712 bug through the real install pipeline ────────

  test('end-to-end: backtick-wrapped path `/forge-core/workflows/update.md` survives full Codex install pipeline', () => {
    // Uses convertClaudeCommandToCodexSkill (same pattern as #704 tests above)
    // to prove the real install path does not corrupt prose references to repo paths.
    const input = [
      '---',
      'description: Test',
      '---',
      '',
      'See `/forge-core/workflows/update.md` for the update workflow.',
    ].join('\n');

    const output = convertClaudeCommandToCodexSkill(input, 'forge-test-712-e2e');

    assert.ok(
      !output.includes('$forge-core'),
      `Expected no $forge-core in converted output. Got:\n${output}`,
    );
    assert.ok(
      output.includes('/forge-core/workflows/update.md'),
      `Expected backtick-wrapped path to survive conversion. Got:\n${output}`,
    );
  });
});
