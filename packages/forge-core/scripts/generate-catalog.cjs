#!/usr/bin/env node
//
// generate-catalog.cjs
//
// Scans packages/forge-core/commands/forge/*.md and packages/forge-core/skills/.
// and emits a single JSON manifest at packages/forge-core/forge-core.catalog.json.
//
// The manifest is the canonical machine-readable view of every forge-prefixed command
// vendored from upstream. apps/forge imports this directly to render its
// Command Center UI without re-parsing 69 markdown files at runtime.
//
// Each entry includes:
//   - id, name, label, description, category, icon, estimatedDuration
//   - sourceFile (relative path within this package)
//   - skillFile (relative path within this package, if a skill exists)
//   - frontmatter (raw YAML frontmatter for advanced consumers)
//

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'forge');
const SKILLS_DIR = path.join(ROOT, 'skills');
const OUT_FILE = path.join(ROOT, 'forge-core.catalog.json');

// ---------------------------------------------------------------------------
// Frontmatter parser (tiny, dependency-free).
// Matches the SKILL.md / command .md frontmatter shape used by upstream.
// ---------------------------------------------------------------------------
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const fm = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    // Strip surrounding quotes.
    value = value.replace(/^["']|["']$/g, '');
    // Parse YAML lists: "- a\n- b" was flattened; fall back to comma split.
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''));
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body };
}

// ---------------------------------------------------------------------------
// Category mapping — derive Forge Command Center categories from skill names.
// (The upstream SKILL.md doesn't carry a category; we infer it from naming.)
// ---------------------------------------------------------------------------
// Upstream planning-system commands that don't fit the delivery taxonomy.
// They get the dedicated "operational" category so they show up alongside
// workflow commands without polluting development / testing / etc.
const OPERATIONAL_COMMANDS = new Set([
  'forge-ai-integration-phase',
  'forge-audit-fix',
  'forge-audit-milestone',
  'forge-audit-uat',
  'forge-autonomous',
  'forge-capture',
  'forge-cleanup',
  'forge-code-review',
  'forge-config',
  'forge-debug',
  'forge-discuss-phase',
  'forge-docs-update',
  'forge-eval-review',
  'forge-explore',
  'forge-extract-learnings',
  'forge-fast',
  'forge-forensics',
  'forge-graphify',
  'forge-health',
  'forge-help',
  'forge-import',
  'forge-inbox',
  'forge-ingest-docs',
  'forge-manager',
  'forge-map-codebase',
  'forge-mempalace-capture',
  'forge-mempalace-recall',
  'forge-milestone-summary',
  'forge-mvp-phase',
  'forge-new-milestone',
  'forge-new-project',
  'forge-ns-context',
  'forge-ns-ideate',
  'forge-ns-manage',
  'forge-ns-project',
  'forge-ns-review',
  'forge-ns-workflow',
  'forge-pause-work',
  'forge-phase',
  'forge-plan-phase',
  'forge-plan-review-convergence',
  'forge-pr-branch',
  'forge-profile-user',
  'forge-progress',
  'forge-quick',
  'forge-resume-work',
  'forge-review',
  'forge-review-backlog',
  'forge-secure-phase',
  'forge-settings',
  'forge-ship',
  'forge-sketch',
  'forge-spec-phase',
  'forge-spike',
  'forge-stats',
  'forge-surface',
  'forge-thread',
  'forge-ui-phase',
  'forge-ui-review',
  'forge-ultraplan-phase',
  'forge-undo',
  'forge-update',
  'forge-validate-phase',
  'forge-verify-work',
  'forge-workspace',
  'forge-workstreams',
]);

const CATEGORY_RULES = [
  { match: /onboard/, category: 'onboarding' },
  { match: /workspace-create|workspace-destroy/, category: 'onboarding' },
  { match: /intel-|project-intelligence|pi-|ingest-sources|build-graph|find-owners|risk-scan|export-graph/, category: 'project-intelligence' },
  { match: /ideate|ideation|ns-ideate|brainstorm|prioritize|spike|refine|compare|prune|crystallize/, category: 'ideation' },
  { match: /arch-|adr-|diagram|component-map|contract-spec|data-model|drift|dependency-graph/, category: 'architecture' },
  { match: /dev-|implement|fix-bug|refactor|format|lint|hotfix|migrate|scaffold|new-feature/, category: 'development' },
  { match: /add-tests|test-|qa-|coverage|unit-test|integration-test|e2e|flake|load-test/, category: 'testing' },
  { match: /sec-|security|threat-model|sbom|sast|sca|secrets|incident|policy-check|audit-export/, category: 'security' },
  { match: /review-diff|review-risk|approve|request-changes|convention|review-pr/, category: 'code-review' },
  { match: /deploy|release|stage|prod-|rollback|status|feature-flag/, category: 'deployment' },
  { match: /milestone|ms-|cut-|tag-|archive|changelog/, category: 'milestones' },
  { match: /learn|capture-learning|knowledge|promote|skill-profile|search-learnings/, category: 'learning' },
  { match: /flow|pipeline|workflow|policy|define-pipeline|run-pipeline|cancel-run|run-policy/, category: 'workflow' },
  { match: /env-|environment|connector|secrets-rotate|backup|restore|agent-add/, category: 'environment' },
];

function inferCategory(name) {
  if (OPERATIONAL_COMMANDS.has(name)) return 'operational';
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(name)) return rule.category;
  }
  return 'operational';
}

// Pick a Lucide icon from the command name. Coarse mapping; designers can
// override per-command via `icon:` frontmatter.
const ICON_RULES = [
  { match: /onboard/, icon: 'Rocket' },
  { match: /workspace|destroy/, icon: 'FolderPlus' },
  { match: /developer|profile/, icon: 'UserPlus' },
  { match: /intel|graph|ingest/, icon: 'Database' },
  { match: /summarize|summary/, icon: 'FileText' },
  { match: /owner/, icon: 'Users' },
  { match: /risk/, icon: 'ShieldAlert' },
  { match: /ideate|brainstorm/, icon: 'Lightbulb' },
  { match: /prioritize|refine|compare|prune/, icon: 'ListChecks' },
  { match: /spike|crystallize/, icon: 'FlaskConical' },
  { match: /arch|adr|component|contract|drift|diagram|map/, icon: 'Network' },
  { match: /review|approve|convention|diff/, icon: 'GitPullRequestArrow' },
  { match: /deploy|stage|prod|release|status/, icon: 'Rocket' },
  { match: /rollback/, icon: 'Undo2' },
  { match: /flag/, icon: 'Flag' },
  { match: /test|coverage/, icon: 'TestTube' },
  { match: /load/, icon: 'Activity' },
  { match: /integration/, icon: 'Layers' },
  { match: /e2e|playwright/, icon: 'MonitorPlay' },
  { match: /flake/, icon: 'OctagonAlert' },
  { match: /sast|search/, icon: 'Search' },
  { match: /sca/, icon: 'PackageSearch' },
  { match: /secret/, icon: 'KeyRound' },
  { match: /threat/, icon: 'ShieldCheck' },
  { match: /sbom|badge/, icon: 'FileBadge' },
  { match: /learn|capture|knowledge/, icon: 'BookmarkPlus' },
  { match: /search/, icon: 'Search' },
  { match: /topic|summarize/, icon: 'BookText' },
  { match: /skill/, icon: 'GraduationCap' },
  { match: /flow|workflow|pipeline|plan/, icon: 'Workflow' },
  { match: /policy|gate/, icon: 'Gavel' },
  { match: /run|cancel/, icon: 'Play' },
  { match: /env|connector/, icon: 'Plug' },
  { match: /rotate/, icon: 'RefreshCw' },
  { match: /backup/, icon: 'Database' },
  { match: /restore/, icon: 'Undo2' },
  { match: /agent/, icon: 'Bot' },
  { match: /help/, icon: 'Wand2' },
];

function inferIcon(name) {
  for (const rule of ICON_RULES) {
    if (rule.match.test(name)) return rule.icon;
  }
  return 'Wand2';
}

function labelFromName(name) {
  // forge-dev-new-feature → "New feature"
  // forge-arch-diagram   → "Diagram"
  // forge-help           → "Help"
  const stripped = name.replace(/^forge-/, '');
  return stripped
    .split('-')
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const commandFiles = fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const entries = commandFiles.map((file) => {
    const filePath = path.join(COMMANDS_DIR, file);
    const text = fs.readFileSync(filePath, 'utf8');
    const { frontmatter } = parseFrontmatter(text);
    const baseName = file.replace(/\.md$/, '');
    const skillDir = path.join(SKILLS_DIR, `forge-${baseName}`);
    const skillFile = fs.existsSync(path.join(skillDir, 'SKILL.md'))
      ? `skills/forge-${baseName}/SKILL.md`
      : null;
    return {
      id: `forge-${baseName}`,
      name: `forge-${baseName}`,
      label: labelFromName(`forge-${baseName}`),
      description: String(frontmatter.description ?? ''),
      category: inferCategory(`forge-${baseName}`),
      icon: frontmatter.icon || inferIcon(`forge-${baseName}`),
      estimatedDuration: frontmatter.estimatedDuration
        ? Number(frontmatter.estimatedDuration)
        : 60,
      sourceFile: `commands/forge/${file}`,
      skillFile,
      frontmatter,
    };
  });

  const out = {
    $schema: 'https://forge.ai/schemas/forge-core-catalog.v1.json',
    generatedAt: new Date().toISOString(),
    engineVersion: '1.6.0-rc.3',
    enginePackage: '@forge-ai/forge-core',
    commandCount: entries.length,
    commands: entries,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(
    `Wrote ${entries.length} commands to ${path.relative(ROOT, OUT_FILE)}`,
  );
}

main();
