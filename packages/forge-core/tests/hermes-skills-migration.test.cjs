// allow-test-rule: source-text-is-the-product
// Reads .md/.json/.yml product files whose deployed text IS what the
// runtime loads — testing text content tests the deployed contract.

/**
 * GSD Tools Tests - Hermes Agent Skills Migration
 *
 * Tests for installing GSD for Hermes Agent using the standard
 * skills/forge-xxx/SKILL.md format (same open standard as Claude Code 2.1.88+).
 *
 * Uses node:test and node:assert (NOT Jest).
 */

process.env.GSD_TEST_MODE = '1';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const {
  convertClaudeCommandToClaudeSkill,
  installRuntimeArtifacts,
} = require('../bin/install.js');
const { parseFrontmatter, cleanup } = require('./helpers.cjs');
const pkg = require('../package.json');

const {
  loadSkillsManifest,
  resolveProfile,
} = require('../forge-core/bin/lib/install-profiles.cjs');

const manifest = loadSkillsManifest();
const resolvedProfileFull = resolveProfile({ modes: [], manifest });

// ─── convertClaudeCommandToClaudeSkill (used by Hermes via copyCommandsAsClaudeSkills) ──

describe('Hermes Agent: convertClaudeCommandToClaudeSkill', () => {
  test('preserves allowed-tools multiline YAML list', () => {
    const input = [
      '---',
      'name: forge:next',
      'description: Advance to the next step',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '  - Grep',
      '---',
      '',
      'Body content here.',
    ].join('\n');

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-next');
    assert.ok(result.includes('allowed-tools:'), 'allowed-tools field is present');
    assert.ok(result.includes('Read'), 'Read tool preserved');
    assert.ok(result.includes('Bash'), 'Bash tool preserved');
    assert.ok(result.includes('Grep'), 'Grep tool preserved');
  });

  test('preserves argument-hint', () => {
    const input = [
      '---',
      'name: forge:debug',
      'description: Debug issues',
      'argument-hint: "[issue description]"',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '---',
      '',
      'Debug body.',
    ].join('\n');

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-debug');
    assert.ok(result.includes('argument-hint:'), 'argument-hint field is present');
    assert.ok(
      result.includes('[issue description]'),
      'argument-hint value preserved'
    );
  });

  test('emits hyphen-form name (forge-<cmd>) from hyphen-form dir (#2808)', () => {
    const input = [
      '---',
      'name: forge:next',
      'description: Advance workflow',
      '---',
      '',
      'Body.',
    ].join('\n');

    // Directory name is forge-next (hyphen, Windows-safe), frontmatter name is
    // forge-next (hyphen, #2808 — canonical invocation form for Claude Code autocomplete).
    const result = convertClaudeCommandToClaudeSkill(input, 'forge-next');
    assert.ok(result.includes('name: forge-next'), 'frontmatter name uses hyphen form (#2808)');
  });

  test('preserves body content unchanged', () => {
    const body = '\n<objective>\nDo the thing.\n</objective>\n\n<process>\nStep 1.\nStep 2.\n</process>\n';
    const input = [
      '---',
      'name: forge:test',
      'description: Test command',
      '---',
      body,
    ].join('');

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-test');
    assert.ok(result.includes('<objective>'), 'objective tag preserved');
    assert.ok(result.includes('Do the thing.'), 'body text preserved');
    assert.ok(result.includes('<process>'), 'process tag preserved');
  });

  test('produces valid SKILL.md frontmatter starting with ---', () => {
    const input = [
      '---',
      'name: forge:plan',
      'description: Plan a phase',
      '---',
      '',
      'Plan body.',
    ].join('\n');

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-plan');
    assert.ok(result.startsWith('---\n'), 'frontmatter starts with ---');
    assert.ok(result.includes('\n---\n'), 'frontmatter closes with ---');
  });
});

// ─── installRuntimeArtifacts (used for Hermes skills install) ────────────────

describe('Hermes Agent: installRuntimeArtifacts', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hermes-test-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates skills/forge/forge-quick/SKILL.md directory structure (Hermes prefixed layout, #947)', () => {
    // Create source command files
    const srcDir = path.join(tmpDir, 'src', 'commands', 'forge');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'quick.md'), [
      '---',
      'name: forge:quick',
      'description: Execute a quick task',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '---',
      '',
      '<objective>Quick task body</objective>',
    ].join('\n'));

    const configDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(configDir, { recursive: true });
    // Redirect findInstallSourceRoot to the test's custom srcDir
    fs.writeFileSync(path.join(configDir, '.gsd-source'), srcDir);

    installRuntimeArtifacts('hermes', configDir, 'global', resolvedProfileFull);

    // Hermes layout: skills/forge/forge-<stem>/SKILL.md (#947 — canonical forge- prefix restored)
    const skillPath = path.join(configDir, 'skills', 'forge', 'forge-quick', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'skills/forge/forge-quick/SKILL.md exists');

    // Verify content (structural — parse frontmatter, don't substring-grep)
    // Hermes prefix='forge-': skillName passed to converter = 'forge-quick'
    const content = fs.readFileSync(skillPath, 'utf8');
    const fm = parseFrontmatter(content);
    assert.strictEqual(fm.name, 'forge-quick', 'frontmatter name uses canonical forge- prefix (#947)');
    assert.ok(fm.description && fm.description.length > 0, 'description present and non-empty');
    assert.strictEqual(fm.version, pkg.version,
      `Hermes SKILL.md must declare version (got ${JSON.stringify(fm.version)})`);
    assert.ok(/^allowed-tools:\s*\n(?:\s+-\s+\S+\n?)+/m.test(content),
      'allowed-tools rendered as YAML block list');
    assert.ok(content.includes('<objective>'), 'body content preserved');
  });

  test('replaces ~/.claude/ paths via applyRuntimeContentRewritesInPlace', () => {
    const srcDir = path.join(tmpDir, 'src', 'commands', 'forge');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'next.md'), [
      '---',
      'name: forge:next',
      'description: Next step',
      '---',
      '',
      'Reference: @~/.claude/forge-core/workflows/next.md',
    ].join('\n'));

    const configDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.gsd-source'), srcDir);

    installRuntimeArtifacts('hermes', configDir, 'global', resolvedProfileFull);

    // Hermes layout: skills/forge/forge-<stem>/SKILL.md (#947 — canonical forge- prefix)
    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge', 'forge-next', 'SKILL.md'), 'utf8');
    assert.ok(!content.includes('~/.claude/'), 'old claude tilde-path removed');
    assert.ok(!content.includes('$HOME/.claude/'), 'old claude $HOME-path not present');
  });

  test('replaces $HOME/.claude/ paths via applyRuntimeContentRewritesInPlace', () => {
    const srcDir = path.join(tmpDir, 'src', 'commands', 'forge');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'plan.md'), [
      '---',
      'name: forge:plan',
      'description: Plan phase',
      '---',
      '',
      'Reference: $HOME/.claude/forge-core/workflows/plan.md',
    ].join('\n'));

    const configDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.gsd-source'), srcDir);

    installRuntimeArtifacts('hermes', configDir, 'global', resolvedProfileFull);

    // Hermes layout: skills/forge/forge-<stem>/SKILL.md (#947 — canonical forge- prefix)
    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge', 'forge-plan', 'SKILL.md'), 'utf8');
    assert.ok(!content.includes('$HOME/.claude/'), 'old claude $HOME-path removed');
    assert.ok(!content.includes('~/.claude/'), 'old claude tilde-path not present');
  });

  test('removes stale forge- skills before installing new ones', () => {
    const srcDir = path.join(tmpDir, 'src', 'commands', 'forge');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'quick.md'), [
      '---',
      'name: forge:quick',
      'description: Quick task',
      '---',
      '',
      'Body',
    ].join('\n'));

    const configDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.gsd-source'), srcDir);

    // Pre-create a stale flat skill (skills/forge-old-skill) — legacy Hermes layout
    const staleFlatSkillDir = path.join(configDir, 'skills', 'forge-old-skill');
    fs.mkdirSync(staleFlatSkillDir, { recursive: true });
    fs.writeFileSync(path.join(staleFlatSkillDir, 'SKILL.md'), 'old');

    installRuntimeArtifacts('hermes', configDir, 'global', resolvedProfileFull);

    // _runLegacyInstallMigrations removes skills/forge-* flat dirs for hermes
    assert.ok(!fs.existsSync(staleFlatSkillDir), 'stale flat forge- skill removed');
    // New Hermes layout: skills/forge/forge-<stem>/SKILL.md (#947 — canonical forge- prefix)
    assert.ok(fs.existsSync(path.join(configDir, 'skills', 'forge', 'forge-quick', 'SKILL.md')), 'new skill installed at skills/forge/forge-quick/SKILL.md');
  });

  test('preserves agent field in frontmatter', () => {
    const srcDir = path.join(tmpDir, 'src', 'commands', 'forge');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'execute.md'), [
      '---',
      'name: forge:execute',
      'description: Execute phase',
      'agent: forge-executor',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '  - Task',
      '---',
      '',
      'Execute body',
    ].join('\n'));

    const configDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, '.gsd-source'), srcDir);

    installRuntimeArtifacts('hermes', configDir, 'global', resolvedProfileFull);

    // Hermes layout: skills/forge/forge-<stem>/SKILL.md (#947 — canonical forge- prefix)
    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge', 'forge-execute', 'SKILL.md'), 'utf8');
    const fm = parseFrontmatter(content);
    assert.strictEqual(fm.agent, 'forge-executor', 'agent field preserved');
  });
});

// ─── Integration: SKILL.md format validation ────────────────────────────────

describe('Hermes Agent: SKILL.md format validation', () => {
  test('SKILL.md frontmatter parses with required Hermes fields', () => {
    const input = [
      '---',
      'name: forge:review',
      'description: Code review with quality checks',
      'argument-hint: "[PR number or branch]"',
      'agent: forge-code-reviewer',
      'allowed-tools:',
      '  - Read',
      '  - Grep',
      '  - Bash',
      '---',
      '',
      '<objective>Review code</objective>',
    ].join('\n');

    // Pass runtime='hermes' so the version field is injected per Hermes spec.
    const result = convertClaudeCommandToClaudeSkill(input, 'forge-review', 'hermes');
    const fm = parseFrontmatter(result);

    assert.strictEqual(fm.name, 'forge-review', 'name uses hyphen form');
    assert.ok(fm.description && fm.description.length > 0, 'description non-empty');
    assert.strictEqual(fm.version, pkg.version, 'version matches package.json');
    assert.strictEqual(fm.agent, 'forge-code-reviewer', 'agent preserved');
    assert.strictEqual(fm['argument-hint'], '[PR number or branch]', 'argument-hint preserved and unquoted');
    assert.ok(/^allowed-tools:\s*\n(?:\s+-\s+\S+\n?)+/m.test(result),
      'allowed-tools rendered as YAML block list');
  });

  test('omits version field when runtime is not hermes (parity with non-Hermes skill consumers)', () => {
    const input = [
      '---',
      'name: forge:plan',
      'description: Plan a phase',
      '---',
      '',
      'Body.',
    ].join('\n');

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-plan');
    const fm = parseFrontmatter(result);
    assert.strictEqual(fm.version, undefined, 'no version key for non-hermes skills');
    assert.strictEqual(fm.name, 'forge-plan');
  });
});

// ─── #1383 regression: version lookup must not require a runtime-root package.json ──
// The extracted conversion module sits in the forge-tools loader chain, so its old
// top-level `require('../../../package.json')` crashed EVERY forge-tools command on
// Codex — whose runtime root has no package.json — with
// `Cannot find module '../../../package.json'`. The Hermes `version:` field (the
// require's only consumer) must instead be sourced from the installed
// forge-core/VERSION, lazily and defensively, so the module loads everywhere and
// the emitted version is a real semver, never `undefined`.
describe('#1383 regression: forge-tools version lookup without a runtime-root package.json', () => {
  // Require the EXTRACTED module that the forge-tools chain loads (not install.js's
  // in-process copy), to assert the crash path itself is gone.
  const conversion = require('../forge-core/bin/lib/runtime-artifact-conversion.cjs');

  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-1383-')); });
  afterEach(() => { cleanup(tmp); });

  // Build a fake install layout <tmp>/forge-core/bin/lib and return that libDir.
  // `version` writes <tmp>/forge-core/VERSION; `rootPkg` writes <tmp>/package.json.
  function layout({ version, rootPkg } = {}) {
    const libDir = path.join(tmp, 'forge-core', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    if (version !== undefined) fs.writeFileSync(path.join(tmp, 'forge-core', 'VERSION'), version);
    if (rootPkg !== undefined) fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(rootPkg));
    return libDir;
  }

  test('reads forge-core/VERSION when the runtime root has no package.json (Codex layout)', () => {
    const libDir = layout({ version: '9.9.9\n' }); // deliberately NO root package.json
    assert.ok(!fs.existsSync(path.join(tmp, 'package.json')),
      'precondition: Codex layout has no runtime-root package.json');
    let v;
    assert.doesNotThrow(() => { v = conversion.resolveVersionFrom(libDir); },
      'version lookup must not throw on a layout without a runtime-root package.json');
    assert.strictEqual(v, '9.9.9', 'version is read (trimmed) from the installed VERSION file');
  });

  test('falls back to the runtime-root package.json when no VERSION file exists (source/npm layout)', () => {
    const libDir = layout({ rootPkg: { version: '1.2.3' } }); // no VERSION file
    assert.strictEqual(conversion.resolveVersionFrom(libDir), '1.2.3',
      'source/npm tree has a real package.json three dirs up');
  });

  test('degrades to "" (never throws, never emits undefined) when neither source exists', () => {
    const libDir = layout({}); // neither VERSION nor package.json
    let v;
    assert.doesNotThrow(() => { v = conversion.resolveVersionFrom(libDir); });
    assert.strictEqual(v, '', 'no source -> empty string, so the caller omits the version field');
  });

  test('rejects a non-semver VERSION file rather than emitting it verbatim', () => {
    const libDir = layout({ version: 'not-a-version\n' }); // malformed, no package.json fallback
    let v;
    assert.doesNotThrow(() => { v = conversion.resolveVersionFrom(libDir); });
    assert.strictEqual(v, '', 'garbled VERSION is rejected, so the caller omits the field');
  });
});
