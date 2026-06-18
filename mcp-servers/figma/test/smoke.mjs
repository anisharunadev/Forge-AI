// test/smoke.mjs
// End-to-end smoke test for the FORA Figma MCP server.
//
// Flow:
//   1. Spin up a mock Figma HTTP server on a random port.
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

import { initialState, startMockServer } from "./mock-figma.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const FILE_KEY = "ACME_FILE_KEY_1";
const TEAM_ID = "TEAM_ACME";
const FAKE_TOKEN = "fig_smoketest_fake_token";

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
  // 1. Mock Figma server.
  const state = initialState({ fileKey: FILE_KEY, teamId: TEAM_ID });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      FIGMA_TOKEN: FAKE_TOKEN,
      FIGMA_FILE_KEY: FILE_KEY,
      FIGMA_TEAM_ID: TEAM_ID,
      FIGMA_API_BASE_URL: baseUrl,
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

  // 3. MCP client. We drive the server over stdio.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      FIGMA_TOKEN: FAKE_TOKEN,
      FIGMA_FILE_KEY: FILE_KEY,
      FIGMA_TEAM_ID: TEAM_ID,
      FIGMA_API_BASE_URL: baseUrl,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  // Buffer the transport child's stderr so we can assert the server's
  // startup log line mentions the pinned file/team.
  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stderr.write(`[smoke][server] ${s}`);
  });

  try {
    // 4a. get_file
    const fileRes = await client.callTool({ name: "get_file", arguments: {} });
    const file = JSON.parse(fileRes.content[0].text);
    assertEqual(file.name, "ACME Marketing Site", "get_file returns file name");
    assertEqual(file.role, "owner", "get_file returns role");
    assertTrue(file.document && file.document.id === "0:0", "get_file returns document tree");

    // 4b. get_file_nodes
    const nodesRes = await client.callTool({
      name: "get_file_nodes",
      arguments: { node_ids: ["1:2", "1:3"] },
    });
    const nodes = JSON.parse(nodesRes.content[0].text);
    assertTrue("1:2" in nodes.nodes, "get_file_nodes returns 1:2");
    assertTrue("1:3" in nodes.nodes, "get_file_nodes returns 1:3");
    assertEqual(
      nodes.nodes["1:2"].document.name,
      "Hero Frame",
      "get_file_nodes returns correct node name for 1:2",
    );

    // 4c. get_node
    const nodeRes = await client.callTool({
      name: "get_node",
      arguments: { node_id: "1:3" },
    });
    const single = JSON.parse(nodeRes.content[0].text);
    assertEqual(single.document.id, "1:3", "get_node returns the requested node");
    assertEqual(single.document.name, "Hero Title", "get_node returns correct name");

    // 4d. get_images
    const imagesRes = await client.callTool({
      name: "get_images",
      arguments: { node_ids: ["1:2"], format: "png", scale: 2 },
    });
    const images = JSON.parse(imagesRes.content[0].text);
    assertTrue(typeof images["1:2"] === "string", "get_images returns a URL for 1:2");
    assertTrue(images["1:2"].endsWith(".png"), "get_images URL ends with .png");

    // 4e. get_comments (first page — empty list, no next cursor)
    const commentsRes = await client.callTool({
      name: "get_comments",
      arguments: {},
    });
    const comments = JSON.parse(commentsRes.content[0].text);
    assertTrue(Array.isArray(comments.comments), "get_comments returns comments array");
    assertEqual(comments.comments.length, 0, "get_comments returns empty list initially");
    assertTrue(comments.next === undefined, "get_comments returns no next cursor on empty list");

    // 4f. post_comment (seed the comments list so we can verify get_comments
    // paginates and the after cursor round-trips)
    const postA = await client.callTool({
      name: "post_comment",
      arguments: { message: "First smoke comment", client_meta: { x: 10, y: 20 } },
    });
    const postedA = JSON.parse(postA.content[0].text);
    assertTrue(typeof postedA.id === "string", "post_comment returns an id");
    assertTrue(postedA.message === "First smoke comment", "post_comment returns the message");

    const postB = await client.callTool({
      name: "post_comment",
      arguments: { message: "Second smoke comment" },
    });
    const postedB = JSON.parse(postB.content[0].text);
    assertTrue(postedB.id !== postedA.id, "post_comment returns distinct ids");

    const postC = await client.callTool({
      name: "post_comment",
      arguments: { message: "Third smoke comment" },
    });
    const postedC = JSON.parse(postC.content[0].text);

    // Contract drift: Figma's REST API does not paginate comments by
    // default, but the mock does so we can prove the after cursor is
    // threaded correctly. First page returns 2 items + a next cursor.
    const page1 = JSON.parse(
      (await client.callTool({ name: "get_comments", arguments: {} })).content[0].text,
    );
    assertEqual(page1.comments.length, 2, "get_comments page 1 returns 2 items");
    assertTrue(typeof page1.next === "string", "get_comments page 1 returns next cursor");

    const page2 = JSON.parse(
      (await client.callTool({ name: "get_comments", arguments: { after: page1.next } })).content[0].text,
    );
    assertEqual(page2.comments.length, 1, "get_comments page 2 returns 1 item");
    assertTrue(page2.next === undefined, "get_comments page 2 has no next cursor");
    assertEqual(
      page2.comments[0].id,
      postedC.id,
      "get_comments page 2 returns the last-posted comment",
    );

    // 5. Cross-check the HTTP layer: confirm the server issued the right
    //    method/path combinations to the mock. The smoke test proves the
    //    MCP server is actually wiring calls through to Figma-shaped HTTP.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/v1/files/${FILE_KEY}`,
      "HTTP: get_file hit /v1/files/{key}",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/v1/files/${FILE_KEY}/nodes`,
      "HTTP: get_file_nodes hit /v1/files/{key}/nodes",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/v1/images/${FILE_KEY}`,
      "HTTP: get_images hit /v1/images/{key}",
    );
    // get_node wraps get_file_nodes, so we expect two calls to /nodes —
    // one from get_file_nodes (multi) and one from get_node (single).
    const nodeCalls = state.callLog.filter(
      (c) => c.method === "GET" && c.path === `/v1/files/${FILE_KEY}/nodes`,
    );
    assertTrue(nodeCalls.length >= 2, "HTTP: get_node also issues /nodes (wrapped)");
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/v1/files/${FILE_KEY}/comments`,
      "HTTP: get_comments hit /v1/files/{key}/comments",
    );
    const postCount = state.callLog.filter(
      (c) => c.method === "POST" && c.path === `/v1/files/${FILE_KEY}/comments`,
    ).length;
    assertTrue(postCount === 3, "HTTP: post_comment issued 3 POSTs to /v1/files/{key}/comments");

    // Startup assertion: stderr should mention the pinned file + team.
    assertTrue(
      transportStderr.includes(`file='${FILE_KEY}'`) &&
        transportStderr.includes(`team='${TEAM_ID}'`),
      "startup stderr names the pinned file and team",
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
