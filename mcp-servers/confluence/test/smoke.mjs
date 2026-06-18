// test/smoke.mjs
// End-to-end smoke test for the FORA Confluence MCP server — READ-ONLY (FORA-290).
//
// Flow:
//   1. Spin up a mock Confluence Cloud (v2) REST server on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every read tool at least once.
//   4. Assert the returned payloads AND that no mutation route was ever hit.
//   5. Assert the CQL space-scope guard injects the pinned space id.
//   6. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-confluence.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const SPACE_KEY = "ENG";
const FAKE_EMAIL = "smoke@example.com";
const FAKE_TOKEN = "smoke-token";
const FAKE_BASE_URL = "https://acme.atlassian.net/wiki";

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
  // 1. Mock Confluence server.
  const state = initialState();
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      CONFLUENCE_BASE_URL: FAKE_BASE_URL,
      CONFLUENCE_EMAIL: FAKE_EMAIL,
      CONFLUENCE_API_TOKEN: FAKE_TOKEN,
      CONFLUENCE_SPACE_KEY: SPACE_KEY,
      CONFLUENCE_API_BASE_URL: baseUrl,
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
      CONFLUENCE_BASE_URL: FAKE_BASE_URL,
      CONFLUENCE_EMAIL: FAKE_EMAIL,
      CONFLUENCE_API_TOKEN: FAKE_TOKEN,
      CONFLUENCE_SPACE_KEY: SPACE_KEY,
      CONFLUENCE_API_BASE_URL: baseUrl,
    },
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  try {
    // 4a. list_pages — exercises the space-key resolution + the slim shape.
    const listRes = await client.callTool({ name: "list_pages", arguments: {} });
    const list = JSON.parse(listRes.content[0].text);
    assertTrue(Array.isArray(list), "list_pages returns an array");
    assertEqual(list.length, 3, "list_pages returns 3 pages in the pinned space");
    assertTrue(
      list.every((p) => p.spaceId === "9001"),
      "list_pages spaceId matches the pinned space",
    );
    assertTrue(
      list.some((p) => p.id === "10003" && p.title === "Threat model: tenant isolation"),
      "list_pages includes the threat-model page the SecurityEngineer allow-list is meant to surface",
    );

    // 4b. get_page — assert body is returned and the body content matches.
    const getRes = await client.callTool({
      name: "get_page",
      arguments: { page_id: "10003" },
    });
    const detail = JSON.parse(getRes.content[0].text);
    assertEqual(detail.id, "10003", "get_page returns the requested page id");
    assertEqual(detail.title, "Threat model: tenant isolation", "get_page returns the threat-model title");
    assertTrue(
      detail.body.value.includes("ADR-0003"),
      "get_page body includes the ADR-0003 reference (FORA-126 vault cross-link)",
    );

    // 4c. search — assert the server injects the space scope into the CQL.
    const searchRes = await client.callTool({
      name: "search",
      arguments: { cql: `text ~ "threat model"` },
    });
    const hits = JSON.parse(searchRes.content[0].text);
    assertTrue(Array.isArray(hits) && hits.length >= 1, "search returns at least 1 hit for 'threat model'");
    assertTrue(
      hits.some((h) => h.title === "Threat model: tenant isolation"),
      "search hit includes the threat model page",
    );
    assertTrue(
      hits.every((h) => h.spaceId === "9001"),
      "search hits are all in the pinned space (cross-tenant deny-by-default)",
    );

    // 5. HTTP-side assertions.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/v2/spaces",
      "HTTP: startup hit GET /api/v2/spaces for space-key resolution",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === `/api/v2/spaces/9001/pages`,
      "HTTP: list_pages hit GET /api/v2/spaces/9001/pages",
    );
    assertIncludes(
      state.callLog,
      (c) => c.method === "GET" && c.path === "/api/v2/pages/10003",
      "HTTP: get_page hit GET /api/v2/pages/10003",
    );
    const searchCall = state.callLog.find(
      (c) => c.method === "GET" && c.path === "/api/content/search",
    );
    assertTrue(searchCall !== undefined, "HTTP: search hit GET /api/content/search");
    // The server must have injected the pinned space into the CQL.
    const cqlParam = new URL(`http://x${searchCall.url ?? ""}`).searchParams.get("cql") ?? "";
    assertTrue(
      /space\s*=\s*9001/i.test(cqlParam),
      `search cql contains the pinned space guard (got: ${cqlParam.slice(0, 200)})`,
    );

    // 6. CRITICAL: no mutation route must ever be hit.
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/v2/pages",
      "HTTP: no POST /api/v2/pages (create_page is removed)",
    );
    assertNone(
      state.callLog,
      (c) => c.method === "PATCH" && /^\/api\/v2\/pages\/[^/]+$/.test(c.path),
      "HTTP: no PATCH /api/v2/pages/{id} (update_page is removed)",
    );
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/v2/footer-comments",
      "HTTP: no POST /api/v2/footer-comments (add_comment is removed)",
    );

    // 7. Unknown tool → either the MCP SDK rejects with -32602 (preferred
    // path: the tool is not even registered) or our handler returns an
    // isError: true with the read-only message. Either is acceptable; both
    // prove the mutation tool is unreachable.
    const unknownRes = await client.callTool({
      name: "create_page",
      arguments: { title: "x", body: "y" },
    });
    assertTrue(
      unknownRes.isError === true || /not found|Unknown tool|read-only/i.test(
        String(unknownRes.content?.[0]?.text ?? ""),
      ),
      `create_page is not a registered tool (got isError=${unknownRes.isError} text=${String(unknownRes.content?.[0]?.text ?? "").slice(0, 200)})`,
    );

    log("done", "all 3 read tools smoke-tested green; no mutation routes hit");
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
