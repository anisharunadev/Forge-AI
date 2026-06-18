/**
 * MCP tool definitions + handlers for the FORA Jira MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `projectKey` is intentionally NOT a tool input. The server is pinned to
 * a single project at startup — the model can only pass `issueIdOrKey` and
 * the underlying project is server-pinned for safety, the same posture the
 * GitHub MCP takes with `GITHUB_ORG`.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ListIssuesShape = {
  maxResults: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
  startAt: z.number().int().min(0).default(0)
    .describe("Offset for pagination. Default 0."),
};

const SearchJqlShape = {
  jql: z.string().min(1)
    .describe("JQL query string, e.g. `project = FORA AND status = \"In Progress\" ORDER BY updated DESC`. Server checks the project qualifier against the pinned project."),
  maxResults: z.number().int().min(1).max(100).default(50)
    .describe("Page size, 1-100. Default 50."),
  startAt: z.number().int().min(0).default(0)
    .describe("Offset for pagination. Default 0."),
  fields: z.array(z.string()).optional()
    .describe("Optional list of Jira field names to return. Defaults to a compact set (summary, status, issuetype, priority, updated)."),
};

const GetIssueShape = {
  issueIdOrKey: z.string().min(1)
    .describe("Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project."),
  fields: z.array(z.string()).optional()
    .describe("Optional list of Jira field names to return. Defaults to a compact set."),
};

const CreateIssueShape = {
  summary: z.string().min(1).describe("Issue title / summary."),
  description: z.string().optional()
    .describe("Plain-text description. Blank lines are treated as paragraph breaks (Atlassian Document Format)."),
  issueTypeName: z.string().default("Task")
    .describe("Issue type name, e.g. `Task`, `Bug`, `Story`. Must exist in the pinned project. Default `Task`."),
  labels: z.array(z.string()).optional().describe("Optional list of label strings to apply."),
  priority: z.string().optional()
    .describe("Optional priority name, e.g. `High`, `Medium`, `Low`. Must exist in the priority scheme."),
};

const AddCommentShape = {
  issueIdOrKey: z.string().min(1)
    .describe("Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project."),
  body: z.string().min(1).describe("Comment body as plain text (blank lines become ADF paragraph breaks)."),
};

const TransitionIssueShape = {
  issueIdOrKey: z.string().min(1)
    .describe("Issue key (e.g. `FORA-123`) or numeric issue ID. Must belong to the pinned project."),
  transitionId: z.string().optional()
    .describe("Transition ID from the issue's workflow. Use get_issue to discover IDs."),
  transitionName: z.string().optional()
    .describe("Human-friendly transition name (e.g. `Done`, `In Progress`). Case-insensitive; resolved against the issue's current transitions."),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const ListIssuesInput = z.object(ListIssuesShape).strict();
const SearchJqlInput = z.object(SearchJqlShape).strict();
const GetIssueInput = z.object(GetIssueShape).strict();
const CreateIssueInput = z.object(CreateIssueShape).strict();
const AddCommentInput = z.object(AddCommentShape).strict();
const TransitionIssueInput = z.object(TransitionIssueShape).strict()
  .refine((v) => Boolean(v.transitionId) || Boolean(v.transitionName), {
    message: "Either `transitionId` or `transitionName` is required.",
  });

export const toolDefinitions = [
  {
    name: "list_issues",
    description: "List recent issues in the pinned project. Equivalent to a JQL search of `project = <PINNED> ORDER BY updated DESC`. Use this to discover what issues exist before making other calls.",
    shape: ListIssuesShape,
  },
  {
    name: "search_jql",
    description: "Search issues with an explicit JQL query. The query's `project = ...` qualifier is asserted against the pinned project. Returns a compact summary of each issue.",
    shape: SearchJqlShape,
  },
  {
    name: "get_issue",
    description: "Get a single issue by key (e.g. `FORA-123`) or ID, including its current status, available transitions, and metadata. The issue must belong to the pinned project.",
    shape: GetIssueShape,
  },
  {
    name: "create_issue",
    description: "Create a new issue in the pinned project. The project is server-pinned; do not pass a project key. Returns the new issue's key, ID, and browse URL.",
    shape: CreateIssueShape,
  },
  {
    name: "add_comment",
    description: "Post a comment on an issue. The `body` is plain text — blank lines become paragraph breaks in Atlassian Document Format. The issue must belong to the pinned project.",
    shape: AddCommentShape,
  },
  {
    name: "transition_issue",
    description: "Move an issue to a new workflow status. Use `transitionId` for exactness or `transitionName` for a human-friendly name (case-insensitive). Use get_issue to see the available transitions for an issue.",
    shape: TransitionIssueShape,
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
    case "list_issues": {
      const args = ListIssuesInput.parse(rawArgs ?? {});
      result = await client.listIssues(args);
      break;
    }
    case "search_jql": {
      const args = SearchJqlInput.parse(rawArgs);
      result = await client.searchJql(args);
      break;
    }
    case "get_issue": {
      const args = GetIssueInput.parse(rawArgs);
      result = await client.getIssue(args);
      break;
    }
    case "create_issue": {
      const args = CreateIssueInput.parse(rawArgs);
      result = await client.createIssue(args);
      break;
    }
    case "add_comment": {
      const args = AddCommentInput.parse(rawArgs);
      result = await client.addComment(args);
      break;
    }
    case "transition_issue": {
      const args = TransitionIssueInput.parse(rawArgs);
      result = await client.transitionIssue(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
