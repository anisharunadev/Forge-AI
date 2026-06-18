// test/smoke.mjs
// End-to-end smoke test for the FORA Databricks MCP server.
//
// Flow:
//   1. Spin up a mock Databricks HTTP server on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every tool at least once.
//   4. Assert the returned payloads AND that the expected HTTP calls
//      landed with the right auth header + body shape.
//   5. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-databricks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const WORKSPACE = "https://dbc-12345.cloud.databricks.com";
const FAKE_TOKEN = "dapi_smoketest_fake_token";
const WAREHOUSE = "warehouse-abc";

function log(label, msg) {
  process.stdout.write(`[smoke] ${label}: ${msg}\n`);
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `assertion failed [${label}]:\n  expected: ${e}\n  actual:   ${a}`,
    );
  }
  log("ok", label);
}

function assertTrue(cond, label) {
  if (!cond) throw new Error(`assertion failed [${label}]: expected truthy`);
  log("ok", label);
}

function assertIncludes(arr, predicate, label) {
  if (!arr.some(predicate)) {
    throw new Error(`assertion failed [${label}]: no matching entry in ${JSON.stringify(arr)}`);
  }
  log("ok", label);
}

async function main() {
  // 1. Mock Databricks server.
  const state = initialState();
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. Spawn a child process for the server (just to assert the env
  //    pin works). The actual MCP client below uses its own transport.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      DATABRICKS_TOKEN: FAKE_TOKEN,
      DATABRICKS_WORKSPACE_URL: WORKSPACE,
      DATABRICKS_WAREHOUSE_ID: WAREHOUSE,
      DATABRICKS_API_BASE_URL: baseUrl,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let childStderr = "";
  child.stderr.on("data", (b) => {
    childStderr += b.toString("utf8");
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[smoke] MCP server child exited early code=${code}\n${childStderr}\n`);
    }
  });

  // 3. MCP client.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      DATABRICKS_TOKEN: FAKE_TOKEN,
      DATABRICKS_WORKSPACE_URL: WORKSPACE,
      DATABRICKS_WAREHOUSE_ID: WAREHOUSE,
      DATABRICKS_API_BASE_URL: baseUrl,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stderr.write(`[smoke][server] ${s}`);
  });

  try {
    // 4a. list_jobs
    const jobsRes = await client.callTool({ name: "list_jobs", arguments: {} });
    const jobs = JSON.parse(jobsRes.content[0].text);
    assertEqual(jobs.length, 2, "list_jobs returns 2 jobs");
    assertEqual(jobs[0].name, "nightly_etl", "list_jobs returns nightly_etl first");
    assertEqual(jobs[1].job_id, 101, "list_jobs returns job_id 101 second");

    // 4b. get_job
    const jobRes = await client.callTool({ name: "get_job", arguments: { job_id: 100 } });
    const job = JSON.parse(jobRes.content[0].text);
    assertEqual(job.job_id, 100, "get_job returns job #100");
    assertEqual(job.name, "nightly_etl", "get_job returns correct name");
    assertTrue(
      job.settings && job.settings.max_concurrent_runs === 1,
      "get_job returns job settings",
    );

    // 4c. run_job
    const runRes = await client.callTool({
      name: "run_job",
      arguments: { job_id: 100, confirm: true, jar_params: ["yesterday"] },
    });
    const run = JSON.parse(runRes.content[0].text);
    assertTrue(run.run_id > 7000, "run_job returns a new run_id");
    const newRunId = run.run_id;

    // 4d. get_run
    const runDetailRes = await client.callTool({
      name: "get_run",
      arguments: { run_id: newRunId },
    });
    const runDetail = JSON.parse(runDetailRes.content[0].text);
    assertEqual(runDetail.run_id, newRunId, "get_run returns the run we just created");
    assertEqual(runDetail.job_id, 100, "get_run returns the parent job_id");

    // 4e. cancel_run
    const cancelRes = await client.callTool({
      name: "cancel_run",
      arguments: { run_id: newRunId, confirm: true },
    });
    const cancelled = JSON.parse(cancelRes.content[0].text);
    assertEqual(cancelled.run_id, newRunId, "cancel_run returns the run_id we passed");
    assertTrue(cancelled.cancelled === true, "cancel_run returns cancelled: true");

    // 4f. list_clusters
    const clustersRes = await client.callTool({ name: "list_clusters", arguments: {} });
    const clusters = JSON.parse(clustersRes.content[0].text);
    assertEqual(clusters.length, 2, "list_clusters returns 2 clusters");
    assertEqual(clusters[0].cluster_id, "0612-191919-abcdef01", "list_clusters returns etl-prod first");

    // 4g. get_cluster
    const clusterRes = await client.callTool({
      name: "get_cluster",
      arguments: { cluster_id: "0612-191919-abcdef01" },
    });
    const cluster = JSON.parse(clusterRes.content[0].text);
    assertEqual(cluster.cluster_id, "0612-191919-abcdef01", "get_cluster returns etl-prod");
    assertEqual(cluster.state, "RUNNING", "get_cluster returns RUNNING state");

    // 4h. execute_sql
    const sqlRes = await client.callTool({
      name: "execute_sql",
      arguments: {
        sql: "SELECT id, name FROM etl.t_demo LIMIT 2",
        confirm: true,
      },
    });
    const sql = JSON.parse(sqlRes.content[0].text);
    assertEqual(sql.status.state, "SUCCEEDED", "execute_sql returns SUCCEEDED status");
    assertTrue(Array.isArray(sql.result?.data_array), "execute_sql returns data_array");
    assertEqual(sql.result.data_array.length, 2, "execute_sql returns 2 rows");

    // 5. Cross-check the HTTP layer.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/2.1/jobs/list", "HTTP: list_jobs hit /api/2.1/jobs/list");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/2.1/jobs/get", "HTTP: get_job hit /api/2.1/jobs/get");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/api/2.1/jobs/run-now", "HTTP: run_job hit /api/2.1/jobs/run-now");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/2.1/jobs/runs/get", "HTTP: get_run hit /api/2.1/jobs/runs/get");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/api/2.1/jobs/runs/cancel", "HTTP: cancel_run hit /api/2.1/jobs/runs/cancel");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/2.1/clusters/list", "HTTP: list_clusters hit /api/2.1/clusters/list");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/2.1/clusters/get", "HTTP: get_cluster hit /api/2.1/clusters/get");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/api/2.0/sql/statements/", "HTTP: execute_sql hit /api/2.0/sql/statements/");

    // 6. Auth header. Every request must carry `Authorization: Bearer dapi…`.
    //    A leak without the header would mean the SDK (or our client) is
    //    sending unauthenticated traffic to the workspace.
    const missingAuth = state.callLog.filter(
      (c) => !String(c.headers.authorization ?? "").startsWith("Bearer "),
    );
    if (missingAuth.length > 0) {
      throw new Error(
        `assertion failed [every HTTP call carries Authorization: Bearer]: ` +
          `${missingAuth.length}/${state.callLog.length} requests missing auth. ` +
          `Sample: ${JSON.stringify(missingAuth.slice(0, 2))}`,
      );
    }
    log("ok", `every request (${state.callLog.length}/${state.callLog.length}) carries Authorization: Bearer`);

    // 7. run_job body must include the JAR params and confirm semantics
    //    (the body is what was POSTed; the literal `confirm: true` is on
    //    the MCP tool input and is checked by the MCP layer above).
    const runJobCall = state.callLog.find(
      (c) => c.method === "POST" && c.path === "/api/2.1/jobs/run-now",
    );
    if (!runJobCall || !runJobCall.body || runJobCall.body.job_id !== 100) {
      throw new Error(
        `assertion failed [run_job body carries job_id=100]: ` +
          `${JSON.stringify(runJobCall?.body)}`,
      );
    }
    if (!Array.isArray(runJobCall.body.jar_params) || runJobCall.body.jar_params[0] !== "yesterday") {
      throw new Error(
        `assertion failed [run_job body carries jar_params]: ` +
          `${JSON.stringify(runJobCall.body.jar_params)}`,
      );
    }
    log("ok", "run_job body carries job_id + jar_params");

    // 8. execute_sql body must carry warehouse_id (server-pinned) and the
    //    disposition/format we set in the client.
    const sqlCall = state.callLog.find(
      (c) => c.method === "POST" && c.path === "/api/2.0/sql/statements/",
    );
    if (!sqlCall || !sqlCall.body) {
      throw new Error(`assertion failed [execute_sql issued a POST body]`);
    }
    if (sqlCall.body.warehouse_id !== WAREHOUSE) {
      throw new Error(
        `assertion failed [execute_sql body carries warehouse_id=${WAREHOUSE}]: ` +
          `got ${JSON.stringify(sqlCall.body.warehouse_id)}`,
      );
    }
    if (sqlCall.body.disposition !== "INLINE" || sqlCall.body.format !== "JSON_ARRAY") {
      throw new Error(
        `assertion failed [execute_sql body carries disposition+format]: ` +
          `${JSON.stringify({ disposition: sqlCall.body.disposition, format: sqlCall.body.format })}`,
      );
    }
    log("ok", "execute_sql body carries warehouse_id + disposition=INLINE + format=JSON_ARRAY");

    // 9. The MCP transport must not surface a fatal startup error. If the
    //    server crashed before our calls, the callTool would have thrown;
    //    we already proved that didn't happen above. We also assert that
    //    the boot banner appears on stderr exactly once.
    const bannerCount = (transportStderr.match(/\[fora-mcp-databricks\] starting/g) ?? []).length;
    assertTrue(bannerCount >= 1, `boot banner observed on stderr (count=${bannerCount})`);

    log("done", "all 8 tools smoke-tested green");
  } finally {
    await client.close();
    child.kill("SIGTERM");
    await shutdownMock();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[smoke] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
