/**
 * Typed Databricks API client, scoped to a single workspace.
 *
 * The MCP server only ever calls these methods. The Jobs REST 2.1 surface
 * is documented at:
 *   https://docs.databricks.com/api/workspace/jobs
 *
 * The SQL Statement Execution API is documented at:
 *   https://docs.databricks.com/api/workspace/statementexecution
 *
 * The server pins itself to one workspace at startup and refuses calls
 * that don't match the pin. There is no SDK for Databricks in active
 * maintenance, so this client uses plain fetch with `Authorization: Bearer`
 * + JSON bodies.
 */

import type { Config } from "./config.js";

export class WorkspaceScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act against workspace '${requested}' — this server is pinned to '${allowed}'.`,
    );
    this.name = "WorkspaceScopeError";
  }
}

export class JobScopeError extends Error {
  constructor(requested: number, allowed: number) {
    super(
      `Refusing to act on job_id=${requested} — this server is pinned to job_id=${allowed}.`,
    );
    this.name = "JobScopeError";
  }
}

export class WarehouseScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on warehouse_id='${requested}' — this server is pinned to warehouse_id='${allowed}'.`,
    );
    this.name = "WarehouseScopeError";
  }
}

export class ConfirmRequiredError extends Error {
  constructor(tool: string) {
    super(
      `Refusing to call '${tool}' without confirm: true. ` +
        `This tool mutates workspace state; pass confirm: true to acknowledge.`,
    );
    this.name = "ConfirmRequiredError";
  }
}

export class DatabricksApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "DatabricksApiError";
    this.status = status;
    this.body = body;
  }
}

export interface JobSummary {
  job_id: number;
  name?: string;
  creator_user_name?: string;
  created_time?: number;
  state?: string;
}

export interface JobDetail extends JobSummary {
  settings?: Record<string, unknown>;
  schedule?: Record<string, unknown> | null;
  email_notifications?: Record<string, unknown> | null;
}

export interface RunSummary {
  run_id: number;
  job_id?: number;
  run_name?: string;
  state?: { life_cycle_state?: string; result_state?: string; state_message?: string };
  start_time?: number;
  end_time?: number;
}

export interface ClusterSummary {
  cluster_id: string;
  cluster_name?: string;
  state?: string;
  node_type_id?: string;
  num_workers?: number;
  spark_version?: string;
}

export interface SqlStatementResponse {
  statement_id: string;
  status: { state: string; error?: { message?: string } | null };
  manifest?: {
    schema?: { column_name: string; type_name: string }[];
    total_chunk_count?: number;
    total_row_count?: number;
    truncated?: boolean;
  };
  result?: {
    chunk_index?: number;
    row_count?: number;
    data_array?: unknown[][];
  };
}

/**
 * The Client interface deliberately takes only IDs and primitives — never
 * raw HTTP. Every method that mutates workspace state takes a
 * `confirm: true` flag and refuses without it.
 */
export interface Client {
  listJobs(args?: { limit?: number; offset?: number; name?: string }): Promise<JobSummary[]>;
  getJob(args: { job_id: number }): Promise<JobDetail>;
  runJob(args: { job_id: number; confirm: true; jar_params?: string[]; notebook_params?: Record<string, string> }): Promise<{ run_id: number }>;
  getRun(args: { run_id: number }): Promise<RunSummary>;
  cancelRun(args: { run_id: number; confirm: true }): Promise<{ run_id: number; cancelled: true }>;
  listClusters(args?: { page_size?: number; page_token?: string }): Promise<ClusterSummary[]>;
  getCluster(args: { cluster_id: string }): Promise<ClusterSummary>;
  executeSql(args: { sql: string; warehouse_id?: string; confirm: true; row_limit?: number }): Promise<SqlStatementResponse>;
}

export function createClient(config: Config): {
  client: Client;
  workspaceUrl: string;
  jobId?: number;
  warehouseId?: string;
} {
  const baseUrl = (config.apiBaseUrl ?? config.workspaceUrl).replace(/\/+$/, "");

  const assertJob = (jobId: number) => {
    if (config.jobId !== undefined && jobId !== config.jobId) {
      throw new JobScopeError(jobId, config.jobId);
    }
  };

  const assertWarehouse = (warehouseId: string) => {
    if (config.warehouseId !== undefined && warehouseId !== config.warehouseId) {
      throw new WarehouseScopeError(warehouseId, config.warehouseId);
    }
  };

  const assertConfirm = (tool: string, confirm: unknown) => {
    if (confirm !== true) {
      throw new ConfirmRequiredError(tool);
    }
  };

  /**
   * Plain fetch wrapper. The mock server (`test/mock-databricks.mjs`)
   * speaks the same wire format as the real Databricks APIs, so a single
   * request path works in both directions.
   *
   * Returns the parsed JSON as an indexable record so per-method
   * mappers (toJobSummary / toJobDetail / toRunSummary) can take a
   * `Record<string, unknown>` parameter and stay compatible with the
   * unknown shape of the wire payload.
   */
  async function request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "user-agent": config.userAgent,
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);

    if (!res.ok) {
      let payload: unknown = null;
      const text = await res.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      throw new DatabricksApiError(
        res.status,
        payload,
        `Databricks API ${method} ${path} returned ${res.status}: ${
          (payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message)
            : null) ?? res.statusText
        }`,
      );
    }

    if (res.status === 204) {
      // No body; return an empty record. Callers ignore it.
      return {};
    }
    return (await res.json()) as Record<string, unknown>;
  }

  const client: Client = {
    // GET /api/2.1/jobs/list
    async listJobs({ limit = 25, offset = 0, name } = {}) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (name) params.set("name", name);
      const res = await request("GET", `/api/2.1/jobs/list?${params.toString()}`);
      const jobs = (res.jobs as Array<Record<string, unknown>> | undefined) ?? [];
      return jobs.map(toJobSummary);
    },

    // GET /api/2.1/jobs/get
    async getJob({ job_id }) {
      assertJob(job_id);
      const params = new URLSearchParams({ job_id: String(job_id) });
      const res = await request("GET", `/api/2.1/jobs/get?${params.toString()}`);
      return toJobDetail(res);
    },

    // POST /api/2.1/jobs/run-now
    async runJob({ job_id, confirm, jar_params, notebook_params }) {
      assertConfirm("run_job", confirm);
      assertJob(job_id);
      const body: Record<string, unknown> = { job_id };
      if (jar_params) body.jar_params = jar_params;
      if (notebook_params) body.notebook_params = notebook_params;
      const res = await request("POST", "/api/2.1/jobs/run-now", body);
      return { run_id: res.run_id as number };
    },

    // GET /api/2.1/jobs/runs/get
    async getRun({ run_id }) {
      const params = new URLSearchParams({ run_id: String(run_id) });
      const res = await request("GET", `/api/2.1/jobs/runs/get?${params.toString()}`);
      return toRunSummary(res);
    },

    // POST /api/2.1/jobs/runs/cancel
    async cancelRun({ run_id, confirm }) {
      assertConfirm("cancel_run", confirm);
      const res = await request("POST", "/api/2.1/jobs/runs/cancel", { run_id });
      return { run_id: res.run_id as number, cancelled: true };
    },

    // GET /api/2.1/clusters/list
    async listClusters({ page_size = 25, page_token } = {}) {
      const params = new URLSearchParams({ page_size: String(page_size) });
      if (page_token) params.set("page_token", page_token);
      const res = await request(
        "GET",
        `/api/2.1/clusters/list?${params.toString()}`,
      );
      return (res.clusters as ClusterSummary[] | undefined) ?? [];
    },

    // GET /api/2.1/clusters/get
    async getCluster({ cluster_id }) {
      const params = new URLSearchParams({ cluster_id });
      const res = await request("GET", `/api/2.1/clusters/get?${params.toString()}`);
      return res as unknown as ClusterSummary;
    },

    // POST /api/2.0/sql/statements/ — SQL Statement Execution API.
    // The execute_sql tool is read-only by default. We still require
    // confirm: true at the tool layer, because in v1 we may accept
    // statements that include DML/DDL once a flag is set, and the operator
    // should not get a free pass on the destructive path.
    async executeSql({ sql, warehouse_id, confirm, row_limit = 1000 }) {
      assertConfirm("execute_sql", confirm);
      const warehouse = warehouse_id ?? config.warehouseId;
      if (!warehouse) {
        throw new Error(
          "execute_sql requires a warehouse_id argument or DATABRICKS_WAREHOUSE_ID pin to be set.",
        );
      }
      assertWarehouse(warehouse);
      const body: Record<string, unknown> = {
        statement: sql,
        warehouse_id: warehouse,
        row_limit,
        // Disposition is the SQL Warehouse analogue of "result is data
        // only, no metadata" — we want structured rows back, not a chunked
        // INLINE manifest. INLINE is the documented synchronous form.
        disposition: "INLINE",
        // format is JSON_ARRAY, the documented small-payload shape.
        format: "JSON_ARRAY",
        // wait_timeout — bound the synchronous poll so a long-running
        // statement never hangs the MCP transport. The smoke test asserts
        // that this is reflected in the request body.
        wait_timeout: "30s",
      };
      return (await request("POST", "/api/2.0/sql/statements/", body)) as unknown as SqlStatementResponse;
    },
  };

  return { client, workspaceUrl: config.workspaceUrl, jobId: config.jobId, warehouseId: config.warehouseId };
}

function toJobSummary(j: Record<string, unknown>): JobSummary {
  return {
    job_id: j.job_id as number,
    name: j.name as string | undefined,
    creator_user_name: j.creator_user_name as string | undefined,
    created_time: j.created_time as number | undefined,
    state: j.state as string | undefined,
  };
}

function toJobDetail(j: Record<string, unknown>): JobDetail {
  return {
    ...toJobSummary(j),
    settings: (j.settings as Record<string, unknown> | undefined) ?? undefined,
    schedule: (j.schedule as Record<string, unknown> | null | undefined) ?? null,
    email_notifications:
      (j.email_notifications as Record<string, unknown> | null | undefined) ?? null,
  };
}

function toRunSummary(r: Record<string, unknown>): RunSummary {
  const state = (r.state as Record<string, unknown> | undefined) ?? undefined;
  return {
    run_id: r.run_id as number,
    job_id: r.job_id as number | undefined,
    run_name: r.run_name as string | undefined,
    state: state
      ? {
          life_cycle_state: state.life_cycle_state as string | undefined,
          result_state: state.result_state as string | undefined,
          state_message: state.state_message as string | undefined,
        }
      : undefined,
    start_time: r.start_time as number | undefined,
    end_time: r.end_time as number | undefined,
  };
}
