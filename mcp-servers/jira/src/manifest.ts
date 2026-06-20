/**
 * `@fora/mcp-jira` — `ServerManifest` registration record.
 *
 * Drops the existing Jira MCP server into the FORA 0.3 router framework
 * (FORA-48 §3 / AC #4) without touching `tools.ts`, `client.ts`, or
 * `config.ts`. The router uses this manifest to:
 *   1. list the server + its tools (audit, palette UI),
 *   2. enforce the tenant scope gate (`tenantScope: 'tenant'`),
 *   3. resolve the per-(tenant, server) credential via the customer-cloud
 *      broker (FORA-448),
 *   4. spawn the upstream MCP stdio process (`bin` + `argv`).
 *
 * The tool `input_schema` is the JSON-Schema form of each tool's Zod shape
 * (see `tools.ts`). It is intentionally re-declared here as JSON Schema so
 * the router/UI layer never needs to load Zod to introspect shapes — and so
 * the manifest stays valid even if the source Zod definition changes names.
 *
 * Tenant binding: Jira is `tenant`-scoped (one Atlassian project per tenant
 * at boot time), so the `tenantId` is stamped into the manifest at
 * registration. The factory below is the seam: the runtime (apps, agents,
 * tests) calls `createJiraManifest(tenantId)` once per tenant and hands the
 * result to `router.registerServer(...)`.
 */

import {
  asServerName,
  asToolName,
  type McpToolDescriptor,
  type ServerManifest,
  type TenantId,
} from '@fora/mcp-router';

/** Canonical server name — matches `index.ts` (`name: "fora-mcp-jira"`). */
export const JIRA_SERVER_NAME = asServerName('jira');

/**
 * JSON-Schema forms of the 6 tool inputs declared in `tools.ts`.
 *
 * These are intentionally static objects (not derived via `zod-to-json-schema`
 * at runtime) so the manifest is portable across runtimes that don't ship
 * Zod — the router / UI / broker boundary is JSON Schema only.
 */
const TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = [
  {
    name: asToolName('list_issues'),
    label: 'List Issues',
    description:
      'List recent issues in the pinned project. Equivalent to a JQL search of `project = <PINNED> ORDER BY updated DESC`. Use this to discover what issues exist before making other calls.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
          description: 'Page size, 1-100. Default 50.',
        },
        startAt: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Offset for pagination. Default 0.',
        },
      },
    },
    tags: ['read'],
  },
  {
    name: asToolName('search_jql'),
    label: 'Search JQL',
    description:
      'Search issues with an explicit JQL query. The query\'s `project = ...` qualifier is asserted against the pinned project. Returns a compact summary of each issue.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['jql'],
      properties: {
        jql: {
          type: 'string',
          minLength: 1,
          description:
            'JQL query string, e.g. `project = FORA AND status = "In Progress" ORDER BY updated DESC`. Server checks the project qualifier against the pinned project.',
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50,
          description: 'Page size, 1-100. Default 50.',
        },
        startAt: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Offset for pagination. Default 0.',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of Jira field names to return. Defaults to a compact set (summary, status, issuetype, priority, updated).',
        },
      },
    },
    tags: ['read'],
  },
  {
    name: asToolName('get_issue'),
    label: 'Get Issue',
    description:
      'Get a single issue by key (e.g. `FORA-123`) or ID, including its current status, available transitions, and metadata. The issue must belong to the pinned project.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueIdOrKey'],
      properties: {
        issueIdOrKey: {
          type: 'string',
          minLength: 1,
          description:
            'Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project.',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of Jira field names to return. Defaults to a compact set.',
        },
      },
    },
    tags: ['read'],
  },
  {
    name: asToolName('create_issue'),
    label: 'Create Issue',
    description:
      'Create a new issue in the pinned project. The project is server-pinned; do not pass a project key. Returns the new issue\'s key, ID, and browse URL.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: {
        summary: { type: 'string', minLength: 1, description: 'Issue title / summary.' },
        description: {
          type: 'string',
          description:
            'Plain-text description. Blank lines are treated as paragraph breaks (Atlassian Document Format).',
        },
        issueTypeName: {
          type: 'string',
          default: 'Task',
          description:
            'Issue type name, e.g. `Task`, `Bug`, `Story`. Must exist in the pinned project. Default `Task`.',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of label strings to apply.',
        },
        priority: {
          type: 'string',
          description:
            'Optional priority name, e.g. `High`, `Medium`, `Low`. Must exist in the priority scheme.',
        },
      },
    },
    tags: ['write', 'mutation'],
  },
  {
    name: asToolName('add_comment'),
    label: 'Add Comment',
    description:
      'Post a comment on an issue. The `body` is plain text — blank lines become paragraph breaks in Atlassian Document Format. The issue must belong to the pinned project.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueIdOrKey', 'body'],
      properties: {
        issueIdOrKey: {
          type: 'string',
          minLength: 1,
          description:
            'Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project.',
        },
        body: {
          type: 'string',
          minLength: 1,
          description:
            'Comment body as plain text (blank lines become ADF paragraph breaks).',
        },
      },
    },
    tags: ['write', 'mutation'],
  },
  {
    name: asToolName('transition_issue'),
    label: 'Transition Issue',
    description:
      'Move an issue to a new workflow status. Use `transitionId` for exactness or `transitionName` for a human-friendly name (case-insensitive). Use get_issue to see the available transitions for an issue.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueIdOrKey'],
      properties: {
        issueIdOrKey: {
          type: 'string',
          minLength: 1,
          description:
            'Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project.',
        },
        transitionId: {
          type: 'string',
          description:
            "Transition ID from the issue's workflow. Use get_issue to discover IDs.",
        },
        transitionName: {
          type: 'string',
          description:
            'Human-friendly transition name (e.g. `Done`, `In Progress`). Case-insensitive; resolved against the issue\'s current transitions.',
        },
      },
    },
    tags: ['write', 'mutation'],
  },
];

/**
 * Build a `ServerManifest` bound to a specific tenant.
 *
 * Each tenant gets a fresh manifest stamped with its `tenantId`; the router
 * enforces the scope gate (`manifest.tenantId === ctx.tenant_id`) on every
 * resolve/invoke, so a peer-tenant manifest cannot serve cross-tenant calls.
 *
 * `bin` / `argv` point at the existing `bin/fora-mcp-jira.mjs` entry — the
 * transport spawns the upstream MCP stdio process with the resolved
 * credential stamped into `JIRA_EMAIL` / `JIRA_API_TOKEN` by the broker.
 */
export function createJiraManifest(tenantId: TenantId): ServerManifest {
  return {
    name: JIRA_SERVER_NAME,
    bin: 'node',
    argv: ['bin/fora-mcp-jira.mjs'],
    tenantScope: 'tenant',
    tenantId,
    tools: TOOL_DESCRIPTORS,
    healthcheck: { kind: 'none' },
  };
}

/** Re-export the `ServerManifest` type for callers that import from this module. */
export type { ServerManifest } from '@fora/mcp-router';
