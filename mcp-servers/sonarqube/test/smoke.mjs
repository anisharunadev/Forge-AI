// test/smoke.mjs
// End-to-end smoke test for the FORA SonarQube MCP server.
//
// Flow:
//   1. Spin up a mock SonarQube HTTP server on a random port.
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

import { initialState, startMockServer } from "./mock-sonarqube.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const PROJECT_KEY = "forge";
const FAKE_TOKEN = "squ_smoketest_fake_token";

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
  // 1. Mock SonarQube server.
  const state = initialState();
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process (env passed via StdioClientTransport below
  //    for the actual MCP traffic; this child is only used to mirror the
  //    server's stderr so we can detect startup failures).
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      SONARQUBE_TOKEN: FAKE_TOKEN,
      SONARQUBE_PROJECT_KEY: PROJECT_KEY,
      SONARQUBE_API_BASE_URL: baseUrl,
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

  // 3. MCP client. We capture the server's stderr so we can assert no
  //    accidental log lines leak onto the JSON-RPC stream.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      SONARQUBE_TOKEN: FAKE_TOKEN,
      SONARQUBE_PROJECT_KEY: PROJECT_KEY,
      SONARQUBE_API_BASE_URL: baseUrl,
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
    // 4a. list_projects
    const listRes = await client.callTool({
      name: "list_projects",
      arguments: { organization: "acme" },
    });
    const projects = JSON.parse(listRes.content[0].text);
    assertEqual(projects.length, 2, "list_projects returns 2 projects");
    assertTrue(
      projects.some((p) => p.key === "forge"),
      "list_projects includes forge",
    );

    // 4b. get_project (no arg → uses pinned project)
    const projRes = await client.callTool({ name: "get_project", arguments: {} });
    const project = JSON.parse(projRes.content[0].text);
    assertEqual(project.key, PROJECT_KEY, "get_project returns the pinned project");
    assertEqual(project.name, "Forge", "get_project returns correct name");

    // 4c. search_components
    const compRes = await client.callTool({
      name: "search_components",
      arguments: { query: "orchestrator" },
    });
    const components = JSON.parse(compRes.content[0].text);
    assertTrue(components.length >= 1, "search_components returns at least 1 result");
    assertEqual(components[0].key, "forge:src/orchestrator.ts", "search_components returns the right file");

    // 4d. get_component_measures
    const measRes = await client.callTool({
      name: "get_component_measures",
      arguments: { component: "forge:src/orchestrator.ts", metricKeys: ["coverage", "ncloc"] },
    });
    const measures = JSON.parse(measRes.content[0].text);
    assertEqual(measures.component.key, "forge:src/orchestrator.ts", "get_component_measures returns right component");
    assertEqual(measures.measures.length, 2, "get_component_measures returns 2 measures");
    assertEqual(measures.measures[0].metric, "coverage", "get_component_measures returns coverage first");

    // 4e. list_issues
    const issRes = await client.callTool({ name: "list_issues", arguments: {} });
    const issues = JSON.parse(issRes.content[0].text);
    assertEqual(issues.length, 2, "list_issues returns 2 issues");
    assertTrue(issues.some((i) => i.key === "AYforge-001"), "list_issues includes AYforge-001");

    // 4f. get_issue
    const oneRes = await client.callTool({
      name: "get_issue",
      arguments: { issueKey: "AYforge-002" },
    });
    const one = JSON.parse(oneRes.content[0].text);
    assertEqual(one.key, "AYforge-002", "get_issue returns AYforge-002");
    assertEqual(one.severity, "MINOR", "get_issue returns correct severity");

    // 4g. transition_issue was the only write tool. FORA-290 trims the
    //     server to read-only; we assert the tool is not registered.
    const transRes = await client.callTool({
      name: "transition_issue",
      arguments: { issueKey: "AYforge-002", transition: "wontfix", confirm: true },
    });
    assertTrue(
      transRes.isError === true || /not found|Unknown tool|read-only/i.test(
        String(transRes.content?.[0]?.text ?? ""),
      ),
      `transition_issue is not a registered tool (got isError=${transRes.isError} text=${String(transRes.content?.[0]?.text ?? "").slice(0, 200)})`,
    );

    // 4h. get_quality_gate
    const qgRes = await client.callTool({ name: "get_quality_gate", arguments: {} });
    const qg = JSON.parse(qgRes.content[0].text);
    assertEqual(qg.projectKey, PROJECT_KEY, "get_quality_gate returns the pinned project");
    assertEqual(qg.status, "WARN", "get_quality_gate returns WARN status");
    assertEqual(qg.conditions.length, 2, "get_quality_gate returns 2 conditions");

    // 4i. webhooks_get
    const whRes = await client.callTool({ name: "webhooks_get", arguments: {} });
    const wh = JSON.parse(whRes.content[0].text);
    assertTrue(wh.length >= 2, "webhooks_get returns at least 2 deliveries");
    assertTrue(wh.some((d) => d.success === false), "webhooks_get includes a failed delivery");

    // 5. Cross-check the HTTP layer.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/projects/search", "HTTP: list_projects hit /api/projects/search");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/projects/show", "HTTP: get_project hit /api/projects/show");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/components/search", "HTTP: search_components hit /api/components/search");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/measures/component", "HTTP: get_component_measures hit /api/measures/component");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/issues/search", "HTTP: list_issues hit /api/issues/search");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/qualitygates/project_status", "HTTP: get_quality_gate hit /api/qualitygates/project_status");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/api/webhooks/deliveries", "HTTP: webhooks_get hit /api/webhooks/deliveries");

    // 5b. CRITICAL: no POST route must ever be hit. FORA-290 read-only.
    assertNone(
      state.callLog,
      (c) => c.method === "POST" && c.path === "/api/issues/do_transition",
      "HTTP: no POST /api/issues/do_transition (transition_issue is removed)",
    );
    assertNone(
      state.callLog,
      (c) => c.method === "POST",
      "HTTP: no POST at all (read-only server refuses all writes)",
    );

    // 6. Contract assertion: stdout must be JSON-RPC only. The MCP server
    //    writes a startup line to stderr — that is fine — but nothing
    //    operational should land on stdout. We don't have a clean way to
    //    read the child's stdout without disrupting the transport, so we
    //    assert on stderr: the only lines allowed are the startup line and
    //    the shutdown line. Any other operational noise would be a
    //    contract violation.
    const lines = transportStderr.split("\n").filter(Boolean);
    const offContract = lines.filter(
      (l) =>
        !l.startsWith("[fora-mcp-sonarqube] starting") &&
        !l.startsWith("[fora-mcp-sonarqube] received"),
    );
    if (offContract.length > 0) {
      throw new Error(
        `assertion failed [stderr only carries startup/shutdown lines]:\n` +
          `  unexpected lines:\n  ${offContract.slice(0, 5).join("\n  ")}`,
      );
    }
    log("ok", "contract: stderr only carries startup/shutdown lines");

    log("done", "all 9 tools smoke-tested green");
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
