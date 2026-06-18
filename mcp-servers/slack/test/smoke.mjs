// test/smoke.mjs
// End-to-end smoke test for the FORA Slack MCP server — READ-ONLY (FORA-290).
//
// Flow:
//   1. Spin up a mock Slack Web API server on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every read tool at least once.
//   4. Assert the returned payloads AND that no mutation route was ever hit.
//   5. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-slack.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const TEAM_ID = "T0123MOCK";
const FAKE_TOKEN = "xoxb-smoketest-fake-token";

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

function assertNone(arr, predicate, label) {
  if (arr.some(predicate)) {
    throw new Error(
      `assertion failed [${label}]: forbidden entry found in ${JSON.stringify(arr)}`,
    );
  }
  log("ok", label);
}

async function main() {
  // 1. Mock Slack server.
  const state = initialState({ teamId: TEAM_ID });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      SLACK_BOT_TOKEN: FAKE_TOKEN,
      SLACK_TEAM_ID: TEAM_ID,
      SLACK_API_BASE_URL: baseUrl,
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

  // 3. MCP client.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      SLACK_BOT_TOKEN: FAKE_TOKEN,
      SLACK_TEAM_ID: TEAM_ID,
      SLACK_API_BASE_URL: baseUrl,
    },
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  try {
    // 4a. list_channels — exercises the startup auth.test + workspace pin.
    const channelsRes = await client.callTool({ name: "list_channels", arguments: {} });
    const channels = JSON.parse(channelsRes.content[0].text);
    assertEqual(channels.channels.length, 2, "list_channels returns 2 non-archived channels");
    assertTrue(
      channels.channels.some((c) => c.id === "C001" && c.name === "general"),
      "list_channels includes C001 general",
    );
    assertTrue(
      channels.channels.some((c) => c.id === "C002" && c.isPrivate === true),
      "list_channels includes the private channel C002 with isPrivate=true",
    );
    assertTrue(
      !channels.channels.some((c) => c.id === "C003"),
      "list_channels excludes archived channel C003",
    );

    // 4b. list_threads — filters history to thread parents (reply_count > 0).
    const threadsRes = await client.callTool({
      name: "list_threads",
      arguments: { channel: "C001" },
    });
    const threads = JSON.parse(threadsRes.content[0].text);
    assertEqual(threads.channel, "C001", "list_threads echoes the channel");
    assertEqual(threads.threads.length, 1, "list_threads returns 1 thread parent in C001");
    assertEqual(threads.threads[0].ts, "1700000010.000200", "list_threads returns the right ts");
    assertEqual(threads.threads[0].replyCount, 2, "list_threads returns replyCount");

    // 4c. get_thread — full thread fetch.
    const threadRes = await client.callTool({
      name: "get_thread",
      arguments: { channel: "C001", thread_ts: "1700000010.000200" },
    });
    const thread = JSON.parse(threadRes.content[0].text);
    assertEqual(thread.channel, "C001", "get_thread echoes channel");
    assertEqual(thread.parentTs, "1700000010.000200", "get_thread echoes parent ts");
    assertTrue(thread.messages.length >= 1, "get_thread returns at least the parent message");
    assertEqual(thread.messages[0].ts, "1700000010.000200", "get_thread first message is the parent");

    // 4d. search_messages
    const searchRes = await client.callTool({
      name: "search_messages",
      arguments: { query: "smoke" },
    });
    const search = JSON.parse(searchRes.content[0].text);
    assertTrue(search.total >= 1, "search_messages returns at least 1 hit for 'smoke'");
    assertTrue(
      search.hits.some((h) => h.text === "Smoke thread parent"),
      "search_messages hits include the smoke thread parent",
    );

    // 5. Cross-check the HTTP layer.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/auth.test",
      "HTTP: startup auth.test hit /api/auth.test",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/conversations.list",
      "HTTP: list_channels hit /api/conversations.list",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/conversations.info",
      "HTTP: assertChannelTeam hit /api/conversations.info",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/conversations.history",
      "HTTP: list_threads hit /api/conversations.history",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/conversations.replies",
      "HTTP: get_thread hit /api/conversations.replies",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/search.messages",
      "HTTP: search_messages hit /api/search.messages",
    );

    // 6. CRITICAL: no mutation route must ever be hit.
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/chat.postMessage",
      "HTTP: no POST /api/chat.postMessage (post_message is removed)",
    );
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/chat.update",
      "HTTP: no POST /api/chat.update (update_message is removed)",
    );
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/reactions.add",
      "HTTP: no POST /api/reactions.add (add_reaction is removed)",
    );

    // 7. Unknown tool → either the MCP SDK rejects with -32602 or the
    //    handler returns isError: true with the read-only message.
    const unknownRes = await client.callTool({
      name: "post_message",
      arguments: { channel: "C001", text: "x", confirm: true },
    });
    assertTrue(
      unknownRes.isError === true || /not found|Unknown tool|read-only/i.test(
        String(unknownRes.content?.[0]?.text ?? ""),
      ),
      `post_message is not a registered tool (got isError=${unknownRes.isError} text=${String(unknownRes.content?.[0]?.text ?? "").slice(0, 200)})`,
    );

    // 8. Scope guard: a channel that exists but belongs to a different
    //    workspace must be refused.
    const scopeRes = await client.callTool({
      name: "list_threads",
      arguments: { channel: "C_OTHER" },
    });
    assertTrue(scopeRes.isError === true, "list_threads refuses a channel in another workspace");
    const scopeText = scopeRes.content?.[0]?.text ?? "";
    assertTrue(
      scopeText.includes("does not belong to pinned workspace"),
      `channel-scope error message includes "does not belong to pinned workspace" (got: ${scopeText.slice(0, 200)})`,
    );

    log("done", "all 4 read tools smoke-tested green; no mutation routes hit");
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
