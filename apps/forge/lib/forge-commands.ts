/**
 * Forge Command catalog.
 *
 * Mirrors the backend's `FORGE_COMMAND_MAP` so the UI can render the full set of
 * `forge-*` slash commands. This is the source of truth on the client; the backend
 * remains authoritative at execution time.
 *
 * White-label rule (DL-024): users only ever see `forge-*` commands here.
 */
export type ForgeCommandCategoryId =
  | 'onboarding'
  | 'project-intelligence'
  | 'ideation'
  | 'architecture'
  | 'development'
  | 'testing'
  | 'security'
  | 'code-review'
  | 'deployment'
  | 'milestones'
  | 'learning'
  | 'workflow'
  | 'environment';

export interface ForgeCommandCategory {
  id: ForgeCommandCategoryId;
  label: string;
  description: string;
}

export const FORGE_COMMAND_CATEGORIES: readonly ForgeCommandCategory[] = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'Bootstrap a new Forge workspace, project, or developer.',
  },
  {
    id: 'project-intelligence',
    label: 'Project Intelligence',
    description: 'Ingest sources, build graphs, and surface project context.',
  },
  {
    id: 'ideation',
    label: 'Ideation',
    description: 'Generate and prioritize product or technical ideas.',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'Author ADRs, diagrams, and subsystem decisions.',
  },
  {
    id: 'development',
    label: 'Development',
    description: 'Run coding workflows: features, fixes, refactors.',
  },
  {
    id: 'testing',
    label: 'Testing',
    description: 'Generate and run unit, integration, and e2e tests.',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Scan, threat-model, and remediate vulnerabilities.',
  },
  {
    id: 'code-review',
    label: 'Code Review',
    description: 'Review pull requests and enforce quality bars.',
  },
  {
    id: 'deployment',
    label: 'Deployment',
    description: 'Build, release, and roll back services.',
  },
  {
    id: 'milestones',
    label: 'Milestones',
    description: 'Plan, track, and report on milestones and OKRs.',
  },
  {
    id: 'learning',
    label: 'Learning',
    description: 'Capture, retrieve, and surface organizational learning.',
  },
  {
    id: 'workflow',
    label: 'Workflow',
    description: 'Configure pipelines, policies, and approvals.',
  },
  {
    id: 'environment',
    label: 'Environment',
    description: 'Manage workspaces, agents, and runtime configuration.',
  },
] as const;

export interface ForgeCommand {
  /** Slash-command name as shown to the user (e.g. `forge-dev-new-feature`). */
  name: string;
  /** Short label shown on cards and command-palette entries. */
  label: string;
  /** One-line description. */
  description: string;
  category: ForgeCommandCategoryId;
  /** Lucide icon name (looked up by the renderer; resolved client-side). */
  icon: string;
  /** Approximate runtime estimate in seconds; UI uses for progress UI. */
  estimatedDuration?: number;
}

export const FORGE_COMMANDS: readonly ForgeCommand[] = [
  // Onboarding
  {
    name: 'forge-onboard-workspace',
    label: 'Onboard workspace',
    description:
      'Bootstrap a Forge workspace with tenant defaults, persona policies, and starter agents.',
    category: 'onboarding',
    icon: 'Rocket',
    estimatedDuration: 90,
  },
  {
    name: 'forge-onboard-project',
    label: 'Onboard project',
    description:
      'Connect a repository, ingest its graph, and seed the project intelligence store.',
    category: 'onboarding',
    icon: 'FolderPlus',
    estimatedDuration: 120,
  },
  {
    name: 'forge-onboard-developer',
    label: 'Onboard developer',
    description:
      'Provision developer environment with SSH keys, MCP tokens, and skill profiles.',
    category: 'onboarding',
    icon: 'UserPlus',
    estimatedDuration: 60,
  },

  // Project Intelligence
  {
    name: 'forge-pi-ingest-sources',
    label: 'Ingest sources',
    description:
      'Connect GitHub, Jira, Notion, and Slack sources into the project graph.',
    category: 'project-intelligence',
    icon: 'Database',
    estimatedDuration: 180,
  },
  {
    name: 'forge-pi-build-graph',
    label: 'Build graph',
    description:
      'Rebuild the entities-and-edges graph from the latest source snapshots.',
    category: 'project-intelligence',
    icon: 'Network',
    estimatedDuration: 240,
  },
  {
    name: 'forge-pi-summarize',
    label: 'Summarize project',
    description:
      'Produce an LLM-rendered summary of the project state, risks, and recent activity.',
    category: 'project-intelligence',
    icon: 'FileText',
    estimatedDuration: 45,
  },
  {
    name: 'forge-pi-find-owners',
    label: 'Find owners',
    description:
      'Identify code owners and subject-matter experts for a path or symbol.',
    category: 'project-intelligence',
    icon: 'Users',
    estimatedDuration: 20,
  },
  {
    name: 'forge-pi-risk-scan',
    label: 'Risk scan',
    description:
      'Scan the graph for stale owners, undocumented services, and concentration risks.',
    category: 'project-intelligence',
    icon: 'ShieldAlert',
    estimatedDuration: 90,
  },

  // Ideation
  {
    name: 'forge-ideation-brainstorm',
    label: 'Brainstorm',
    description:
      'Generate a divergent set of ideas around a problem statement or opportunity.',
    category: 'ideation',
    icon: 'Lightbulb',
    estimatedDuration: 60,
  },
  {
    name: 'forge-ideation-prioritize',
    label: 'Prioritize ideas',
    description:
      'Score and rank ideas on impact, confidence, and effort using RICE-like weights.',
    category: 'ideation',
    icon: 'ListChecks',
    estimatedDuration: 30,
  },
  {
    name: 'forge-ideation-spike',
    label: 'Spike solution',
    description:
      'Run a timeboxed technical spike to validate or invalidate the chosen approach.',
    category: 'ideation',
    icon: 'FlaskConical',
    estimatedDuration: 180,
  },

  // Architecture
  {
    name: 'forge-arch-new-adr',
    label: 'New ADR',
    description:
      'Draft a new architecture decision record with context, options, and trade-offs.',
    category: 'architecture',
    icon: 'ScrollText',
    estimatedDuration: 60,
  },
  {
    name: 'forge-arch-diagram',
    label: 'Generate diagram',
    description:
      'Render a system or sequence diagram from a Mermaid or D2 source.',
    category: 'architecture',
    icon: 'Network',
    estimatedDuration: 30,
  },
  {
    name: 'forge-arch-review',
    label: 'Architecture review',
    description:
      'Review proposed changes against the existing architecture decision log.',
    category: 'architecture',
    icon: 'ClipboardCheck',
    estimatedDuration: 90,
  },

  // Development
  {
    name: 'forge-dev-new-feature',
    label: 'New feature',
    description:
      'Plan, scaffold, implement, and self-review a new product feature end-to-end.',
    category: 'development',
    icon: 'Wand2',
    estimatedDuration: 900,
  },
  {
    name: 'forge-dev-fix-bug',
    label: 'Fix bug',
    description:
      'Reproduce, root-cause, and fix a reported bug with regression tests.',
    category: 'development',
    icon: 'Bug',
    estimatedDuration: 600,
  },
  {
    name: 'forge-dev-refactor',
    label: 'Refactor',
    description:
      'Refactor a module or package while preserving external behavior and tests.',
    category: 'development',
    icon: 'Replace',
    estimatedDuration: 600,
  },
  {
    name: 'forge-dev-add-test',
    label: 'Add tests',
    description:
      'Add missing unit, integration, or e2e tests for an existing change.',
    category: 'development',
    icon: 'TestTube2',
    estimatedDuration: 300,
  },
  {
    name: 'forge-dev-update-deps',
    label: 'Update dependencies',
    description:
      'Bump dependencies, run lockfile refresh, and surface breaking-change risk.',
    category: 'development',
    icon: 'PackageOpen',
    estimatedDuration: 300,
  },
  {
    name: 'forge-dev-migrate',
    label: 'Migrate',
    description:
      'Run a codemod or framework migration across the repository.',
    category: 'development',
    icon: 'ArrowRightLeft',
    estimatedDuration: 900,
  },

  // Testing
  {
    name: 'forge-test-unit',
    label: 'Run unit tests',
    description:
      'Run the unit-test suite for the current repository or changed files only.',
    category: 'testing',
    icon: 'TestTube',
    estimatedDuration: 180,
  },
  {
    name: 'forge-test-integration',
    label: 'Run integration tests',
    description:
      'Run the integration test suite against ephemeral services.',
    category: 'testing',
    icon: 'Layers',
    estimatedDuration: 600,
  },
  {
    name: 'forge-test-e2e',
    label: 'Run e2e tests',
    description: 'Run the end-to-end browser tests against a preview environment.',
    category: 'testing',
    icon: 'MonitorPlay',
    estimatedDuration: 900,
  },
  {
    name: 'forge-test-coverage-report',
    label: 'Coverage report',
    description:
      'Generate a coverage report and identify under-covered modules.',
    category: 'testing',
    icon: 'PieChart',
    estimatedDuration: 180,
  },
  {
    name: 'forge-test-flake-scan',
    label: 'Flake scan',
    description:
      'Identify flaky tests in the recent history and quarantine them.',
    category: 'testing',
    icon: 'OctagonAlert',
    estimatedDuration: 240,
  },

  // Security
  {
    name: 'forge-sec-sast',
    label: 'SAST scan',
    description:
      'Run static application security testing across the codebase.',
    category: 'security',
    icon: 'Search',
    estimatedDuration: 300,
  },
  {
    name: 'forge-sec-sca',
    label: 'SCA scan',
    description:
      'Scan dependencies for known CVEs and license compliance issues.',
    category: 'security',
    icon: 'PackageSearch',
    estimatedDuration: 240,
  },
  {
    name: 'forge-sec-secrets',
    label: 'Secrets scan',
    description:
      'Detect committed secrets and credentials in the repository history.',
    category: 'security',
    icon: 'KeyRound',
    estimatedDuration: 120,
  },
  {
    name: 'forge-sec-threat-model',
    label: 'Threat model',
    description:
      'Generate a STRIDE-style threat model for a service or feature.',
    category: 'security',
    icon: 'ShieldCheck',
    estimatedDuration: 240,
  },
  {
    name: 'forge-sec-sbom',
    label: 'Generate SBOM',
    description:
      'Produce a CycloneDX or SPDX software bill of materials for the build.',
    category: 'security',
    icon: 'FileBadge',
    estimatedDuration: 180,
  },

  // Code Review
  {
    name: 'forge-cr-review-pr',
    label: 'Review PR',
    description:
      'Review a pull request with project conventions, risk, and test coverage signals.',
    category: 'code-review',
    icon: 'GitPullRequestArrow',
    estimatedDuration: 240,
  },
  {
    name: 'forge-cr-approve-pr',
    label: 'Approve PR',
    description:
      'Apply an approval or request-changes decision with a structured rationale.',
    category: 'code-review',
    icon: 'CheckCheck',
    estimatedDuration: 60,
  },
  {
    name: 'forge-cr-conventions',
    label: 'Check conventions',
    description:
      'Enforce style, naming, and architectural conventions on the diff.',
    category: 'code-review',
    icon: 'BookOpenCheck',
    estimatedDuration: 120,
  },
  {
    name: 'forge-cr-draft-summary',
    label: 'Draft PR summary',
    description:
      'Generate a reviewer-ready PR description with risk, test plan, and rollout notes.',
    category: 'code-review',
    icon: 'FileSignature',
    estimatedDuration: 60,
  },

  // Deployment
  {
    name: 'forge-deploy-build',
    label: 'Build release',
    description: 'Produce a release artifact for the current commit and tag.',
    category: 'deployment',
    icon: 'Package',
    estimatedDuration: 600,
  },
  {
    name: 'forge-deploy-staging',
    label: 'Deploy staging',
    description: 'Deploy the current build to the staging environment.',
    category: 'deployment',
    icon: 'Server',
    estimatedDuration: 480,
  },
  {
    name: 'forge-deploy-prod',
    label: 'Deploy production',
    description:
      'Promote the staging build to production with the standard rollout policy.',
    category: 'deployment',
    icon: 'Rocket',
    estimatedDuration: 600,
  },
  {
    name: 'forge-deploy-rollback',
    label: 'Rollback',
    description: 'Roll production back to the previous known-good release.',
    category: 'deployment',
    icon: 'Undo2',
    estimatedDuration: 300,
  },
  {
    name: 'forge-deploy-feature-flag',
    label: 'Toggle feature flag',
    description:
      'Toggle a feature flag for an environment, cohort, or individual user.',
    category: 'deployment',
    icon: 'Flag',
    estimatedDuration: 30,
  },

  // Milestones
  {
    name: 'forge-ms-plan',
    label: 'Plan milestone',
    description:
      'Draft a milestone plan with epics, deliverables, owners, and dates.',
    category: 'milestones',
    icon: 'Milestone',
    estimatedDuration: 240,
  },
  {
    name: 'forge-ms-track',
    label: 'Track progress',
    description:
      'Compute progress against a milestone and surface slip risk.',
    category: 'milestones',
    icon: 'TrendingUp',
    estimatedDuration: 120,
  },
  {
    name: 'forge-ms-report',
    label: 'Status report',
    description:
      'Generate an executive status report for a milestone or program.',
    category: 'milestones',
    icon: 'ClipboardList',
    estimatedDuration: 180,
  },
  {
    name: 'forge-ms-close',
    label: 'Close milestone',
    description: 'Close out a milestone with retro and lessons-learned capture.',
    category: 'milestones',
    icon: 'CheckCircle2',
    estimatedDuration: 120,
  },

  // Learning
  {
    name: 'forge-learn-capture',
    label: 'Capture learning',
    description:
      'Capture a postmortem, retro insight, or pattern into the knowledge base.',
    category: 'learning',
    icon: 'BookmarkPlus',
    estimatedDuration: 90,
  },
  {
    name: 'forge-learn-search',
    label: 'Search learnings',
    description:
      'Search the organizational learning base for a topic or pattern.',
    category: 'learning',
    icon: 'Search',
    estimatedDuration: 30,
  },
  {
    name: 'forge-learn-summarize',
    label: 'Summarize topic',
    description:
      'Synthesize learnings and links across the knowledge base for a topic.',
    category: 'learning',
    icon: 'BookText',
    estimatedDuration: 90,
  },
  {
    name: 'forge-learn-skill-profile',
    label: 'Update skill profile',
    description: 'Update an individual skill profile based on recent work.',
    category: 'learning',
    icon: 'GraduationCap',
    estimatedDuration: 60,
  },

  // Workflow
  {
    name: 'forge-flow-define',
    label: 'Define pipeline',
    description:
      'Define or update a workflow pipeline (stages, gates, owners, retries).',
    category: 'workflow',
    icon: 'Workflow',
    estimatedDuration: 180,
  },
  {
    name: 'forge-flow-policy',
    label: 'Set policy',
    description:
      'Set or update a policy: approval, required reviewers, risk tier.',
    category: 'workflow',
    icon: 'Gavel',
    estimatedDuration: 120,
  },
  {
    name: 'forge-flow-run',
    label: 'Run pipeline',
    description: 'Trigger a pipeline execution for a branch, tag, or ref.',
    category: 'workflow',
    icon: 'Play',
    estimatedDuration: 600,
  },
  {
    name: 'forge-flow-cancel',
    label: 'Cancel run',
    description: 'Cancel an in-flight pipeline run and clean up resources.',
    category: 'workflow',
    icon: 'Ban',
    estimatedDuration: 60,
  },

  // Environment
  {
    name: 'forge-env-workspace-create',
    label: 'Create workspace',
    description:
      'Provision a new ephemeral workspace with the configured agent pool.',
    category: 'environment',
    icon: 'PlusSquare',
    estimatedDuration: 120,
  },
  {
    name: 'forge-env-workspace-destroy',
    label: 'Destroy workspace',
    description: 'Tear down a workspace and release its resources.',
    category: 'environment',
    icon: 'Trash2',
    estimatedDuration: 90,
  },
  {
    name: 'forge-env-agent-add',
    label: 'Add agent',
    description: 'Register a new coding agent (Claude Code, Codex, etc).',
    category: 'environment',
    icon: 'Bot',
    estimatedDuration: 60,
  },
  {
    name: 'forge-env-connector-configure',
    label: 'Configure connector',
    description: 'Configure a connector (GitHub, Jira, Linear, Slack, etc).',
    category: 'environment',
    icon: 'Plug',
    estimatedDuration: 120,
  },
  {
    name: 'forge-env-secrets-rotate',
    label: 'Rotate secrets',
    description: 'Rotate tenant-level secrets and re-issue scoped credentials.',
    category: 'environment',
    icon: 'RefreshCw',
    estimatedDuration: 90,
  },
  {
    name: 'forge-env-backup',
    label: 'Backup environment',
    description:
      'Snapshot workspace state, agent pool config, and connector metadata.',
    category: 'environment',
    icon: 'Database',
    estimatedDuration: 240,
  },
  {
    name: 'forge-env-restore',
    label: 'Restore environment',
    description: 'Restore a workspace from a prior snapshot.',
    category: 'environment',
    icon: 'Undo2',
    estimatedDuration: 300,
  },
  {
    name: 'forge-arch-deps-graph',
    label: 'Dependency graph',
    description:
      'Generate a service / module dependency graph for the project.',
    category: 'architecture',
    icon: 'Network',
    estimatedDuration: 120,
  },
  {
    name: 'forge-test-load',
    label: 'Load test',
    description:
      'Run a load test against a preview environment with the recorded workload.',
    category: 'testing',
    icon: 'Activity',
    estimatedDuration: 900,
  },
  {
    name: 'forge-pi-export',
    label: 'Export graph',
    description: 'Export the project intelligence graph as JSON-LD or CSV.',
    category: 'project-intelligence',
    icon: 'Database',
    estimatedDuration: 60,
  },
];

export function commandsByCategory(
  category: ForgeCommandCategoryId,
): readonly ForgeCommand[] {
  return FORGE_COMMANDS.filter((c) => c.category === category);
}

export function searchCommands(query: string): readonly ForgeCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return FORGE_COMMANDS;
  return FORGE_COMMANDS.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q),
  );
}
