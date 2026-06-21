/**
 * Integration tests for the Kiro MCP server.
 *
 * Boots a mock Kiro daemon over local HTTP and spawns the compiled MCP
 * server pointed at it, then drives the tools over the MCP SDK client.
 *
 * The Kiro daemon spec is still evolving; we exercise the local-HTTP
 * transport (KIRO_HTTP_BASE_URL) so the mock can be a plain Node http
 * server, and the wire shape is the JSON envelope documented in
 * src/client.ts.
 *
 * 2 integration tests:
 *   1. full round-trip — open files + selection + tasks + history all
 *      round-trip through the real MCP server + real transport
 *   2. workspace assertion — a bad workspace id fails the startup
 *      liveness and the process exits non-zero
 *
 * Run with: npm run test:integration
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const WORKSPACE = "ws_integration_test";
const AUTH = "kiro_integration_token";

interface MockState {
  workspace: string;
  openFiles: unknown[];
  selection: unknown;
  tasks: unknown[];
  runs: unknown[];
  callLog: Array<{ method: string; path: string; auth: string | null; workspace: string | null }>;
}

function startMockDaemon(state: MockState): Promise<{
  baseUrl: string;
  shutdown: () => Promise<void>;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const auth = req.headers["authorization"]?.toString() ?? null;
      const ws = req.headers["x-kiro-workspace"]?.toString() ?? null;
      state.callLog.push({
        method: req.method ?? "?",
        path: url.pathname + url.search,
        auth,
        workspace: ws,
      });

      // The liveness call from index.ts is getActiveTaskQueue → /v1/tasks/active.
      // We treat a wrong workspace id as a 403 so the server's startup
      // assertion fails fast.
      if (ws && ws !== state.workspace) {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ message: `unknown workspace '${ws}'` }));
        return;
      }

      if (url.pathname === "/v1/state/open-files" && req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ files: state.openFiles }));
        return;
      }
      if (url.pathname === "/v1/state/selection" && req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ selection: state.selection }));
        return;
      }
      if (url.pathname === "/v1/tasks/active" && req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ tasks: state.tasks }));
        return;
      }
      if (url.pathname.startsWith("/v1/agents/runs") && req.method === "GET") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ runs: state.runs }));
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: `mock: no route for ${req.method} ${url.pathname}` }));
    });

    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        rejectPromise(new Error("mock daemon did not bind"));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        shutdown: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function spawnServer(env: Record<string, string>) {
  return spawn(process.execPath, [serverEntry], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("integration: all 4 tools round-trip through the mocked Kiro daemon", async () => {
  const state: MockState = {
    workspace: WORKSPACE,
    openFiles: [
      { path: "/repo/src/index.ts", active: true, dirty: false, language: "typescript" },
      { path: "/repo/README.md", active: false, dirty: true, language: "markdown" },
    ],
    selection: {
      filePath: "/repo/src/index.ts",
      startLine: 4,
      endLine: 8,
      text: "selected block",
    },
    tasks: [
      { id: "t1", title: "Refactor", status: "running", createdAt: "2026-06-22T10:00:00Z" },
      { id: "t2", title: "Lint", status: "pending", createdAt: "2026-06-22T10:01:00Z" },
    ],
    runs: [
      {
        id: "r1",
        agent: "kiro.refactor",
        title: "Refactor auth",
        status: "succeeded",
        startedAt: "2026-06-22T09:00:00Z",
        finishedAt: "2026-06-22T09:01:30Z",
        tokens: 4242,
      },
    ],
    callLog: [],
  };
  const { baseUrl, shutdown } = await startMockDaemon(state);

  // We pass KIRO_HTTP_BASE_URL so the server uses the HTTP transport
  // (instead of the default Unix socket). This is the smoke-test escape
  // hatch — see config.ts.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      KIRO_AUTH_TOKEN: AUTH,
      KIRO_WORKSPACE_ID: WORKSPACE,
      KIRO_HTTP_BASE_URL: baseUrl,
    },
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (b) => {
    serverStderr += b.toString("utf8");
  });

  const client = new McpClient({ name: "kiro-integration", version: "0.0.0" });
  await client.connect(transport);

  try {
    // get_open_files
    const filesRes = await client.callTool({ name: "get_open_files", arguments: {} });
    const files = JSON.parse(filesRes.content[0].text);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "/repo/src/index.ts");
    assert.equal(files[0].active, true);

    // get_current_selection
    const selRes = await client.callTool({ name: "get_current_selection", arguments: {} });
    const sel = JSON.parse(selRes.content[0].text);
    assert.equal(sel.filePath, "/repo/src/index.ts");
    assert.equal(sel.startLine, 4);
    assert.equal(sel.endLine, 8);

    // get_active_task_queue
    const tasksRes = await client.callTool({ name: "get_active_task_queue", arguments: {} });
    const tasks = JSON.parse(tasksRes.content[0].text);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, "t1");
    assert.equal(tasks[0].status, "running");

    // get_agent_run_history
    const runsRes = await client.callTool({
      name: "get_agent_run_history",
      arguments: { limit: 5 },
    });
    const runs = JSON.parse(runsRes.content[0].text);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, "r1");
    assert.equal(runs[0].tokens, 4242);

    // Cross-check the HTTP layer: the right routes were hit and the
    // workspace header was carried on every request.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    assert.ok(paths.includes("GET /v1/state/open-files"), "open-files was requested");
    assert.ok(paths.includes("GET /v1/state/selection"), "selection was requested");
    assert.ok(paths.includes("GET /v1/tasks/active"), "tasks/active was requested");
    assert.ok(paths.some((p) => p.startsWith("GET /v1/agents/runs")), "agents/runs was requested");
    for (const c of state.callLog) {
      assert.equal(c.workspace, WORKSPACE, `workspace header on ${c.method} ${c.path}`);
      assert.equal(c.auth, `Bearer ${AUTH}`, `auth header on ${c.method} ${c.path}`);
    }

    // Startup stderr names the pinned workspace + transport.
    assert.ok(
      serverStderr.includes(`workspace='${WORKSPACE}'`),
      "startup stderr names the pinned workspace",
    );
    assert.ok(
      serverStderr.includes("transport='http'"),
      "startup stderr names the http transport",
    );
  } finally {
    await client.close();
    await shutdown();
  }
});

test("integration: a bad workspace id fails the startup liveness", async () => {
  const state: MockState = {
    workspace: WORKSPACE,
    openFiles: [],
    selection: null,
    tasks: [],
    runs: [],
    callLog: [],
  };
  const { baseUrl, shutdown } = await startMockDaemon(state);

  const child = await spawnServer({
    KIRO_AUTH_TOKEN: AUTH,
    KIRO_WORKSPACE_ID: "WRONG_WORKSPACE",
    KIRO_HTTP_BASE_URL: baseUrl,
  });

  let stderr = "";
  child.stderr.on("data", (b) => {
    stderr += b.toString("utf8");
  });

  const exitCode: number = await new Promise((resolveExit) => {
    child.on("exit", (code) => resolveExit(code ?? -1));
  });

  // Process should exit non-zero (2) and stderr should name the failure.
  assert.notEqual(exitCode, 0, "bad workspace id → non-zero exit");
  assert.ok(
    stderr.includes("workspace-scope assertion failed"),
    "stderr mentions workspace-scope assertion failure",
  );
  assert.ok(
    stderr.includes("WRONG_WORKSPACE"),
    "stderr names the offending workspace id",
  );

  await shutdown();
});
