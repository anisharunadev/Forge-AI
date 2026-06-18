// test/smoke.mjs
// End-to-end smoke test for the FORA Jira MCP server.
//
// Flow:
//   1. Spin up a mock Atlassian Jira Cloud REST v3 server on a random port.
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

import { initialState, startMockServer } from "./mock-atlassian.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const PROJECT_KEY = "FORA";
const FAKE_EMAIL = "smoke@example.com";
const FAKE_TOKEN = "smoke-token";
const FAKE_BASE_URL = "https://acme.atlassian.net";

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
  // 1. Mock Atlassian server.
  const state = initialState({ pinnedProject: PROJECT_KEY });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      JIRA_EMAIL: FAKE_EMAIL,
      JIRA_API_TOKEN: FAKE_TOKEN,
      JIRA_PROJECT_KEY: PROJECT_KEY,
      JIRA_BASE_URL: FAKE_BASE_URL,
      JIRA_API_BASE_URL: `${baseUrl}/rest/api/3`,
    },
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
    env: {
      ...process.env,
      JIRA_EMAIL: FAKE_EMAIL,
      JIRA_API_TOKEN: FAKE_TOKEN,
      JIRA_PROJECT_KEY: PROJECT_KEY,
      JIRA_BASE_URL: FAKE_BASE_URL,
      JIRA_API_BASE_URL: `${baseUrl}/rest/api/3`,
    },
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  try {
    // 4a. list_issues — auto-scoped to pinned project.
    const listRes = await client.callTool({ name: "list_issues", arguments: {} });
    const list = JSON.parse(listRes.content[0].text);
    assertEqual(list.total, 2, "list_issues returns 2 issues for the pinned project");
    assertEqual(list.issues.length, 2, "list_issues issues array length is 2");
    assertTrue(
      list.issues.every((i) => i.key.startsWith(`${PROJECT_KEY}-`)),
      "list_issues keys are all in the pinned project",
    );

    // 4b. search_jql — explicit JQL.
    const searchRes = await client.callTool({
      name: "search_jql",
      arguments: { jql: `project = ${PROJECT_KEY} AND status = "In Progress"` },
    });
    const search = JSON.parse(searchRes.content[0].text);
    assertEqual(search.total, 1, "search_jql filters by status");
    assertEqual(search.issues[0].key, `${PROJECT_KEY}-2`, "search_jql returns FORA-2 (In Progress)");

    // 4c. get_issue — returns detail + transitions.
    const getRes = await client.callTool({
      name: "get_issue",
      arguments: { issueIdOrKey: `${PROJECT_KEY}-1` },
    });
    const detail = JSON.parse(getRes.content[0].text);
    assertEqual(detail.key, `${PROJECT_KEY}-1`, "get_issue returns key FORA-1");
    assertEqual(detail.summary, "Build the thing", "get_issue returns summary");
    assertEqual(detail.transitions.length, 3, "get_issue returns 3 transitions");
    assertEqual(detail.status, "Open", "get_issue returns current status");

    // 4d. create_issue — no projectKey arg, server uses pin.
    const createRes = await client.callTool({
      name: "create_issue",
      arguments: {
        summary: "Smoke: MCP server connected",
        description: "Created by the FORA MCP smoke test.",
        issueTypeName: "Task",
        labels: ["smoke"],
      },
    });
    const created = JSON.parse(createRes.content[0].text);
    assertTrue(created.key.startsWith(`${PROJECT_KEY}-`), "create_issue returns a key in the pinned project");
    assertTrue(created.url.includes(created.key), "create_issue returns a browse URL");
    const newKey = created.key;

    // 4e. add_comment — plain text body.
    const commentRes = await client.callTool({
      name: "add_comment",
      arguments: { issueIdOrKey: newKey, body: "Smoke test comment." },
    });
    const comment = JSON.parse(commentRes.content[0].text);
    assertTrue(Number(comment.id) > 0, "add_comment returns a numeric id");

    // 4f. transition_issue — by name, reads back status.
    const transRes = await client.callTool({
      name: "transition_issue",
      arguments: { issueIdOrKey: newKey, transitionName: "Done" },
    });
    const trans = JSON.parse(transRes.content[0].text);
    assertEqual(trans.key, newKey, "transition_issue returns the issue key");
    assertTrue(typeof trans.status === "string", "transition_issue reads back a status");

    // 5. Cross-check the HTTP layer: confirm the server issued the right
    //    method/path combinations to the mock. The smoke test proves the
    //    MCP server is actually wiring calls through to Jira-shaped HTTP.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/rest/api/3/search/jql" && c.body?.jql?.includes(`project = ${PROJECT_KEY}`),
      "HTTP: list_issues hit POST /search/jql with pinned project JQL",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/rest/api/3/search/jql" && c.body?.jql?.includes("status = \"In Progress\""),
      "HTTP: search_jql hit POST /search/jql with caller's JQL",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && new RegExp(`^/rest/api/3/issue/${PROJECT_KEY}-1$`).test(c.path),
      "HTTP: get_issue hit GET /issue/FORA-1",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/rest/api/3/issue" && c.body?.fields?.project?.key === PROJECT_KEY,
      "HTTP: create_issue hit POST /issue with project.fields.project.key = FORA (no projectKey arg from model)",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && new RegExp(`^/rest/api/3/issue/${newKey}/comment$`).test(c.path),
      "HTTP: add_comment hit POST /issue/<newKey>/comment",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && new RegExp(`^/rest/api/3/issue/${newKey}/transitions$`).test(c.path),
      "HTTP: transition_issue hit POST /issue/<newKey>/transitions",
    );

    // 6. Scope guard: search_jql with a different project must refuse.
    // The MCP SDK wraps tool errors as a result with isError: true rather
    // than throwing on callTool, so we inspect the result payload.
    const scopeRes = await client.callTool({
      name: "search_jql",
      arguments: { jql: "project = OTHER" },
    });
    assertTrue(scopeRes.isError === true, "search_jql refuses JQL pinning a different project");
    const scopeText = scopeRes.content?.[0]?.text ?? "";
    assertTrue(
      scopeText.includes("Refusing to act on project"),
      `search_jql scope error message includes "Refusing to act on project" (got: ${scopeText.slice(0, 200)})`,
    );

    log("done", "all 6 tools smoke-tested green");
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
