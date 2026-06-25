/**
 * Tests for skill-manifest command
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeSkill(rootDir, name, description, body = '') {
  const skillDir = path.join(rootDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    body || `# ${name}`,
  ].join('\n'));
}

describe('skill-manifest', () => {
  let tmpDir;
  let homeDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    homeDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-skill-manifest-home-'));

    writeSkill(path.join(tmpDir, '.claude', 'skills'), 'project-claude', 'Project Claude skill');
    writeSkill(path.join(tmpDir, '.claude', 'skills'), 'forge-help', 'Installed GSD skill');
    writeSkill(path.join(tmpDir, '.agents', 'skills'), 'project-agents', 'Project agent skill');
    writeSkill(path.join(tmpDir, '.codex', 'skills'), 'project-codex', 'Project Codex skill');

    writeSkill(path.join(homeDir, '.claude', 'skills'), 'global-claude', 'Global Claude skill');
    writeSkill(path.join(homeDir, '.codex', 'skills'), 'global-codex', 'Global Codex skill');
    writeSkill(
      path.join(homeDir, '.claude', 'forge-core', 'skills'),
      'legacy-import',
      'Deprecated import-only skill'
    );

    fs.mkdirSync(path.join(homeDir, '.claude', 'commands', 'forge'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', 'commands', 'forge', 'help.md'), '# legacy');
  });

  afterEach(() => {
    cleanup(tmpDir);
    cleanup(homeDir);
  });

  test('returns normalized inventory across canonical roots', () => {
    // On Windows, os.homedir() reads USERPROFILE (not HOME). The SUT scans
    // global skill roots via os.homedir(), so the test must also override
    // USERPROFILE to keep the fixture's homeDir visible.
    const result = runGsdTools(['skill-manifest'], tmpDir, { HOME: homeDir, USERPROFILE: homeDir });
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    assert.ok(Array.isArray(manifest.skills), 'skills should be an array');
    assert.ok(Array.isArray(manifest.roots), 'roots should be an array');
    assert.ok(manifest.installation && typeof manifest.installation === 'object', 'installation summary present');
    assert.ok(manifest.counts && typeof manifest.counts === 'object', 'counts summary present');

    const skillNames = manifest.skills.map((skill) => skill.name).sort();
    assert.deepStrictEqual(skillNames, [
      'global-claude',
      'global-codex',
      'forge-help',
      'legacy-import',
      'project-agents',
      'project-claude',
      'project-codex',
    ]);

    const codexSkill = manifest.skills.find((skill) => skill.name === 'project-codex');
    assert.deepStrictEqual(
      {
        root: codexSkill.root,
        scope: codexSkill.scope,
        installed: codexSkill.installed,
        deprecated: codexSkill.deprecated,
      },
      {
        root: '.codex/skills',
        scope: 'project',
        installed: true,
        deprecated: false,
      }
    );

    const importedSkill = manifest.skills.find((skill) => skill.name === 'legacy-import');
    assert.deepStrictEqual(
      {
        root: importedSkill.root,
        scope: importedSkill.scope,
        installed: importedSkill.installed,
        deprecated: importedSkill.deprecated,
      },
      {
        root: '.claude/forge-core/skills',
        scope: 'import-only',
        installed: false,
        deprecated: true,
      }
    );

    const gsdSkill = manifest.skills.find((skill) => skill.name === 'forge-help');
    assert.strictEqual(gsdSkill.installed, true);

    const legacyRoot = manifest.roots.find((root) => root.scope === 'legacy-commands');
    assert.ok(legacyRoot, 'legacy commands root should be reported');
    assert.strictEqual(legacyRoot.present, true);

    assert.strictEqual(manifest.installation.gsd_skills_installed, true);
    assert.strictEqual(manifest.installation.legacy_claude_commands_installed, true);
    assert.strictEqual(manifest.counts.skills, 7);
  });

  test('writes manifest to .planning/skill-manifest.json when --write flag is used', () => {
    const result = runGsdTools(['skill-manifest', '--write'], tmpDir, { HOME: homeDir, USERPROFILE: homeDir });
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifestPath = path.join(tmpDir, '.planning', 'skill-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'skill-manifest.json should be written to .planning/');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.ok(Array.isArray(manifest.skills));
    assert.ok(manifest.installation);
  });

  test('global roots honor runtime-home env overrides instead of hardcoded home paths', () => {
    const result = runGsdTools(['skill-manifest'], tmpDir, {
      HOME: homeDir,
      USERPROFILE: homeDir,
      CLAUDE_CONFIG_DIR: path.join(homeDir, 'claude-custom'),
      CODEX_HOME: path.join(homeDir, 'codex-custom'),
    });
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    const claudeRoot = manifest.roots.find((root) => root.root === '~/.claude/skills');
    const codexRoot = manifest.roots.find((root) => root.root === '~/.codex/skills');
    assert.ok(claudeRoot, 'Expected ~/.claude/skills root to be present');
    assert.ok(codexRoot, 'Expected ~/.codex/skills root to be present');
    assert.strictEqual(claudeRoot.path, path.join(homeDir, 'claude-custom', 'skills'));
    assert.strictEqual(codexRoot.path, path.join(homeDir, 'codex-custom', 'skills'));
  });

  // bug-929: nested layout discovery
  test('bug-929: discovers concrete skills nested under forge-ns-* routers', () => {
    // Mirrors the on-disk shape that stageSkillsForRuntimeAsSkills emits for
    // cline/qwen/hermes/augment/trae/antigravity when nested=true:
    //   <root>/forge-ns-workflow/SKILL.md             — router (top-level)
    //   <root>/forge-ns-workflow/skills/plan/SKILL.md — concrete
    //   <root>/forge-ns-workflow/skills/execute/SKILL.md — concrete
    //   <root>/forge-ns-workflow/skills/spec-phase/SKILL.md — dual-routed concrete
    //   <root>/forge-ns-manage/SKILL.md               — router (top-level)
    //   <root>/forge-ns-manage/skills/progress/SKILL.md — concrete
    //   <root>/forge-ns-manage/skills/spec-phase/SKILL.md — same dual-routed concrete (dedupe by name)
    //   <root>/forge-standalone/SKILL.md              — flat top-level skill (no skills/ subdir)
    const skillsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-nested-skills-'));

    function writeNestedSkill(dir, name, description) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        '---',
        '',
        `# ${name}`,
      ].join('\n'));
    }

    // Router 1: forge-ns-workflow
    writeNestedSkill(path.join(skillsDir, 'forge-ns-workflow'), 'forge-ns-workflow', 'Workflow router');
    writeNestedSkill(path.join(skillsDir, 'forge-ns-workflow', 'skills', 'plan'), 'forge-plan', 'Plan skill');
    writeNestedSkill(path.join(skillsDir, 'forge-ns-workflow', 'skills', 'execute'), 'forge-execute', 'Execute skill');
    writeNestedSkill(path.join(skillsDir, 'forge-ns-workflow', 'skills', 'spec-phase'), 'forge-spec-phase', 'Spec phase skill');

    // Router 2: forge-ns-manage
    writeNestedSkill(path.join(skillsDir, 'forge-ns-manage'), 'forge-ns-manage', 'Manage router');
    writeNestedSkill(path.join(skillsDir, 'forge-ns-manage', 'skills', 'progress'), 'forge-progress', 'Progress skill');
    // Same spec-phase under a second router (dual-routed); must appear exactly once in manifest
    writeNestedSkill(path.join(skillsDir, 'forge-ns-manage', 'skills', 'spec-phase'), 'forge-spec-phase', 'Spec phase skill');

    // Flat top-level skill (not a router, no skills/ subdir)
    writeNestedSkill(path.join(skillsDir, 'forge-standalone'), 'forge-standalone', 'Standalone flat skill');

    const result = runGsdTools(['skill-manifest', '--skills-dir', skillsDir], tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    const skillNames = manifest.skills.map((s) => s.name).sort();

    // 2 routers + 4 unique concretes (forge-spec-phase deduped) + 1 flat = 7 total
    assert.deepStrictEqual(skillNames, [
      'forge-execute',
      'forge-ns-manage',
      'forge-ns-workflow',
      'forge-plan',
      'forge-progress',
      'forge-spec-phase',
      'forge-standalone',
    ]);
    assert.strictEqual(manifest.counts.skills, 7, 'dual-routed concrete must be deduped to one entry');

    // Concrete skills should have a forward-slash nested file_path (posix-stable on all platforms)
    const planSkill = manifest.skills.find((s) => s.name === 'forge-plan');
    assert.ok(planSkill, 'forge-plan should be discovered');
    assert.ok(
      planSkill.file_path.includes('skills/plan'),
      `forge-plan file_path should reflect nested location with forward slashes, got: ${planSkill.file_path}`
    );

    // Router should also appear as a skill entry
    const routerSkill = manifest.skills.find((s) => s.name === 'forge-ns-workflow');
    assert.ok(routerSkill, 'forge-ns-workflow router should be discovered as a top-level skill');

    cleanup(skillsDir);
  });

  test('bug-929: discovers nested concretes even when router has no top-level SKILL.md', () => {
    // Edge case: a router dir has a skills/ subdir with concretes but no top-level SKILL.md.
    // The concrete skills should still be discovered.
    const skillsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-router-only-skills-'));

    // Router dir with skills/ but no SKILL.md of its own
    const concreteDir = path.join(skillsDir, 'forge-ns-noroot', 'skills', 'orphan-skill');
    fs.mkdirSync(concreteDir, { recursive: true });
    fs.writeFileSync(path.join(concreteDir, 'SKILL.md'), [
      '---',
      'name: forge-orphan',
      'description: Orphan skill under router without top-level SKILL.md',
      '---',
      '',
      '# forge-orphan',
    ].join('\n'));

    const result = runGsdTools(['skill-manifest', '--skills-dir', skillsDir], tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    assert.deepStrictEqual(
      manifest.skills.map((s) => s.name).sort(),
      ['forge-orphan'],
    );
    assert.strictEqual(manifest.counts.skills, 1);

    cleanup(skillsDir);
  });

  test('bug-929: flat layout (no nested skills/ subdirs) still works correctly', () => {
    const skillsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-flat-skills-'));

    function writeFlat(name, description) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        '---',
        '',
        `# ${name}`,
      ].join('\n'));
    }

    writeFlat('forge-alpha', 'Alpha skill');
    writeFlat('forge-beta', 'Beta skill');
    writeFlat('forge-gamma', 'Gamma skill');

    const result = runGsdTools(['skill-manifest', '--skills-dir', skillsDir], tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    assert.deepStrictEqual(
      manifest.skills.map((s) => s.name).sort(),
      ['forge-alpha', 'forge-beta', 'forge-gamma']
    );
    assert.strictEqual(manifest.counts.skills, 3, 'flat layout count should be exact, no phantom nesting');

    cleanup(skillsDir);
  });

  test('bug-929: non-gsd-ns-* dirs with a skills/ subdir are NOT scanned (guard)', () => {
    // Regression guard for the `if (!entry.name.startsWith('forge-ns-')) continue;` guard
    // in buildSkillManifest. A user tool dir like `my-tool/` that happens to have its
    // own `skills/` subdirectory must NOT have those skills vacuumed up.
    // Only `forge-ns-<router>/skills/<stem>/SKILL.md` paths are in scope.
    const skillsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-guard-test-'));

    // Non-router dir with a flat SKILL.md at its own root — SHOULD be found (flat scan).
    const topLevelDir = path.join(skillsDir, 'my-tool');
    fs.mkdirSync(topLevelDir, { recursive: true });
    fs.writeFileSync(path.join(topLevelDir, 'SKILL.md'), [
      '---',
      'name: my-tool',
      'description: A user-defined top-level skill',
      '---',
      '',
      '# my-tool',
    ].join('\n'));

    // Non-router dir with a nested skills/ subdir — nested skills must NOT be discovered.
    const nestedDir = path.join(skillsDir, 'my-tool', 'skills', 'helper');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'SKILL.md'), [
      '---',
      'name: my-tool-helper',
      'description: A nested skill that must not be vacuumed up',
      '---',
      '',
      '# my-tool-helper',
    ].join('\n'));

    // Another non-router dir (prefixed differently, could look router-like but isn't)
    const otherDir = path.join(skillsDir, 'forge-settings');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, 'SKILL.md'), [
      '---',
      'name: forge-settings',
      'description: A flat forge-* skill that is not a router',
      '---',
      '',
      '# forge-settings',
    ].join('\n'));
    // Give forge-settings its own skills/ subdir — must not be traversed since it's not forge-ns-*
    const otherNestedDir = path.join(skillsDir, 'forge-settings', 'skills', 'subsetting');
    fs.mkdirSync(otherNestedDir, { recursive: true });
    fs.writeFileSync(path.join(otherNestedDir, 'SKILL.md'), [
      '---',
      'name: forge-subsetting',
      'description: A nested skill that must not be vacuumed up',
      '---',
      '',
      '# forge-subsetting',
    ].join('\n'));

    const result = runGsdTools(['skill-manifest', '--skills-dir', skillsDir], tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error || result.output}`);

    const manifest = JSON.parse(result.output);
    const skillNames = manifest.skills.map((s) => s.name).sort();

    // Only the flat top-level SKILL.md entries should be found; nested non-router skills are ignored
    assert.deepStrictEqual(
      skillNames,
      ['forge-settings', 'my-tool'],
      'nested skills under non-gsd-ns-* dirs must not be discovered',
    );
    assert.strictEqual(
      manifest.counts.skills,
      2,
      'only 2 top-level skills; nested non-router helpers must not inflate the count',
    );

    // Confirm the forbidden names are absent
    assert.ok(
      !skillNames.includes('my-tool-helper'),
      'my-tool/skills/helper/SKILL.md must not appear (guard: my-tool is not forge-ns-*)',
    );
    assert.ok(
      !skillNames.includes('forge-subsetting'),
      'forge-settings/skills/subsetting/SKILL.md must not appear (guard: forge-settings is not forge-ns-*)',
    );

    cleanup(skillsDir);
  });
});
