/**
 * MCP server registry — UI mirror of backend `mcp_registry.py`.
 *
 * The Connector Center Marketplace tab prefers a live fetch from
 * `GET /api/v1/mcp/servers`, but the UI also keeps a typed fallback
 * list so the page renders before the backend is reachable (dev mode,
 * offline, demos). The fallback MUST stay in lock-step with
 * `backend/app/services/mcp_registry.py` — both files are
 * regenerable from the same source-of-truth contract.
 */

export type MCPCategory =
  | 'version_control'
  | 'project_management'
  | 'documentation'
  | 'design'
  | 'communication'
  | 'cloud'
  | 'security'
  | 'analytics'
  | 'support';

export interface MCPServerDefinition {
  name: string;
  displayName: string;
  description: string;
  category: MCPCategory;
  version: string;
  authMethods: ReadonlyArray<string>;
  configSchema: Record<string, unknown>;
  capabilities: ReadonlyArray<string>;
  rateLimits?: Record<string, unknown> | null;
  icon?: string | null;
  docsUrl?: string | null;
  installable?: boolean;
  tags?: ReadonlyArray<string>;
}

export interface MCPCategoryDescriptor {
  value: MCPCategory;
  label: string;
}

export const CATEGORY_LABELS: Readonly<Record<MCPCategory, string>> = {
  version_control: 'Source control',
  project_management: 'Project management',
  documentation: 'Documentation',
  design: 'Design',
  communication: 'Communication',
  cloud: 'Cloud',
  security: 'Security',
  analytics: 'Analytics',
  support: 'Support',
};

export const CATEGORY_DESCRIPTORS: ReadonlyArray<MCPCategoryDescriptor> = (
  Object.entries(CATEGORY_LABELS) as ReadonlyArray<[MCPCategory, string]>
).map(([value, label]) => ({ value, label }));

export const MCP_REGISTRY_FALLBACK: ReadonlyArray<MCPServerDefinition> = [
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Source control, pull requests, issues, Actions',
    category: 'version_control',
    version: '1.0.0',
    authMethods: ['pat', 'github_app'],
    configSchema: {
      type: 'object',
      required: ['token', 'org'],
      properties: {
        token: { type: 'string' },
        org: { type: 'string' },
        base_url: { type: 'string', default: 'https://api.github.com' },
      },
    },
    capabilities: ['read_repos', 'create_pr', 'read_issues', 'create_issue', 'trigger_workflow'],
    icon: 'Github',
  },
  {
    name: 'jira',
    displayName: 'Jira',
    description: 'Issue tracking, sprints, agile boards',
    category: 'project_management',
    version: '1.0.0',
    authMethods: ['api_token', 'oauth'],
    configSchema: {
      type: 'object',
      required: ['url', 'email', 'api_token', 'project_key'],
      properties: {
        url: { type: 'string' },
        email: { type: 'string' },
        api_token: { type: 'string' },
        project_key: { type: 'string' },
      },
    },
    capabilities: ['create_issue', 'update_issue', 'read_boards', 'create_epic'],
    icon: 'Trello',
  },
  {
    name: 'confluence',
    displayName: 'Confluence',
    description: 'Wiki pages, knowledge base, document collaboration',
    category: 'documentation',
    version: '1.0.0',
    authMethods: ['api_token', 'oauth'],
    configSchema: {
      type: 'object',
      required: ['url', 'email', 'api_token', 'space_key'],
      properties: {
        url: { type: 'string' },
        email: { type: 'string' },
        api_token: { type: 'string' },
        space_key: { type: 'string' },
      },
    },
    capabilities: ['read_pages', 'create_page', 'update_page', 'search'],
    icon: 'BookOpen',
  },
  {
    name: 'figma',
    displayName: 'Figma',
    description: 'Design files, components, design tokens',
    category: 'design',
    version: '1.0.0',
    authMethods: ['pat'],
    configSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string' },
        team_id: { type: 'string' },
      },
    },
    capabilities: ['read_file', 'read_components', 'export_assets'],
    icon: 'Figma',
  },
  {
    name: 'slack',
    displayName: 'Slack',
    description: 'Team communication, channels, threads',
    category: 'communication',
    version: '1.0.0',
    authMethods: ['oauth', 'webhook'],
    configSchema: {
      type: 'object',
      required: ['bot_token'],
      properties: {
        bot_token: { type: 'string' },
        channel_id: { type: 'string' },
      },
    },
    capabilities: ['send_message', 'read_messages', 'create_channel'],
    icon: 'Slack',
  },
  {
    name: 'aws',
    displayName: 'AWS',
    description: 'Cloud infrastructure, S3, ECS, RDS, IAM',
    category: 'cloud',
    version: '1.0.0',
    authMethods: ['iam_role', 'access_key'],
    configSchema: {
      type: 'object',
      required: ['region'],
      properties: {
        region: { type: 'string', default: 'us-east-1' },
        role_arn: { type: 'string' },
        external_id: { type: 'string' },
      },
    },
    capabilities: ['read_s3', 'list_ecs', 'describe_rds', 'read_secrets'],
    icon: 'Cloud',
  },
  {
    name: 'azure_devops',
    displayName: 'Azure DevOps',
    description: 'Repos, pipelines, work items',
    category: 'version_control',
    version: '1.0.0',
    authMethods: ['pat'],
    configSchema: {
      type: 'object',
      required: ['org', 'project', 'pat'],
      properties: {
        org: { type: 'string' },
        project: { type: 'string' },
        pat: { type: 'string' },
      },
    },
    capabilities: ['read_repos', 'create_pr', 'trigger_pipeline'],
    icon: 'GitBranch',
  },
  {
    name: 'sonarqube',
    displayName: 'SonarQube',
    description: 'Code quality, security scanning, technical debt',
    category: 'security',
    version: '1.0.0',
    authMethods: ['token'],
    configSchema: {
      type: 'object',
      required: ['url', 'token'],
      properties: {
        url: { type: 'string' },
        token: { type: 'string' },
        project_key: { type: 'string' },
      },
    },
    capabilities: ['scan', 'read_issues', 'read_quality_gate'],
    icon: 'Shield',
  },
  {
    name: 'secrets',
    displayName: 'Secrets Manager',
    description: 'AWS Secrets Manager, HashiCorp Vault',
    category: 'security',
    version: '1.0.0',
    authMethods: ['iam_role'],
    configSchema: {
      type: 'object',
      required: ['backend'],
      properties: {
        backend: { type: 'string', enum: ['aws_secrets', 'vault'] },
        region: { type: 'string' },
      },
    },
    capabilities: ['read_secret', 'rotate_secret'],
    icon: 'Key',
  },
  {
    name: 'zendesk',
    displayName: 'Zendesk',
    description: 'Customer support tickets, knowledge base',
    category: 'support',
    version: '1.0.0',
    authMethods: ['api_token', 'oauth'],
    configSchema: {
      type: 'object',
      required: ['subdomain', 'email', 'api_token'],
      properties: {
        subdomain: { type: 'string' },
        email: { type: 'string' },
        api_token: { type: 'string' },
      },
    },
    capabilities: ['read_tickets', 'create_ticket', 'update_ticket'],
    icon: 'Headphones',
  },
  {
    name: 'databricks',
    displayName: 'Databricks',
    description: 'Data engineering, ML, analytics',
    category: 'analytics',
    version: '1.0.0',
    authMethods: ['pat'],
    configSchema: {
      type: 'object',
      required: ['host', 'token'],
      properties: {
        host: { type: 'string' },
        token: { type: 'string' },
      },
    },
    capabilities: ['read_jobs', 'trigger_job', 'read_tables'],
    icon: 'Database',
  },
  {
    name: 'arch_analyzer',
    displayName: 'Architecture Analyzer',
    description: 'Detect architecture patterns, anti-patterns, code structure',
    category: 'analytics',
    version: '1.0.0',
    authMethods: ['none'],
    configSchema: { type: 'object', properties: {} },
    capabilities: ['analyze_repo', 'detect_patterns'],
    icon: 'Network',
  },
  {
    name: 'clickup',
    displayName: 'ClickUp',
    description: 'Tasks, docs, goals, time tracking, custom workflows',
    category: 'project_management',
    version: '1.0.0',
    authMethods: ['api_token', 'oauth'],
    configSchema: {
      type: 'object',
      required: ['api_token', 'workspace_id'],
      properties: {
        api_token: { type: 'string' },
        workspace_id: { type: 'string' },
        team_id: { type: 'string' },
      },
    },
    capabilities: ['read_tasks', 'create_task', 'update_task', 'read_spaces', 'read_goals'],
    icon: 'CheckSquare',
    tags: ['pm', 'tasks'],
  },
  {
    name: 'adobe_xd',
    displayName: 'Adobe XD',
    description: 'Design prototypes, artboards, components, design specs',
    category: 'design',
    version: '1.0.0',
    authMethods: ['oauth'],
    configSchema: {
      type: 'object',
      required: ['client_id', 'client_secret'],
      properties: {
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        project_id: { type: 'string' },
      },
    },
    capabilities: ['read_prototypes', 'read_artboards', 'read_components', 'export_assets'],
    icon: 'PenTool',
    tags: ['design', 'prototyping'],
  },
  {
    name: 'kiro',
    displayName: 'Kiro',
    description: 'AI-powered IDE assistant, spec-driven development, agentic coding',
    category: 'version_control',
    version: '1.0.0',
    authMethods: ['api_token'],
    configSchema: {
      type: 'object',
      required: ['api_token'],
      properties: {
        api_token: { type: 'string' },
        workspace_id: { type: 'string' },
      },
    },
    capabilities: ['read_specs', 'create_spec', 'trigger_agent', 'read_runs'],
    icon: 'Sparkles',
    tags: ['ai', 'ide', 'agentic'],
  },
];

export function listMCPServers(): ReadonlyArray<MCPServerDefinition> {
  return MCP_REGISTRY_FALLBACK;
}

export function getMCPServer(name: string): MCPServerDefinition | undefined {
  return MCP_REGISTRY_FALLBACK.find((s) => s.name === name);
}

export function listMCPCategories(): ReadonlyArray<MCPCategoryDescriptor> {
  return CATEGORY_DESCRIPTORS;
}
