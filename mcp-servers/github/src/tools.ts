/**
 * MCP tool definitions + handlers for the FORA GitHub MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * The `org` is intentionally NOT a tool input. The server is pinned to a
 * single org at startup; the model can only pass `owner` and that is asserted
 * against the pinned org before any call lands.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const OwnerRepoShape = {
  owner: z.string().describe("Repository owner. Must match the org the server is pinned to."),
  repo: z.string().describe("Repository name within the pinned org."),
};

const ListReposShape = {
  per_page: z.number().int().min(1).max(100).default(30)
    .describe("Page size, 1-100. Default 30."),
  page: z.number().int().min(1).default(1).describe("Page number. Default 1."),
  type: z.enum(["all", "public", "private"]).default("all")
    .describe("Filter by visibility. Default 'all'."),
};

const GetPrShape = {
  ...OwnerRepoShape,
  pull_number: z.number().int().positive().describe("PR number."),
};

const ListPrsShape = {
  ...OwnerRepoShape,
  state: z.enum(["open", "closed", "all"]).default("open")
    .describe("Filter by state. Default 'open'."),
  per_page: z.number().int().min(1).max(100).default(30),
  page: z.number().int().min(1).default(1),
};

const CreatePrCommentShape = {
  ...OwnerRepoShape,
  pull_number: z.number().int().positive().describe("PR number to comment on."),
  body: z.string().min(1).describe("Comment body in GitHub-flavored Markdown."),
};

const ListIssuesShape = {
  ...OwnerRepoShape,
  state: z.enum(["open", "closed", "all"]).default("open")
    .describe("Filter by state. Default 'open'."),
  per_page: z.number().int().min(1).max(100).default(30),
  page: z.number().int().min(1).default(1),
};

const CreateIssueShape = {
  ...OwnerRepoShape,
  title: z.string().min(1).describe("Issue title."),
  body: z.string().optional().describe("Issue body in GitHub-flavored Markdown."),
  labels: z.array(z.string()).optional()
    .describe("Optional label names to apply. Must already exist in the repo."),
};

const SearchCodeShape = {
  q: z.string().min(1)
    .describe("Search query. The pinned org is appended automatically if no `org:` qualifier is present."),
  per_page: z.number().int().min(1).max(100).default(30),
  page: z.number().int().min(1).default(1),
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input that the MCP SDK passes through.
const ListReposInput = z.object(ListReposShape).strict();
const GetPrInput = z.object(GetPrShape).strict();
const ListPrsInput = z.object(ListPrsShape).strict();
const CreatePrCommentInput = z.object(CreatePrCommentShape).strict();
const ListIssuesInput = z.object(ListIssuesShape).strict();
const CreateIssueInput = z.object(CreateIssueShape).strict();
const SearchCodeInput = z.object(SearchCodeShape).strict();

export const toolDefinitions = [
  {
    name: "list_repos",
    description: "List repositories in the org this server is pinned to. Use this to discover what repos are available before making other calls.",
    shape: ListReposShape,
  },
  {
    name: "get_pr",
    description: "Get a single pull request by number, including additions/deletions/changed_files/mergeable.",
    shape: GetPrShape,
  },
  {
    name: "list_prs",
    description: "List pull requests in a repo (default state: open).",
    shape: ListPrsShape,
  },
  {
    name: "create_pr_comment",
    description: "Post a comment on a pull request. The `body` is GitHub-flavored Markdown. Use this for review feedback, status updates, or to attach a thread to a PR.",
    shape: CreatePrCommentShape,
  },
  {
    name: "list_issues",
    description: "List issues in a repo (default state: open). PRs are not included by default (matches GitHub's API behavior).",
    shape: ListIssuesShape,
  },
  {
    name: "create_issue",
    description: "Create an issue in a repo. Returns the new issue's number and URL.",
    shape: CreateIssueShape,
  },
  {
    name: "search_code",
    description: "Search code across the pinned org. The org is auto-appended; you do not need to include it in the query.",
    shape: SearchCodeShape,
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
    case "list_repos": {
      const args = ListReposInput.parse(rawArgs ?? {});
      result = await client.listRepos(args);
      break;
    }
    case "get_pr": {
      const args = GetPrInput.parse(rawArgs);
      result = await client.getPr(args);
      break;
    }
    case "list_prs": {
      const args = ListPrsInput.parse(rawArgs);
      result = await client.listPrs(args);
      break;
    }
    case "create_pr_comment": {
      const args = CreatePrCommentInput.parse(rawArgs);
      result = await client.createPrComment(args);
      break;
    }
    case "list_issues": {
      const args = ListIssuesInput.parse(rawArgs);
      result = await client.listIssues(args);
      break;
    }
    case "create_issue": {
      const args = CreateIssueInput.parse(rawArgs);
      result = await client.createIssue(args);
      break;
    }
    case "search_code": {
      const args = SearchCodeInput.parse(rawArgs);
      result = await client.searchCode(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
