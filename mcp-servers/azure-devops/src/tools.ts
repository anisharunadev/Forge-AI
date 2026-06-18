/**
 * MCP tool definitions + handlers for the FORA Azure DevOps MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * Three tools — `run_pipeline`, `create_work_item`, `add_work_item_comment`
 * — are mutations on the customer's Azure DevOps project. They require an
 * explicit `confirm: true` Zod literal so the model can't quietly mutate
 * state; the agent has to declare intent and the caller has to opt in.
 *
 * The `project` is intentionally NOT a tool input. The server is pinned to
 * a single project at startup; the model can only pass IDs and primitives,
 * never project names.
 */

import { z } from "zod";
import type { Client } from "./client.js";

const ConfirmLiteral = z.literal(true).describe(
  "Explicit confirmation that this mutation should run. Must be exactly `true`; the model cannot pass `false` or omit it.",
);

const ListProjectsShape = {};

const ListReposShape = {
  top: z.number().int().min(1).max(200).default(50)
    .describe("Maximum number of repos to return. Default 50."),
};

const ListPipelinesShape = {
  top: z.number().int().min(1).max(200).default(50)
    .describe("Maximum number of pipelines to return. Default 50."),
};

const RunPipelineShape = {
  pipelineId: z.number().int().positive()
    .describe("ID of the pipeline to run. Obtain from `list_pipelines`."),
  variables: z
    .record(z.string(), z.object({ value: z.string() }))
    .optional()
    .describe("Optional map of pipeline variable name → value to pass to the run."),
  confirm: ConfirmLiteral,
};

const GetPipelineRunShape = {
  pipelineId: z.number().int().positive().describe("Pipeline ID."),
  runId: z.number().int().positive().describe("Pipeline run ID."),
};

const ListWorkItemsShape = {
  wiql: z.string().optional()
    .describe("Optional WIQL query. Defaults to `SELECT [System.Id] FROM WorkItems`."),
  top: z.number().int().min(1).max(200).default(50)
    .describe("Maximum number of work items to return. Default 50."),
};

const GetWorkItemShape = {
  id: z.number().int().positive().describe("Work item ID."),
  expand: z.string().optional()
    .describe("Optional `$expand` value, e.g. `relations` or `fields`."),
};

const CreateWorkItemShape = {
  type: z.string().min(1)
    .describe("Work item type, e.g. `Task`, `Bug`, `User Story`, `Feature`."),
  title: z.string().min(1).describe("Work item title."),
  description: z.string().optional().describe("Optional HTML description."),
  fields: z.record(z.string(), z.string()).optional()
    .describe("Optional extra fields, e.g. `{ 'System.Tags': 'smoke; prio-1' }`."),
  confirm: ConfirmLiteral,
};

const AddWorkItemCommentShape = {
  id: z.number().int().positive().describe("Work item ID to comment on."),
  text: z.string().min(1).describe("Comment body, plain text or simple HTML."),
  confirm: ConfirmLiteral,
};

// Parsers (full Zod objects) are used inside the handler to validate the
// raw input the MCP SDK passes through.
const ListProjectsInput = z.object(ListProjectsShape).strict();
const ListReposInput = z.object(ListReposShape).strict();
const ListPipelinesInput = z.object(ListPipelinesShape).strict();
const RunPipelineInput = z.object(RunPipelineShape).strict();
const GetPipelineRunInput = z.object(GetPipelineRunShape).strict();
const ListWorkItemsInput = z.object(ListWorkItemsShape).strict();
const GetWorkItemInput = z.object(GetWorkItemShape).strict();
const CreateWorkItemInput = z.object(CreateWorkItemShape).strict();
const AddWorkItemCommentInput = z.object(AddWorkItemCommentShape).strict();

export const toolDefinitions = [
  {
    name: "list_projects",
    description: "List projects in the org this server is pinned to. Use to discover which project the server is currently scoped to and to verify connectivity.",
    shape: ListProjectsShape,
  },
  {
    name: "list_repos",
    description: "List Git repositories in the pinned project. Use to find repos before referencing them in pipelines or work items.",
    shape: ListReposShape,
  },
  {
    name: "list_pipelines",
    description: "List pipelines defined in the pinned project. Use to discover pipeline IDs before calling `run_pipeline`.",
    shape: ListPipelinesShape,
  },
  {
    name: "run_pipeline",
    description: "Queue a new run of a pipeline. REQUIRES `confirm: true` — this triggers an actual build. Use `get_pipeline_run` to poll for completion.",
    shape: RunPipelineShape,
  },
  {
    name: "get_pipeline_run",
    description: "Fetch a single pipeline run by ID, including its current state and result.",
    shape: GetPipelineRunShape,
  },
  {
    name: "list_work_items",
    description: "List work items in the pinned project. Runs a WIQL query (default: `SELECT [System.Id] FROM WorkItems`) and returns the resulting work item summaries.",
    shape: ListWorkItemsShape,
  },
  {
    name: "get_work_item",
    description: "Fetch a single work item by ID, including its full fields map and description.",
    shape: GetWorkItemShape,
  },
  {
    name: "create_work_item",
    description: "Create a new work item. REQUIRES `confirm: true` — this is a mutation on the customer's Azure DevOps project.",
    shape: CreateWorkItemShape,
  },
  {
    name: "add_work_item_comment",
    description: "Add a comment to a work item. REQUIRES `confirm: true` — this appends a comment visible to every human on the work item.",
    shape: AddWorkItemCommentShape,
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
      void args;
      result = await client.listProjects();
      break;
    }
    case "list_repos": {
      const args = ListReposInput.parse(rawArgs ?? {});
      result = await client.listRepos(args);
      break;
    }
    case "list_pipelines": {
      const args = ListPipelinesInput.parse(rawArgs ?? {});
      result = await client.listPipelines(args);
      break;
    }
    case "run_pipeline": {
      const args = RunPipelineInput.parse(rawArgs);
      result = await client.runPipeline(args);
      break;
    }
    case "get_pipeline_run": {
      const args = GetPipelineRunInput.parse(rawArgs);
      result = await client.getPipelineRun(args);
      break;
    }
    case "list_work_items": {
      const args = ListWorkItemsInput.parse(rawArgs ?? {});
      result = await client.listWorkItems(args);
      break;
    }
    case "get_work_item": {
      const args = GetWorkItemInput.parse(rawArgs);
      result = await client.getWorkItem(args);
      break;
    }
    case "create_work_item": {
      const args = CreateWorkItemInput.parse(rawArgs);
      result = await client.createWorkItem(args);
      break;
    }
    case "add_work_item_comment": {
      const args = AddWorkItemCommentInput.parse(rawArgs);
      result = await client.addWorkItemComment(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
