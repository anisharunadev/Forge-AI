// allow-test-rule: source-text-is-the-product
// Reads .md/.json/.yml product files whose deployed text IS what the
// runtime loads — testing text content tests the deployed contract.

/**
 * Regression test for bug #2808
 *
 * All 85 GSD SKILL.md files declared `name: forge:<cmd>` (colon), the deprecated
 * form. Claude Code surfaces the `name:` frontmatter field in autocomplete, so
 * users saw `/forge:add-phase` suggestions instead of the canonical `/forge-add-phase`.
 *
 * Root cause: skillFrontmatterName() in bin/install.js converted hyphenated
 * skill dir names to colon form (forge-add-phase → forge:add-phase) because
 * workflows called Skill(skill="forge:<cmd>"). That was the original fix for
 * #2643. Since then, workflows have been updated to use hyphen form (#2808).
 *
 * Fix: skillFrontmatterName() now returns the hyphen form unchanged.
 * Workflow Skill() colon calls are updated to hyphen.
 *
 * This test verifies:
 * 1. skillFrontmatterName returns hyphen form (not colon).
 * 2. Installed SKILL.md would emit name: forge-<cmd> (not forge:<cmd>).
 * 3. No workflow contains a Skill(skill="forge:<cmd>") colon call.
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanup, createTempDir } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const { convertClaudeCommandToClaudeSkill, installRuntimeArtifacts, skillFrontmatterName } =
  require(path.join(ROOT, 'bin', 'install.js'));

const {
  loadSkillsManifest,
  resolveProfile,
} = require(path.join(ROOT, 'forge-core', 'bin', 'lib', 'install-profiles.cjs'));

// Full resolved profile — installs all available skills from the source dir
const _manifest = loadSkillsManifest();
const resolvedProfileFull = resolveProfile({ modes: [], manifest: _manifest });

const WORKFLOWS_DIR = path.join(ROOT, 'forge-core', 'workflows');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'forge');

function walkMd(dir) {
  const files = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...walkMd(full));
      else if (e.name.endsWith('.md')) files.push(full);
    }
  } catch (err) {
    assert.fail(`failed to read markdown files from ${dir}: ${err.message}`);
  }
  return files;
}

describe('bug-2808: SKILL.md name: uses hyphen form', () => {
  test('skillFrontmatterName returns hyphen form (not colon)', () => {
    assert.strictEqual(skillFrontmatterName('forge-add-phase'), 'forge-add-phase');
    assert.strictEqual(skillFrontmatterName('forge-plan-phase'), 'forge-plan-phase');
    assert.strictEqual(skillFrontmatterName('forge-autonomous'), 'forge-autonomous');
  });

  test('generated SKILL.md contains name: forge-<cmd> (not forge:<cmd>)', () => {
    const cmdFiles = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
    assert.ok(cmdFiles.length > 0, 'expected GSD command files');

    for (const cmd of cmdFiles) {
      const base = cmd.replace(/\.md$/, '');
      const skillDirName = 'forge-' + base;
      const src = fs.readFileSync(path.join(COMMANDS_DIR, cmd), 'utf-8');
      const skillContent = convertClaudeCommandToClaudeSkill(src, skillDirName);

      // Parse frontmatter structurally: extract name: line from the --- block.
      const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fmMatch, `${cmd}: generated skill content must have a frontmatter block`);
      const fmLines = fmMatch[1].split('\n');
      const nameEntry = fmLines.find((l) => l.startsWith('name:'));
      assert.ok(nameEntry, `${cmd}: generated SKILL.md is missing required name: field`);

      const name = nameEntry.replace(/^name:\s*/, '').trim();
      assert.ok(
        !name.includes(':'),
        `${cmd}: SKILL.md name should be hyphen form, got "${name}"`
      );
      assert.ok(
        name.startsWith('forge-'),
        `${cmd}: SKILL.md name should start with forge-, got "${name}"`
      );

      // #3583 regression guard: the *body* must not leak retired colon-form
      // command references (e.g. /forge:plan-phase or forge:review). The converter
      // now uses transformContentToHyphen from the shared transformer.
      //
      // We explicitly scope to the body (after stripping the leading frontmatter
      // block) so that descriptions or other frontmatter fields containing example
      // forge: references do not cause spurious failures.
      //
      // forge:sdk and forge:tools are intentionally excluded: they are not slash commands
      // (no commands/forge/sdk.md or tools.md exist), so the transformer correctly leaves
      // them alone. They are benign and should not trigger this assertion.
      const bodyContent = skillContent.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const colonRefs = (bodyContent.match(/\bforge:[a-z][a-z0-9-]*\b/g) || [])
        .filter(r => !/forge:(sdk|tools)/.test(r));
      assert.strictEqual(
        colonRefs.length, 0,
        `${cmd}: generated SKILL.md body must not contain forge: command references (found: ${colonRefs.join(', ')})`
      );
    }
  });

  test('no workflow contains Skill(skill="forge:<cmd>") colon form', () => {
    const workflowFiles = walkMd(WORKFLOWS_DIR);
    assert.ok(
      workflowFiles.length > 0,
      `expected workflow markdown files under ${WORKFLOWS_DIR}`
    );
    const colonCalls = [];
    for (const f of workflowFiles) {
      const src = fs.readFileSync(f, 'utf-8');
      // Strip HTML comments to avoid matching commented-out examples.
      // regex-free HTML-comment stripper (CodeQL: avoid incomplete-multi-character-sanitization)
      let stripped = '';
      {
        let rest = src;
        let idx;
        while ((idx = rest.indexOf('<!--')) !== -1) {
          stripped += rest.slice(0, idx);
          const end = rest.indexOf('-->', idx + 4);
          if (end === -1) { rest = ''; break; }
          rest = rest.slice(end + 3);
        }
        stripped += rest;
      }
      // Scan each line for Skill() calls using the colon form.
      // Parsing line-by-line is more precise than a multi-line regex
      // and avoids false positives from incidental matches in prose.
      for (const line of stripped.split('\n')) {
        // Tolerate whitespace around the parenthesis, the `skill` keyword,
        // and the `=` so variants like `Skill( skill = "forge:foo" )` are still
        // flagged. Without the `\s*` allowances, drift slips through this guard.
        //
        // The local-name capture must be permissive (`[^'"\s)]+`, not
        // `[a-z0-9-]+`) — the whole purpose of this guard is to surface
        // *malformed* drift, including legacy underscore-form names like
        // `forge:extract_learnings`. A character-class that excludes the very
        // characters we need to flag would silently let drift through.
        const colonCallRe = /Skill\(\s*skill\s*=\s*\\?['"]forge:([^'"\s)]+)\\?['"]/gi;
        let m;
        while ((m = colonCallRe.exec(line)) !== null) {
          colonCalls.push(`${path.basename(f)}: Skill(skill="forge:${m[1]}")`);
        }
      }
    }
    assert.deepStrictEqual(
      colonCalls,
      [],
      'deprecated colon-form Skill() calls found — update to forge-<cmd>: ' + colonCalls.join(', ')
    );
  });

  test('generated autocomplete skill surface uses hyphen names without underscores', (t) => {
    const tmp = createTempDir('forge-autocomplete-surface-');
    t.after(() => cleanup(tmp));

    // Use the real COMMANDS_DIR as the source via .gsd-source marker.
    // installRuntimeArtifacts('claude', configDir, 'global') writes to
    // configDir/skills/ using the same converter as the shim did.
    // With the full profile (#924 fix), skills are FLAT: forge-<stem>/SKILL.md
    // (nested layout reverted for Claude — Claude Code scans only one level).
    const configDir = path.join(tmp, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.gsd-source'), COMMANDS_DIR + '\n');
    installRuntimeArtifacts('claude', configDir, 'global', resolvedProfileFull);
    const skillsDir = path.join(configDir, 'skills');

    // Recursively collect all SKILL.md files under skills/ (handles both flat and
    // nested layouts). Don't filter any paths — that would silently hide exactly
    // the kind of drift this test exists to catch (a `forge:extract-learnings`
    // colon variant or a bare `extract-learnings` without the namespace prefix
    // would never be collected, and the loop below would never see them).
    function collectSkillMds(dir) {
      const results = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...collectSkillMds(full));
        } else if (entry.name === 'SKILL.md') {
          results.push(full);
        }
      }
      return results;
    }

    const allSkillMdPaths = collectSkillMds(skillsDir);
    assert.ok(allSkillMdPaths.length > 0, 'expected generated SKILL.md files under skillsDir');

    // Validate every SKILL.md's name: field (the consumer-facing name used in
    // autocomplete). We also check that the containing dir name doesn't use
    // banned characters at any level of nesting.
    const allNames = [];
    for (const skillMdPath of allSkillMdPaths) {
      const relPath = path.relative(skillsDir, skillMdPath);
      const skillContent = fs.readFileSync(skillMdPath, 'utf-8');
      // Scope the name: lookup to the YAML frontmatter block so a stray
      // `name:` line in the body cannot satisfy the assertion.
      const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fmMatch, `${relPath}: generated SKILL.md must include frontmatter`);
      const nameLine = fmMatch[1].split('\n').find((l) => /^name:\s*/.test(l));
      assert.ok(nameLine, `${relPath}: generated SKILL.md is missing name: frontmatter`);
      const name = nameLine.replace(/^name:\s*/, '').trim();
      assert.ok(name.startsWith('forge-'), `${relPath}: autocomplete name must start with forge-, got ${name}`);
      assert.ok(!name.includes(':'), `${relPath}: autocomplete name must not contain colon, got ${name}`);
      assert.ok(!name.includes('_'), `${relPath}: autocomplete name must not contain underscore, got ${name}`);
      allNames.push(name);

      // Also validate each path segment (dir name) in the relative path doesn't
      // contain the banned characters — catches mislabeled directory names.
      const segments = relPath.split(path.sep).slice(0, -1); // exclude 'SKILL.md' filename
      for (const seg of segments) {
        assert.ok(!seg.includes(':'), `${relPath}: dir segment "${seg}" must not contain colon`);
        assert.ok(!seg.includes('_'), `${relPath}: dir segment "${seg}" must use hyphens, not underscores`);
      }
    }

    assert.ok(allNames.includes('forge-extract-learnings'), 'autocomplete surface must include forge-extract-learnings');
    assert.ok(!allNames.includes('forge-extract_learnings'), 'autocomplete surface must not include forge-extract_learnings');
  });

  test('transformContentToHyphen (from fix-slash-commands.cjs) rewrites colon to hyphen for known commands', () => {
    const transformer = require(path.join(ROOT, 'scripts', 'fix-slash-commands.cjs'));
    const { transformContentToHyphen, readCmdNames } = transformer;
    const liveCmdNames = readCmdNames();

    const input = 'Run /forge:plan-phase then forge:execute-phase. Also see /forge:review and forge-sdk query.';
    const out = transformContentToHyphen(input, liveCmdNames);

    assert.ok(out.includes('/forge-plan-phase'), 'leading-/ colon form must become hyphen');
    assert.ok(out.includes('forge-execute-phase'), 'bare colon form must become hyphen');
    assert.ok(out.includes('/forge-review'), 'another command reference must be rewritten');
    assert.ok(out.includes('forge-sdk'), 'non-command forge-sdk must be left untouched');
    assert.ok(!out.match(/\bforge:[a-z]/), 'no colon-form command reference may survive');
  });

  test('respects word boundary — does not rewrite forge:plan-phase-extra (partial match guard)', () => {
    const transformer = require(path.join(ROOT, 'scripts', 'fix-slash-commands.cjs'));
    const { transformContentToHyphen, readCmdNames } = transformer;
    const liveCmdNames = readCmdNames();

    const out = transformContentToHyphen('forge:plan-phase-extra and /forge:execute-phase-extra', liveCmdNames);
    assert.strictEqual(out, 'forge:plan-phase-extra and /forge:execute-phase-extra',
      'word-boundary lookahead must prevent partial matches on the reverse transform');
  });

  test('respects left word boundary — does not rewrite inside larger tokens (e.g. myforge:cmd)', () => {
    const transformer = require(path.join(ROOT, 'scripts', 'fix-slash-commands.cjs'));
    const { transformContentToHyphen, readCmdNames } = transformer;
    const liveCmdNames = readCmdNames();

    const input = 'See myforge:plan-phase or prefix-forge:execute in the docs.';
    const out = transformContentToHyphen(input, liveCmdNames);
    assert.strictEqual(out, input, 'negative lookbehind must prevent left-side in-word matches');
  });

  test('leaves already-hyphen-form references untouched (idempotent on output)', () => {
    const transformer = require(path.join(ROOT, 'scripts', 'fix-slash-commands.cjs'));
    const { transformContentToHyphen, readCmdNames } = transformer;
    const liveCmdNames = readCmdNames();

    const input = 'Run forge-plan-phase and /forge-execute-phase then forge:review.'; // mixed, only colon should change
    const out = transformContentToHyphen(input, liveCmdNames);
    assert.ok(out.includes('forge-plan-phase'), 'pre-existing hyphen stays');
    assert.ok(out.includes('/forge-execute-phase'), 'pre-existing hyphen stays');
    assert.ok(out.includes('forge-review'), 'colon form was normalized');
    assert.ok(!out.includes('forge:review'), 'no colon form remains');
  });
});
