// test/smoke.mjs
// End-to-end smoke test for the FORA Azure DevOps MCP server.
//
// Flow:
//   1. Spin up a mock Azure DevOps HTTP server on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every tool at least once.
//   4. Assert the returned payloads AND that the expected HTTP calls landed.
//   5. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-azdo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const ORG_URL = "https://dev.azure.example/forge";
const PROJECT = "forge";
const FAKE_PAT = "mock-pat-smoketest";

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
  // 1. Mock AzDO server.
  const state = initialState({ project: PROJECT, pat: FAKE_PAT });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server env. The apiBaseUrl is set to the mock base (without a
  //    project segment); the project pin is appended by the client to form
  //    the project-scoped base, matching the production layout where
  //    `orgUrl` and `project` together form `orgUrl/{project}/_apis/...`.
  const env = {
    ...process.env,
    AZURE_DEVOPS_PAT: FAKE_PAT,
    AZURE_DEVOPS_ORG_URL: ORG_URL,
    AZURE_DEVOPS_PROJECT: PROJECT,
    AZURE_DEVOPS_API_BASE_URL: baseUrl,
  };

  // 3. MCP client over stdio.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  // Buffer the transport child's stderr so we can assert on it.
  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stderr.write(`[smoke][server] ${s}`);
  });

  try {
    // 4a. list_projects
    const projectsRes = await client.callTool({ name: "list_projects", arguments: {} });
    const projects = JSON.parse(projectsRes.content[0].text);
    assertTrue(projects.length >= 1, "list_projects returns at least 1 project");
    assertTrue(
      projects.some((p) => p.name === "Forge"),
      "list_projects includes 'Forge'",
    );

    // 4b. list_repos
    const reposRes = await client.callTool({
      name: "list_repos",
      arguments: { top: 10 },
    });
    const repos = JSON.parse(reposRes.content[0].text);
    assertEqual(repos.length, 2, "list_repos returns 2 repos");
    assertTrue(
      repos.some((r) => r.name === "forge-app"),
      "list_repos includes 'forge-app'",
    );

    // 4c. list_pipelines
    const pipelinesRes = await client.callTool({
      name: "list_pipelines",
      arguments: { top: 10 },
    });
    const pipelines = JSON.parse(pipelinesRes.content[0].text);
    assertEqual(pipelines.length, 2, "list_pipelines returns 2 pipelines");
    assertTrue(
      pipelines.some((p) => p.name === "forge-ci" && p.id === 12),
      "list_pipelines includes forge-ci (id 12)",
    );

    // 4d. run_pipeline (mutation — confirm: true)
    const runRes = await client.callTool({
      name: "run_pipeline",
      arguments: {
        pipelineId: 12,
        variables: { BRANCH: { value: "main" } },
        confirm: true,
      },
    });
    const run = JSON.parse(runRes.content[0].text);
    assertTrue(run.id > 0, "run_pipeline returns a run id");
    assertEqual(run.state, "Queued", "run_pipeline state is Queued");
    assertEqual(run.pipelineId, 12, "run_pipeline echoes pipelineId");

    // 4e. get_pipeline_run
    const runGetRes = await client.callTool({
      name: "get_pipeline_run",
      arguments: { pipelineId: 12, runId: run.id },
    });
    const runGet = JSON.parse(runGetRes.content[0].text);
    assertEqual(runGet.id, run.id, "get_pipeline_run returns same run id");
    assertEqual(runGet.state, "Queued", "get_pipeline_run state is Queued");

    // 4f. list_work_items
    const wisRes = await client.callTool({
      name: "list_work_items",
      arguments: {},
    });
    const wis = JSON.parse(wisRes.content[0].text);
    assertTrue(wis.length >= 1, "list_work_items returns at least 1 work item");
    assertTrue(
      wis.some((w) => w.id === 101),
      "list_work_items includes work item 101",
    );

    // 4g. get_work_item
    const wiRes = await client.callTool({
      name: "get_work_item",
      arguments: { id: 101 },
    });
    const wi = JSON.parse(wiRes.content[0].text);
    assertEqual(wi.id, 101, "get_work_item returns id 101");
    assertEqual(wi.title, "Wire MCP server to orchestrator", "get_work_item returns correct title");
    assertTrue(wi.fields && wi.fields["System.Title"] === "Wire MCP server to orchestrator", "get_work_item has fields.System.Title");

    // 4h. create_work_item (mutation — confirm: true)
    const newWiRes = await client.callTool({
      name: "create_work_item",
      arguments: {
        type: "Task",
        title: "Smoke: AzDO MCP connected",
        description: "Created by the FORA AzDO smoke test.",
        fields: { "System.Tags": "smoke; prio-1" },
        confirm: true,
      },
    });
    const newWi = JSON.parse(newWiRes.content[0].text);
    assertTrue(newWi.id > 0, "create_work_item returns a new id");
    assertEqual(newWi.title, "Smoke: AzDO MCP connected", "create_work_item returns correct title");
    assertEqual(newWi.workItemType, "Task", "create_work_item returns correct type");

    // 4i. add_work_item_comment (mutation — confirm: true)
    const commentRes = await client.callTool({
      name: "add_work_item_comment",
      arguments: {
        id: 101,
        text: "## Smoke test comment\n\nPosted by FORA AzDO MCP smoke test.",
        confirm: true,
      },
    });
    const comment = JSON.parse(commentRes.content[0].text);
    assertTrue(comment.id > 0, "add_work_item_comment returns an id");
    assertTrue(comment.text.startsWith("## Smoke"), "add_work_item_comment returns the text");

    // 4j. confirm: false must be rejected for mutations. The MCP SDK
    //     surfaces Zod validation failures as a thrown protocol error OR
    //     a successful response with isError: true; we accept either.
    const callsBefore = state.callLog.length;
    let confirmRejected = false;
    try {
      const res = await client.callTool({
        name: "run_pipeline",
        arguments: { pipelineId: 12, confirm: false },
      });
      // Some MCP SDK versions return a successful response whose content
      // describes the Zod error. Treat that as a rejection.
      if (res && (res.isError === true || (res.content || []).some(
        (c) => typeof c?.text === "string" && /confirm|literal|invalid/i.test(c.text),
      ))) {
        confirmRejected = true;
      }
    } catch {
      confirmRejected = true;
    }
    const callsAfter = state.callLog.length;
    assertTrue(confirmRejected, "run_pipeline rejects confirm: false (Zod literal)");
    assertEqual(callsAfter, callsBefore, "run_pipeline with confirm:false made zero HTTP calls (rejected at validation)");

    // 5. Cross-check the HTTP layer.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/_apis/projects", "HTTP: list_projects hit /_apis/projects");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/_apis/git/repositories", "HTTP: list_repos hit /_apis/git/repositories");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/_apis/pipelines", "HTTP: list_pipelines hit /_apis/pipelines");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/_apis/pipelines/12/runs", "HTTP: run_pipeline hit POST /_apis/pipelines/12/runs");
    assertIncludes(state.callLog, (c) => c.method === "GET" && /^\/_apis\/pipelines\/12\/runs\/\d+$/.test(c.path), "HTTP: get_pipeline_run hit /_apis/pipelines/12/runs/{runId}");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/_apis/wit/wiql", "HTTP: list_work_items hit POST /_apis/wit/wiql");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/_apis/wit/workitems" && c.body === null, "HTTP: list_work_items batch-fetched /_apis/wit/workitems?ids=...");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/_apis/wit/workitems/101", "HTTP: get_work_item hit /_apis/wit/workitems/101");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/_apis/wit/workitems/$Task", "HTTP: create_work_item hit POST /_apis/wit/workitems/$Task");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/_apis/wit/workitems/101/comments", "HTTP: add_work_item_comment hit /_apis/wit/workitems/101/comments");

    // 6. Auth: every recorded call should have carried a Basic auth header.
    const unauthed = state.callLog.filter((c) => !c.authPresent);
    assertEqual(unauthed.length, 0, "all HTTP calls carried a Basic auth header");

    log("done", "all 9 tools smoke-tested green");
  } finally {
    await client.close();
    await shutdownMock();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[smoke] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
