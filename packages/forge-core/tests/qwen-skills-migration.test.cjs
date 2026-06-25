// allow-test-rule: source-text-is-the-product
// Reads .md/.json/.yml product files whose deployed text IS what the
// runtime loads — testing text content tests the deployed contract.

/**
 * GSD Tools Tests - Qwen Code Skills Migration
 *
 * Tests for installing GSD for Qwen Code using the standard
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

const {
  loadSkillsManifest,
  resolveProfile,
} = require('../forge-core/bin/lib/install-profiles.cjs');

const { cleanup } = require('./helpers.cjs');

const manifest = loadSkillsManifest();
const resolvedProfileFull = resolveProfile({ modes: [], manifest });

// ─── convertClaudeCommandToClaudeSkill (used by Qwen via copyCommandsAsClaudeSkills) ──

describe('Qwen Code: convertClaudeCommandToClaudeSkill', () => {
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

// ─── installRuntimeArtifacts (used for Qwen skills install) ─────────────────

describe('Qwen Code: installRuntimeArtifacts', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-qwen-test-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates skills/forge-xxx/SKILL.md directory structure', () => {
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

    installRuntimeArtifacts('qwen', configDir, 'global', resolvedProfileFull);

    // Qwen layout: skills/forge-<stem>/SKILL.md (destSubpath='skills', prefix='forge-')
    const skillPath = path.join(configDir, 'skills', 'forge-quick', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'forge-quick/SKILL.md exists');

    // Verify content
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes('name: forge-quick'), 'frontmatter name uses hyphen form (#2808)');
    assert.ok(content.includes('description:'), 'description present');
    assert.ok(content.includes('allowed-tools:'), 'allowed-tools preserved');
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

    installRuntimeArtifacts('qwen', configDir, 'global', resolvedProfileFull);

    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge-next', 'SKILL.md'), 'utf8');
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

    installRuntimeArtifacts('qwen', configDir, 'global', resolvedProfileFull);

    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge-plan', 'SKILL.md'), 'utf8');
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

    // Pre-create a stale skill at the new layout location
    const staleSkillDir = path.join(configDir, 'skills', 'forge-old-skill');
    fs.mkdirSync(staleSkillDir, { recursive: true });
    fs.writeFileSync(path.join(staleSkillDir, 'SKILL.md'), 'old');

    installRuntimeArtifacts('qwen', configDir, 'global', resolvedProfileFull);

    assert.ok(!fs.existsSync(staleSkillDir), 'stale skill removed');
    assert.ok(fs.existsSync(path.join(configDir, 'skills', 'forge-quick', 'SKILL.md')), 'new skill installed');
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

    installRuntimeArtifacts('qwen', configDir, 'global', resolvedProfileFull);

    const content = fs.readFileSync(path.join(configDir, 'skills', 'forge-execute', 'SKILL.md'), 'utf8');
    assert.ok(content.includes('agent: forge-executor'), 'agent field preserved');
  });
});

// ─── Integration: SKILL.md format validation ────────────────────────────────

describe('Qwen Code: SKILL.md format validation', () => {
  test('SKILL.md frontmatter is valid YAML structure', () => {
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

    const result = convertClaudeCommandToClaudeSkill(input, 'forge-review');

    // Parse the frontmatter
    const fmMatch = result.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fmMatch, 'has frontmatter block');

    const fmLines = fmMatch[1].split('\n');
    const hasName = fmLines.some(l => l.startsWith('name: forge-review'));
    const hasDesc = fmLines.some(l => l.startsWith('description:'));
    const hasAgent = fmLines.some(l => l.startsWith('agent:'));
    const hasTools = fmLines.some(l => l.startsWith('allowed-tools:'));

    assert.ok(hasName, 'name field correct');
    assert.ok(hasDesc, 'description field present');
    assert.ok(hasAgent, 'agent field present');
    assert.ok(hasTools, 'allowed-tools field present');
  });
});
