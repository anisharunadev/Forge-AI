/**
 * MCP tool definitions + handlers for the FORA Databricks MCP server.
 *
 * Each tool:
 *   - has a Zod input schema (single source of truth for shape + doc),
 *   - declares a clear, model-facing description (no internal jargon),
 *   - returns a JSON-stringified content block (MCP convention).
 *
 * Three tools mutate workspace state and require an explicit
 * `confirm: true` argument (a Zod literal) so the model can't trigger
 * job runs, cancels, or SQL writes without an explicit ack:
 *   - run_job
 *   - cancel_run
 *   - execute_sql
 *
 * The `job_id` and `warehouse_id` arguments are NOT tool inputs in the
 * sense of being freeform; they are asserted against the optional server
 * pin (DATABRICKS_JOB_ID, DATABRICKS_WAREHOUSE_ID) when those env vars are
 * set. With no pin, the model can pass any id it can see in list_jobs /
 * list_clusters results.
 */

import { z } from "zod";
import type { Client } from "./client.js";

// ---- Shared shapes ----------------------------------------------------

const PaginationShape = {
  limit: z.number().int().min(1).max(100).default(25)
    .describe("Page size, 1-100. Default 25."),
  offset: z.number().int().min(0).default(0)
    .describe("Page offset. Default 0."),
};

const ListJobsShape = {
  ...PaginationShape,
  name: z.string().optional()
    .describe("Optional case-insensitive substring filter on job name."),
};

const GetJobShape = {
  job_id: z.number().int().positive().describe("Databricks job id."),
};

const RunJobShape = {
  job_id: z.number().int().positive().describe("Databricks job id."),
  confirm: z.literal(true).describe("Must be true. Acknowledges that this will trigger a workspace job run."),
  jar_params: z.array(z.string()).optional()
    .describe("Optional spark jar task parameters. Ignored for non-jar tasks."),
  notebook_params: z.record(z.string(), z.string()).optional()
    .describe("Optional notebook task parameters, mapped to widget values. Ignored for non-notebook tasks."),
};

const GetRunShape = {
  run_id: z.number().int().positive().describe("Databricks run id (returned by run_job)."),
};

const CancelRunShape = {
  run_id: z.number().int().positive().describe("Databricks run id to cancel."),
  confirm: z.literal(true).describe("Must be true. Acknowledges that this cancels an in-flight run."),
};

const ListClustersShape = {
  page_size: z.number().int().min(1).max(100).default(25)
    .describe("Page size, 1-100. Default 25."),
  page_token: z.string().optional()
    .describe("Opaque pagination token returned by a previous list_clusters call."),
};

const GetClusterShape = {
  cluster_id: z.string().min(1).describe("Databricks cluster id."),
};

const ExecuteSqlShape = {
  sql: z.string().min(1)
    .describe("SQL statement to execute against the pinned warehouse. Read-only statements are recommended; DML/DDL is allowed but must be confirmed."),
  warehouse_id: z.string().min(1).optional()
    .describe("SQL warehouse id. If omitted, the server must be started with DATABRICKS_WAREHOUSE_ID."),
  confirm: z.literal(true).describe("Must be true. Acknowledges that this may run a non-read-only statement and incur warehouse cost."),
  row_limit: z.number().int().min(1).max(10000).default(1000)
    .describe("Cap on rows returned to the caller. 1-10000. Default 1000."),
};

// ---- Parsers (used by handleToolCall) ---------------------------------

const ListJobsInput = z.object(ListJobsShape).strict();
const GetJobInput = z.object(GetJobShape).strict();
const RunJobInput = z.object(RunJobShape).strict();
const GetRunInput = z.object(GetRunShape).strict();
const CancelRunInput = z.object(CancelRunShape).strict();
const ListClustersInput = z.object(ListClustersShape).strict();
const GetClusterInput = z.object(GetClusterShape).strict();
const ExecuteSqlInput = z.object(ExecuteSqlShape).strict();

export const toolDefinitions = [
  {
    name: "list_jobs",
    description: "List jobs in the workspace this server is pinned to. Use this to discover job ids before calling get_job / run_job.",
    shape: ListJobsShape,
  },
  {
    name: "get_job",
    description: "Get a single job by id, including schedule, settings, and email notifications.",
    shape: GetJobShape,
  },
  {
    name: "run_job",
    description: "Trigger a workspace job run now. REQUIRES confirm: true. Returns the new run_id.",
    shape: RunJobShape,
  },
  {
    name: "get_run",
    description: "Get a job run by id, including state, start/end time, and result.",
    shape: GetRunShape,
  },
  {
    name: "cancel_run",
    description: "Cancel an in-flight run. REQUIRES confirm: true. Returns the cancelled run_id.",
    shape: CancelRunShape,
  },
  {
    name: "list_clusters",
    description: "List all-purpose and job clusters in the workspace this server is pinned to. Read-only.",
    shape: ListClustersShape,
  },
  {
    name: "get_cluster",
    description: "Get a single cluster by id, including state and node configuration.",
    shape: GetClusterShape,
  },
  {
    name: "execute_sql",
    description: "Execute a SQL statement against a SQL warehouse. REQUIRES confirm: true. Read-only is recommended; DML/DDL is allowed. Use the warehouse_id argument or set DATABRICKS_WAREHOUSE_ID on the server.",
    shape: ExecuteSqlShape,
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
    case "list_jobs": {
      const args = ListJobsInput.parse(rawArgs ?? {});
      result = await client.listJobs(args);
      break;
    }
    case "get_job": {
      const args = GetJobInput.parse(rawArgs);
      result = await client.getJob(args);
      break;
    }
    case "run_job": {
      const args = RunJobInput.parse(rawArgs);
      result = await client.runJob(args);
      break;
    }
    case "get_run": {
      const args = GetRunInput.parse(rawArgs);
      result = await client.getRun(args);
      break;
    }
    case "cancel_run": {
      const args = CancelRunInput.parse(rawArgs);
      result = await client.cancelRun(args);
      break;
    }
    case "list_clusters": {
      const args = ListClustersInput.parse(rawArgs ?? {});
      result = await client.listClusters(args);
      break;
    }
    case "get_cluster": {
      const args = GetClusterInput.parse(rawArgs);
      result = await client.getCluster(args);
      break;
    }
    case "execute_sql": {
      const args = ExecuteSqlInput.parse(rawArgs);
      result = await client.executeSql(args);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
