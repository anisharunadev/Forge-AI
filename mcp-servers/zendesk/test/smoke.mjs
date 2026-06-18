// test/smoke.mjs
// End-to-end smoke test for the FORA Zendesk MCP server.
//
// Flow:
//   1. Spin up a mock Zendesk REST v2 server on a random port.
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

import { initialState, startMockServer, expectedAuthHeader } from "./mock-zendesk.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const SUBDOMAIN = "acme";
const EMAIL = "agent@acme.example";
const API_TOKEN = "zd_smoketest_fake_token";

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
  // 1. Mock Zendesk server.
  const state = initialState({ subdomain: SUBDOMAIN, email: EMAIL, apiToken: API_TOKEN });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server env. The apiBaseUrl points at the mock; the subdomain
  //    is still passed so the server's startup pin assertion runs the
  //    same code path as production.
  const env = {
    ...process.env,
    ZENDESK_SUBDOMAIN: SUBDOMAIN,
    ZENDESK_EMAIL: EMAIL,
    ZENDESK_API_TOKEN: API_TOKEN,
    ZENDESK_API_BASE_URL: baseUrl,
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
    // 4a. list_tickets
    const listRes = await client.callTool({ name: "list_tickets", arguments: {} });
    const tickets = JSON.parse(listRes.content[0].text);
    assertEqual(tickets.length, 2, "list_tickets returns 2 tickets");
    assertTrue(
      tickets.some((t) => t.id === 1 && t.subject === "Welcome to your Zendesk"),
      "list_tickets includes ticket #1",
    );

    // 4b. get_ticket
    const getRes = await client.callTool({
      name: "get_ticket",
      arguments: { ticketId: 1 },
    });
    const ticket = JSON.parse(getRes.content[0].text);
    assertEqual(ticket.id, 1, "get_ticket returns ticket #1");
    assertEqual(ticket.subject, "Welcome to your Zendesk", "get_ticket returns correct subject");
    assertTrue(Array.isArray(ticket.comments) && ticket.comments.length >= 1, "get_ticket returns comments");
    assertEqual(
      ticket.comments[0].body,
      "Welcome to your new Zendesk account. Reach out anytime.",
      "get_ticket returns first comment body",
    );

    // 4c. search_tickets
    const searchRes = await client.callTool({
      name: "search_tickets",
      arguments: { query: "smoke" },
    });
    const search = JSON.parse(searchRes.content[0].text);
    assertTrue(search.count >= 1, "search_tickets returns at least 1 result");
    assertTrue(
      search.results.some((t) => t.id === 2),
      "search_tickets includes ticket #2 (smoke ticket)",
    );

    // 4d. create_ticket (mutation — confirm: true)
    const createRes = await client.callTool({
      name: "create_ticket",
      arguments: {
        subject: "Smoke: Zendesk MCP connected",
        comment: { body: "Created by the FORA Zendesk smoke test." },
        priority: "high",
        tags: ["smoke", "mcp"],
        requesterEmail: "smoke@example.com",
        requesterName: "Smoke Tester",
        confirm: true,
      },
    });
    const created = JSON.parse(createRes.content[0].text);
    assertTrue(created.id > 0, "create_ticket returns a new id");
    assertEqual(created.subject, "Smoke: Zendesk MCP connected", "create_ticket returns correct subject");
    assertEqual(created.status, "new", "create_ticket returns new ticket status");
    assertTrue(
      Array.isArray(created.tags) && created.tags.includes("smoke"),
      "create_ticket returns tags including 'smoke'",
    );

    // 4e. update_ticket (mutation — confirm: true)
    const updateRes = await client.callTool({
      name: "update_ticket",
      arguments: {
        ticketId: created.id,
        status: "open",
        priority: "urgent",
        addTags: ["escalated"],
        confirm: true,
      },
    });
    const updated = JSON.parse(updateRes.content[0].text);
    assertEqual(updated.id, created.id, "update_ticket returns same id");
    assertEqual(updated.status, "open", "update_ticket status is open");
    assertEqual(updated.priority, "urgent", "update_ticket priority is urgent");
    assertTrue(updated.tags.includes("escalated"), "update_ticket tags include 'escalated'");

    // 4f. add_comment
    const commentRes = await client.callTool({
      name: "add_comment",
      arguments: {
        ticketId: created.id,
        comment: { body: "## Smoke test comment\n\nPosted by FORA Zendesk MCP smoke test." },
        public: true,
      },
    });
    const comment = JSON.parse(commentRes.content[0].text);
    assertTrue(comment.id > 0, "add_comment returns an id");
    assertTrue(comment.body.startsWith("## Smoke"), "add_comment returns the comment body");
    assertEqual(comment.public, true, "add_comment is public");

    // 4g. list_macros
    const macrosRes = await client.callTool({ name: "list_macros", arguments: {} });
    const macros = JSON.parse(macrosRes.content[0].text);
    assertEqual(macros.length, 2, "list_macros returns 2 macros");
    assertTrue(
      macros.some((m) => m.id === 50 && m.title.includes("priority")),
      "list_macros includes macro 50",
    );

    // 4h. apply_macro
    const applyRes = await client.callTool({
      name: "apply_macro",
      arguments: { ticketId: 2, macroId: 50 },
    });
    const applied = JSON.parse(applyRes.content[0].text);
    assertEqual(applied.id, 2, "apply_macro returns same ticket id");
    assertEqual(applied.priority, "high", "apply_macro applied priority=high");
    assertTrue(
      Array.isArray(applied.tags) && applied.tags.includes("macro-applied"),
      "apply_macro applied tags include 'macro-applied'",
    );

    // 4i. confirm: false must be rejected for mutations. The MCP SDK
    //     surfaces Zod validation failures as a thrown protocol error OR
    //     a successful response with isError: true; we accept either.
    const callsBefore = state.callLog.length;
    let confirmRejected = false;
    try {
      const res = await client.callTool({
        name: "create_ticket",
        arguments: {
          subject: "should-not-be-created",
          comment: { body: "this call must be rejected" },
          confirm: false,
        },
      });
      if (res && (res.isError === true || (res.content || []).some(
        (c) => typeof c?.text === "string" && /confirm|literal|invalid/i.test(c.text),
      ))) {
        confirmRejected = true;
      }
    } catch {
      confirmRejected = true;
    }
    const callsAfter = state.callLog.length;
    assertTrue(confirmRejected, "create_ticket rejects confirm: false (Zod literal)");
    assertEqual(callsAfter, callsBefore, "create_ticket with confirm:false made zero HTTP calls (rejected at validation)");

    // 5. Cross-check the HTTP layer.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/v2/tickets.json", "HTTP: list_tickets hit /api/v2/tickets.json");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/v2/tickets/1.json", "HTTP: get_ticket hit /api/v2/tickets/1.json");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/v2/search.json", "HTTP: search_tickets hit /api/v2/search.json");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/api/v2/tickets.json", "HTTP: create_ticket hit POST /api/v2/tickets.json");
    assertIncludes(state.callLog, (c) => c.method === "PUT" && c.path === `/api/v2/tickets/${created.id}.json`, "HTTP: update_ticket hit PUT /api/v2/tickets/{id}.json");
    assertIncludes(state.callLog, (c) => c.method === "PUT" && c.path === `/api/v2/tickets/${created.id}.json` && c.body && c.body.ticket && typeof c.body.ticket.comment === "object", "HTTP: add_comment used PUT /api/v2/tickets/{id}.json with comment body");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/v2/macros.json", "HTTP: list_macros hit /api/v2/macros.json");
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/api/v2/tickets/2/macros/50.json", "HTTP: apply_macro hit POST /api/v2/tickets/2/macros/50.json");

    // 6. Auth: every recorded call should have carried a Basic auth header
    //    built from the email + API token, matching the exact shape the
    //    client.ts buildFetch computes.
    const expectedAuth = expectedAuthHeader({ email: EMAIL, apiToken: API_TOKEN });
    const unauthed = state.callLog.filter((c) => c.authPresent !== true);
    assertEqual(unauthed.length, 0, "all HTTP calls carried the expected Basic auth header");
    // Spot-check: at least one recorded call's authPresent round-trip is true
    assertTrue(
      state.callLog.length > 0 && state.callLog.every((c) => c.authPresent === true),
      `auth header matched expected "${expectedAuth.slice(0, 20)}..." on every call`,
    );

    log("done", "all 8 tools smoke-tested green");
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
