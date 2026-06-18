/**
 * MCP tool definitions + handlers for the FORA SonarQube MCP server
 * — READ-ONLY (FORA-290).
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `projectKey` is intentionally NOT a tool input. The server is pinned
 * to a single project at startup; tools that touch a project either
 * pre-fill the pinned key, or — where the model must pass a sub-key like a
 * file or component — assert it against the pinned project prefix before
 * any call lands.
 *
 * SCOPE: This server exposes ONLY the read tools required by
 * SecurityEngineer's FORA-290 allow-list. The `transition_issue` write
 * tool was removed; the typed `Client` has no such method, and the
 * smoke test asserts no POST route is ever reached.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ListProjectsShape = {
  organization: z.string().optional()
    .describe("Optional SonarCloud organization slug. If omitted, lists projects visible to the token."),
  query: z.string().optional()
    .describe("Optional search filter applied to project key + name."),
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
  pageSize: z.number().int().min(1).max(500).default(30)
    .describe("Page size, 1-500. Default 30."),
};

const GetProjectShape = {
  projectKey: z.string().optional()
    .describe("Project key. Must equal the pinned project. Omit to fetch the pinned project."),
};

const SearchComponentsShape = {
  query: z.string().min(1).describe("Component search query (substring of path or name within the pinned project)."),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(30),
};

const GetComponentMeasuresShape = {
  component: z.string().min(1)
    .describe("Component key (file or directory). Must start with the pinned project key, e.g. 'myproj:src/foo.ts'."),
  metricKeys: z.array(z.string().min(1)).min(1)
    .describe("One or more metric keys, e.g. ['coverage','ncloc','code_smells']."),
};

const ListIssuesShape = {
  severities: z.array(z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"])).optional()
    .describe("Optional severity filter."),
  types: z.array(z.enum(["CODE_SMELL", "BUG", "VULNERABILITY", "SECURITY_HOTSPOT"])).optional()
    .describe("Optional type filter."),
  statuses: z.array(z.enum(["OPEN", "CONFIRMED", "REOPENED", "RESOLVED", "CLOSED"])).optional()
    .describe("Optional status filter."),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(30),
};

const GetIssueShape = {
  issueKey: z.string().min(1).describe("SonarQube issue key, e.g. 'AYxxx...'."),
};

const GetQualityGateShape = {
  projectKey: z.string().optional()
    .describe("Project key. Must equal the pinned project. Omit for the pinned project."),
};

const WebhooksGetShape = {
  projectKey: z.string().optional()
    .describe("Project key. Must equal the pinned project. Omit for the pinned project."),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(30),
};

// Parsers (full Zod objects) used inside the handler to validate the
// raw input the MCP SDK passes through.
const ListProjectsInput = z.object(ListProjectsShape).strict();
const GetProjectInput = z.object(GetProjectShape).strict();
const SearchComponentsInput = z.object(SearchComponentsShape).strict();
const GetComponentMeasuresInput = z.object(GetComponentMeasuresShape).strict();
const ListIssuesInput = z.object(ListIssuesShape).strict();
const GetIssueInput = z.object(GetIssueShape).strict();
const GetQualityGateInput = z.object(GetQualityGateShape).strict();
const WebhooksGetInput = z.object(WebhooksGetShape).strict();

export const toolDefinitions = [
  {
    name: "list_projects",
    description: "List SonarQube projects visible to the token. Use to discover or sanity-check the pinned project before other calls.",
    shape: ListProjectsShape,
  },
  {
    name: "get_project",
    description: "Get details for the pinned project (or another project, which will be asserted against the pin).",
    shape: GetProjectShape,
  },
  {
    name: "search_components",
    description: "Search files and directories within the pinned project. Useful before requesting measures for a specific file.",
    shape: SearchComponentsShape,
  },
  {
    name: "get_component_measures",
    description: "Read quality measures (coverage, complexity, code-smell counts, etc.) for a component in the pinned project.",
    shape: GetComponentMeasuresShape,
  },
  {
    name: "list_issues",
    description: "List code-quality findings (bugs, vulnerabilities, code smells, hotspots) in the pinned project. Defaults to OPEN issues; filter by severity/type/status as needed.",
    shape: ListIssuesShape,
  },
  {
    name: "get_issue",
    description: "Get a single issue by its SonarQube key. Returns the full issue record, including status, severity, and component path.",
    shape: GetIssueShape,
  },
  {
    name: "get_quality_gate",
    description: "Get the quality-gate evaluation for the pinned project. Returns overall status and the per-condition breakdown that drove it.",
    shape: GetQualityGateShape,
  },
  {
    name: "webhooks_get",
    description: "List recent webhook deliveries observed by the SonarQube server. Used by Security and DevOps agents to inspect CI integration health.",
    shape: WebhooksGetShape,
  },
] as const;

export type ToolName = (typeof toolDefinitions)[number]["name"];

export async function handleToolCall(
  client: Client,
  name: ToolName | string,
  rawArgs: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let result: unknown;
  switch (name) {
    case "list_projects": {
      const args = ListProjectsInput.parse(rawArgs ?? {});
      result = await client.listProjects(args);
      break;
    }
    case "get_project": {
      const args = GetProjectInput.parse(rawArgs ?? {});
      result = await client.getProject(args);
      break;
    }
    case "search_components": {
      const args = SearchComponentsInput.parse(rawArgs);
      result = await client.searchComponents(args);
      break;
    }
    case "get_component_measures": {
      const args = GetComponentMeasuresInput.parse(rawArgs);
      result = await client.getComponentMeasures(args);
      break;
    }
    case "list_issues": {
      const args = ListIssuesInput.parse(rawArgs ?? {});
      result = await client.listIssues(args);
      break;
    }
    case "get_issue": {
      const args = GetIssueInput.parse(rawArgs);
      result = await client.getIssue(args);
      break;
    }
    case "get_quality_gate": {
      const args = GetQualityGateInput.parse(rawArgs ?? {});
      result = await client.getQualityGate(args);
      break;
    }
    case "webhooks_get": {
      const args = WebhooksGetInput.parse(rawArgs ?? {});
      result = await client.webhooksGet(args);
      break;
    }
    default:
      throw new Error(
        `Unknown tool: ${name}. ` +
          `Note: this server is read-only (FORA-290). ` +
          `transition_issue was removed; the only write tool it ever had is gone.`,
      );
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
