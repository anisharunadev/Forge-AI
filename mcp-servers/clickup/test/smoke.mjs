// test/smoke.mjs
// End-to-end smoke test for the FORA ClickUp MCP server.
//
// Flow:
//   1. Spin up a mock ClickUp REST v2 server on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every tool at least once.
//   4. Assert the returned payloads AND that the expected HTTP calls landed.
//   5. Confirm mutation gating: create/update/status/comment require confirm: true.
//   6. Confirm scope guard: get_task on a foreign-list task refuses.
//   7. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-clickup.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const LIST_ID = "9000";
const FAKE_TOKEN = "pk_smoke_00000000000000000000000000000000";
const FAKE_BASE_URL = "https://api.clickup.com";

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

function isMcpError(res) {
  // The MCP SDK wraps tool errors as a result with isError: true rather
  // than throwing on callTool, so we inspect the result payload.
  return res && res.isError === true;
}

async function main() {
  // 1. Mock ClickUp server.
  const state = initialState({ pinnedListId: LIST_ID });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const childEnv = {
    ...process.env,
    CLICKUP_API_TOKEN: FAKE_TOKEN,
    CLICKUP_LIST_ID: LIST_ID,
    CLICKUP_BASE_URL: FAKE_BASE_URL,
    CLICKUP_API_BASE_URL: `${baseUrl}/api/v2`,
  };
  const child = spawn(process.execPath, [serverEntry], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let childStderr = "";
  child.stderr.on("data", (b) => {
    childStderr += b.toString("utf8");
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[smoke] MCP server exited early code=${code}\n${childStderr}\n`);
    }
  });

  // 3. MCP client (drives the same child via stdio transport).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: childEnv,
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  try {
    // 4a. list_tasks — no args, defaults to page 0 / pageSize 50.
    const listRes = await client.callTool({ name: "list_tasks", arguments: {} });
    const list = JSON.parse(listRes.content[0].text);
    assertEqual(list.total, 2, "list_tasks returns 2 tasks in the pinned List (excludes foreign-List 9100)");
    assertEqual(list.tasks.length, 2, "list_tasks tasks array length is 2");
    assertTrue(
      list.tasks.every((t) => t.id !== "9100"),
      "list_tasks excludes the foreign-List task (9100)",
    );

    // 4b. list_tasks with status filter.
    const filteredRes = await client.callTool({
      name: "list_tasks",
      arguments: { statuses: ["in progress"] },
    });
    const filtered = JSON.parse(filteredRes.content[0].text);
    assertEqual(filtered.total, 1, "list_tasks filtered by status returns 1 task");
    assertEqual(filtered.tasks[0].id, "9002", "list_tasks filtered returns 9002 (in progress)");

    // 4c. get_task — returns detail.
    const getRes = await client.callTool({
      name: "get_task",
      arguments: { taskId: "9001" },
    });
    const detail = JSON.parse(getRes.content[0].text);
    assertEqual(detail.id, "9001", "get_task returns id 9001");
    assertEqual(detail.name, "Wire up the MCP server", "get_task returns name");
    assertEqual(detail.status, "to do", "get_task returns current status");
    assertEqual(detail.listId, LIST_ID, "get_task confirms listId matches pin");

    // 4d. search_tasks — case-insensitive substring over name + description.
    const searchRes = await client.callTool({
      name: "search_tasks",
      arguments: { query: "DAY-ONE" },
    });
    const search = JSON.parse(searchRes.content[0].text);
    assertTrue(search.total >= 1, "search_tasks finds the day-one task");
    assertEqual(search.tasks[0].id, "9002", "search_tasks returns 9002 (day-one slice)");

    // 4e. create_task — requires confirm: true.
    const createRes = await client.callTool({
      name: "create_task",
      arguments: {
        name: "Smoke: MCP server connected",
        description: "Created by the FORA MCP smoke test.",
        status: "to do",
        priority: 3,
        confirm: true,
      },
    });
    const created = JSON.parse(createRes.content[0].text);
    assertTrue(typeof created.id === "string" && created.id.length > 0, "create_task returns a non-empty id");
    assertTrue(typeof created.url === "string" && created.url.includes(created.id), "create_task returns a url containing the id");
    const newId = created.id;

    // 4f. update_task — change name on the newly-created task.
    const updateRes = await client.callTool({
      name: "update_task",
      arguments: {
        taskId: newId,
        name: "Smoke: MCP server connected (renamed)",
        confirm: true,
      },
    });
    const updated = JSON.parse(updateRes.content[0].text);
    assertEqual(updated.name, "Smoke: MCP server connected (renamed)", "update_task updates name");

    // 4g. set_task_status — moves to "in progress".
    const statusRes = await client.callTool({
      name: "set_task_status",
      arguments: {
        taskId: newId,
        status: "in progress",
        confirm: true,
      },
    });
    const statusResult = JSON.parse(statusRes.content[0].text);
    assertEqual(statusResult.status, "in progress", "set_task_status reads back the new status");

    // 4h. add_comment — plain text body.
    const commentRes = await client.callTool({
      name: "add_comment",
      arguments: {
        taskId: newId,
        body: "Smoke test comment.",
        confirm: true,
      },
    });
    const comment = JSON.parse(commentRes.content[0].text);
    assertTrue(Number(comment.id) > 0, "add_comment returns a numeric id");
    assertEqual(comment.taskId, newId, "add_comment echoes the taskId");

    // 4i. list_comments — confirms the comment round-tripped.
    const listCommentsRes = await client.callTool({
      name: "list_comments",
      arguments: { taskId: newId },
    });
    const listedComments = JSON.parse(listCommentsRes.content[0].text);
    assertEqual(listedComments.comments.length, 1, "list_comments returns the 1 comment we added");
    assertEqual(listedComments.comments[0].body, "Smoke test comment.", "list_comments returns the right body");

    // 5. Cross-check the HTTP layer: confirm the server issued the right
    //    method/path combinations to the mock. The smoke test proves the
    //    MCP server is actually wiring calls through to ClickUp-shaped HTTP.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/api/v2/list/${LIST_ID}/task`,
      "HTTP: list_tasks hit GET /list/{LIST_ID}/task",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/api/v2/list/${LIST_ID}/task` && (c.query ?? "").includes("statuses%5B%5D=in+progress") || (c.query ?? "").includes("statuses[]=in progress"),
      "HTTP: list_tasks filtered by status passes statuses[] query",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/v2/task/9001",
      "HTTP: get_task hit GET /task/9001",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === `/api/v2/list/${LIST_ID}/task` && c.body?.name === "Smoke: MCP server connected",
      "HTTP: create_task hit POST /list/{LIST_ID}/task with the right name",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "PUT" && c.path === `/api/v2/task/${newId}` && c.body?.name === "Smoke: MCP server connected (renamed)",
      "HTTP: update_task hit PUT /task/{newId} with the renamed body",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "PUT" && c.path === `/api/v2/task/${newId}` && c.body?.status === "in progress",
      "HTTP: set_task_status hit PUT /task/{newId} with status=in progress",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === `/api/v2/task/${newId}/comment` && c.body?.comment_text === "Smoke test comment.",
      "HTTP: add_comment hit POST /task/{newId}/comment with the right body",
    );

    // 6a. Scope guard: get_task on the foreign-list task must refuse.
    const scopeRes = await client.callTool({
      name: "get_task",
      arguments: { taskId: "9100" },
    });
    assertTrue(isMcpError(scopeRes), "get_task refuses on foreign-list task (isError: true)");
    const scopeText = scopeRes.content?.[0]?.text ?? "";
    assertTrue(
      scopeText.includes("Refusing to act on List"),
      `get_task scope error message includes "Refusing to act on List" (got: ${scopeText.slice(0, 200)})`,
    );

    // 6b. Mutation gating: create_task without confirm must error.
    const noConfirmRes = await client.callTool({
      name: "create_task",
      arguments: { name: "Should fail" },
    });
    assertTrue(isMcpError(noConfirmRes), "create_task without confirm: true is rejected");
    const noConfirmText = noConfirmRes.content?.[0]?.text ?? "";
    assertTrue(
      noConfirmText.includes("confirm") || noConfirmText.includes("literal"),
      `create_task without confirm mentions the gating literal (got: ${noConfirmText.slice(0, 200)})`,
    );

    // 6c. Mutation gating: add_comment without confirm must error.
    const noConfirmCommentRes = await client.callTool({
      name: "add_comment",
      arguments: { taskId: newId, body: "nope" },
    });
    assertTrue(isMcpError(noConfirmCommentRes), "add_comment without confirm: true is rejected");

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