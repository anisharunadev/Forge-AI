// test/mock-databricks.mjs
// Lightweight in-memory Databricks mock for the smoke test.
//
// Implements the minimum surface the FORA Databricks MCP server touches:
//   GET  /api/2.1/jobs/list
//   GET  /api/2.1/jobs/get
//   POST /api/2.1/jobs/run-now
//   GET  /api/2.1/jobs/runs/get
//   POST /api/2.1/jobs/runs/cancel
//   GET  /api/2.1/clusters/list
//   GET  /api/2.1/clusters/get
//   POST /api/2.0/sql/statements/
//
// The mock records every call (method, path, body, headers) so the smoke
// test can assert the MCP server actually issued the right requests and
// that the auth + body payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} jobs
 * @property {Array<Record<string, unknown>>} runs
 * @property {Array<Record<string, unknown>>} clusters
 * @property {Array<Record<string, unknown>>} statements
 * @property {Array<{ method: string, path: string, body: unknown, headers: Record<string, string> }>} callLog
 */

/** @returns {MockState} */
export function initialState() {
  return {
    jobs: [
      {
        job_id: 100,
        name: "nightly_etl",
        creator_user_name: "svc-fora-etl",
        created_time: 1716000000000,
        state: "ACTIVE",
        settings: { max_concurrent_runs: 1, tasks: [{ task_key: "etl", spark_jar_task: { main_class_name: "com.example.Etl" } }] },
        schedule: { quartz_cron_expression: "0 0 2 * * ?", timezone_id: "UTC" },
        email_notifications: { on_failure: ["etl-alerts@example.com"] },
      },
      {
        job_id: 101,
        name: "weekly_aggregate",
        creator_user_name: "svc-fora-etl",
        created_time: 1716100000000,
        state: "ACTIVE",
        settings: { max_concurrent_runs: 1, tasks: [{ task_key: "agg", notebook_task: { notebook_path: "/Repos/etl/aggregate" } }] },
        schedule: { quartz_cron_expression: "0 0 6 ? * SUN", timezone_id: "UTC" },
        email_notifications: null,
      },
    ],
    runs: [
      {
        run_id: 7000,
        job_id: 100,
        run_name: "nightly_etl-2026-06-17",
        state: { life_cycle_state: "TERMINATED", result_state: "SUCCESS", state_message: "Completed" },
        start_time: 1718620800000,
        end_time: 1718624400000,
      },
    ],
    clusters: [
      {
        cluster_id: "0612-191919-abcdef01",
        cluster_name: "etl-prod",
        state: "RUNNING",
        node_type_id: "m5.xlarge",
        num_workers: 4,
        spark_version: "13.3.x-scala2.12",
      },
      {
        cluster_id: "0612-202020-fedcba10",
        cluster_name: "etl-prod-job",
        state: "TERMINATED",
        node_type_id: "m5.large",
        num_workers: 0,
        spark_version: "13.3.x-scala2.12",
      },
    ],
    statements: [
      {
        statement_id: "01f00000-0000-0000-0000-000000000001",
        status: { state: "SUCCEEDED", error: null },
        manifest: {
          schema: [
            { column_name: "id", type_name: "LONG" },
            { column_name: "name", type_name: "STRING" },
          ],
          total_chunk_count: 1,
          total_row_count: 2,
          truncated: false,
        },
        result: {
          chunk_index: 0,
          row_count: 2,
          data_array: [
            [1, "alpha"],
            [2, "beta"],
          ],
        },
      },
    ],
    callLog: [],
  };
}

/**
 * Start the mock server. Returns the base URL and a shutdown function.
 *
 * @param {MockState} state
 * @param {number} port
 * @returns {Promise<{ baseUrl: string, shutdown: () => Promise<void> }>}
 */
export function startMockServer(state, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = u.pathname;

      // Lower-case the header names we inspect so the smoke test's auth
      // assertion is forgiving about Node's casing.
      const headerMap = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headerMap[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
      }

      const entry = {
        method: req.method ?? "?",
        path,
        query: u.search ?? "",
        body: null,
        headers: headerMap,
      };
      state.callLog.push(entry);

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? safeJson(raw) : null;
        if (body !== null) {
          state.callLog[state.callLog.length - 1].body = body;
        }

        try {
          handle(state, req.method ?? "GET", path, u, body, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              message: "mock server error",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("mock server did not bind to a TCP port"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        shutdown: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function handle(state, method, path, url, body, res) {
  // GET /api/2.1/jobs/list
  if (path === "/api/2.1/jobs/list" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "25");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const name = url.searchParams.get("name");
    let jobs = state.jobs;
    if (name) {
      const q = name.toLowerCase();
      jobs = jobs.filter((j) => String(j.name ?? "").toLowerCase().includes(q));
    }
    return sendJson(res, 200, { jobs: jobs.slice(offset, offset + limit) });
  }

  // GET /api/2.1/jobs/get
  if (path === "/api/2.1/jobs/get" && method === "GET") {
    const id = Number(url.searchParams.get("job_id") ?? "0");
    const job = state.jobs.find((j) => j.job_id === id);
    if (!job) return sendJson(res, 404, { message: `Job ${id} not found` });
    return sendJson(res, 200, job);
  }

  // POST /api/2.1/jobs/run-now
  if (path === "/api/2.1/jobs/run-now" && method === "POST") {
    const jobId = body?.job_id;
    const job = state.jobs.find((j) => j.job_id === jobId);
    if (!job) return sendJson(res, 404, { message: `Job ${jobId} not found` });
    const runId = 8000 + state.runs.length + 1;
    state.runs.push({
      run_id: runId,
      job_id: jobId,
      run_name: `${job.name}-${new Date().toISOString().slice(0, 10)}`,
      state: { life_cycle_state: "PENDING", result_state: undefined, state_message: "Queued" },
      start_time: undefined,
      end_time: undefined,
    });
    return sendJson(res, 200, { run_id: runId });
  }

  // GET /api/2.1/jobs/runs/get
  if (path === "/api/2.1/jobs/runs/get" && method === "GET") {
    const id = Number(url.searchParams.get("run_id") ?? "0");
    const run = state.runs.find((r) => r.run_id === id);
    if (!run) return sendJson(res, 404, { message: `Run ${id} not found` });
    return sendJson(res, 200, run);
  }

  // POST /api/2.1/jobs/runs/cancel
  if (path === "/api/2.1/jobs/runs/cancel" && method === "POST") {
    const id = body?.run_id;
    const run = state.runs.find((r) => r.run_id === id);
    if (!run) return sendJson(res, 404, { message: `Run ${id} not found` });
    run.state = { life_cycle_state: "TERMINATED", result_state: "CANCELED", state_message: "Cancelled by user" };
    return sendJson(res, 200, { run_id: id });
  }

  // GET /api/2.1/clusters/list
  if (path === "/api/2.1/clusters/list" && method === "GET") {
    return sendJson(res, 200, { clusters: state.clusters });
  }

  // GET /api/2.1/clusters/get
  if (path === "/api/2.1/clusters/get" && method === "GET") {
    const id = url.searchParams.get("cluster_id") ?? "";
    const cluster = state.clusters.find((c) => c.cluster_id === id);
    if (!cluster) return sendJson(res, 404, { message: `Cluster ${id} not found` });
    return sendJson(res, 200, cluster);
  }

  // POST /api/2.0/sql/statements/
  if (path === "/api/2.0/sql/statements/" && method === "POST") {
    const warehouseId = body?.warehouse_id;
    // The smoke test pre-pins the warehouse to "warehouse-abc". We still
    // accept other ids but echo the requested one for visibility.
    const statementId = `01f00000-0000-0000-0000-${String(state.statements.length + 1).padStart(12, "0")}`;
    const stmt = {
      statement_id: statementId,
      status: { state: "SUCCEEDED", error: null },
      manifest: {
        schema: [
          { column_name: "id", type_name: "LONG" },
          { column_name: "name", type_name: "STRING" },
        ],
        total_chunk_count: 1,
        total_row_count: 2,
        truncated: false,
      },
      result: {
        chunk_index: 0,
        row_count: 2,
        data_array: [
          [1, "alpha"],
          [2, "beta"],
        ],
      },
    };
    state.statements.push(stmt);
    return sendJson(res, 200, stmt);
  }

  return sendJson(res, 404, { message: `mock: no route for ${method} ${path}` });
}
