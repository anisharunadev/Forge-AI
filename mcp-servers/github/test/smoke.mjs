// test/smoke.mjs
// End-to-end smoke test for the FORA GitHub MCP server.
//
// Flow:
//   1. Spin up a mock GitHub HTTP server on a random port.
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

import { initialState, startMockServer } from "./mock-github.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const ORG = "acme-corp";
const FAKE_TOKEN = "ghp_smoketest_fake_token";

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
  // 1. Mock GitHub server.
  const state = initialState();
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      GITHUB_TOKEN: FAKE_TOKEN,
      GITHUB_ORG: ORG,
      GITHUB_API_BASE_URL: baseUrl,
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

  // 3. MCP client. We pipe the transport's child stderr so the deprecation
  //    assertion below (FORA-13) can read what Octokit actually logged.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      GITHUB_TOKEN: FAKE_TOKEN,
      GITHUB_ORG: ORG,
      GITHUB_API_BASE_URL: baseUrl,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-smoke", version: "0.0.0" });
  await client.connect(transport);

  // Buffer the transport child's stderr; mirror it to our stderr for the
  // operator. We assert on this buffer below to confirm the Octokit log
  // wrapper actually suppresses the /search/code deprecation warning that
  // the mock now returns on every search_code call.
  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stderr.write(`[smoke][server] ${s}`);
  });

  try {
    // 4a. list_repos
    const reposRes = await client.callTool({ name: "list_repos", arguments: {} });
    const repos = JSON.parse(reposRes.content[0].text);
    assertEqual(repos.length, 2, "list_repos returns 2 repos");
    assertTrue(
      repos.some((r) => r.full_name === "acme-corp/forge"),
      "list_repos includes acme-corp/forge",
    );

    // 4b. get_pr
    const prRes = await client.callTool({
      name: "get_pr",
      arguments: { owner: ORG, repo: "forge", pull_number: 7 },
    });
    const pr = JSON.parse(prRes.content[0].text);
    assertEqual(pr.number, 7, "get_pr returns PR #7");
    assertEqual(pr.title, "Wire up the SDLC orchestrator", "get_pr returns correct title");
    assertEqual(pr.additions, 320, "get_pr returns additions");

    // 4c. list_prs
    const prsRes = await client.callTool({
      name: "list_prs",
      arguments: { owner: ORG, repo: "forge", state: "all" },
    });
    const prs = JSON.parse(prsRes.content[0].text);
    assertEqual(prs.length, 2, "list_prs(state=all) returns 2 PRs");

    // 4d. create_pr_comment
    const commentRes = await client.callTool({
      name: "create_pr_comment",
      arguments: {
        owner: ORG,
        repo: "forge",
        pull_number: 7,
        body: "## Smoke test comment\n\nPosted by FORA MCP smoke test.",
      },
    });
    const comment = JSON.parse(commentRes.content[0].text);
    assertTrue(comment.id > 0, "create_pr_comment returns an id");
    assertTrue(comment.html_url.includes("issuecomment"), "create_pr_comment returns html_url");

    // 4e. list_issues
    const issuesRes = await client.callTool({
      name: "list_issues",
      arguments: { owner: ORG, repo: "forge" },
    });
    const issues = JSON.parse(issuesRes.content[0].text);
    assertEqual(issues.length, 1, "list_issues returns 1 open issue");
    assertEqual(issues[0].number, 12, "list_issues returns issue #12");

    // 4f. create_issue
    const newIssueRes = await client.callTool({
      name: "create_issue",
      arguments: {
        owner: ORG,
        repo: "forge",
        title: "Smoke: MCP server connected",
        body: "Created by the FORA smoke test.",
        labels: ["smoke"],
      },
    });
    const newIssue = JSON.parse(newIssueRes.content[0].text);
    assertTrue(newIssue.number > 0, "create_issue returns a number");
    assertEqual(newIssue.title, "Smoke: MCP server connected", "create_issue returns correct title");

    // 4g. search_code
    const searchRes = await client.callTool({
      name: "search_code",
      arguments: { q: "orchestrator" },
    });
    const search = JSON.parse(searchRes.content[0].text);
    assertTrue(search.length >= 1, "search_code returns at least 1 hit");
    assertEqual(search[0].name, "orchestrator.ts", "search_code returns expected file");

    // 5. Cross-check the HTTP layer: confirm the server issued the right
    //    method/path combinations to the mock. The smoke test proves the
    //    MCP server is actually wiring calls through to GitHub-shaped HTTP.
    const paths = state.callLog.map((c) => `${c.method} ${c.path}`);
    log("http", `recorded ${paths.length} requests`);
    log("http", paths.join("\n  "));

    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === `/orgs/${ORG}/repos`, "HTTP: list_repos hit /orgs/{org}/repos");
    assertIncludes(state.callLog, (c) => c.method === "GET" && /\/repos\/[^/]+\/[^/]+\/pulls\/\d+/.test(c.path), "HTTP: get_pr hit /repos/{owner}/{repo}/pulls/{n}");
    assertIncludes(state.callLog, (c) => c.method === "GET" && /\/repos\/[^/]+\/[^/]+\/pulls$/.test(c.path), "HTTP: list_prs hit /repos/{owner}/{repo}/pulls");
    assertIncludes(state.callLog, (c) => c.method === "POST" && /\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(c.path), "HTTP: create_pr_comment hit /repos/{owner}/{repo}/issues/{n}/comments");
    assertIncludes(state.callLog, (c) => c.method === "GET" && /\/repos\/[^/]+\/[^/]+\/issues$/.test(c.path), "HTTP: list_issues hit /repos/{owner}/{repo}/issues");
    // FORA-14: create_issue migrated from REST POST /repos/.../issues to
    // GraphQL POST /graphql. The MCP server's createIssue now issues two
    // operations per call (ResolveRepoAndLabels query + CreateIssue mutation).
    // We assert on the GraphQL endpoint here, and the mock's handleGraphql
    // distinguishes the two operations so a single /graphql POST from the
    // tool may appear in the callLog once per request.
    assertIncludes(state.callLog, (c) => c.method === "POST" && c.path === "/graphql", "HTTP: create_issue hit /graphql (FORA-14)");
    assertIncludes(state.callLog, (c) => c.method === "GET" && c.path === "/search/code", "HTTP: search_code hit /search/code");

    // FORA-13: the mock returns a `deprecation: true` + `sunset: …Sun, 27
    // Sep 2026…` header on /search/code, mirroring real api.github.com. The
    // MCP server's Octokit log wrapper must swallow the resulting
    // "[@octokit/request] …/search/code… is deprecated" warning so it never
    // reaches stderr. If this assertion ever fires, either the suppression
    // pattern in src/client.ts drifted or Octokit changed its log format.
    const deprecationMatch = /\[@octokit\/request\][^\n]*\/search\/code[^\n]*deprecated/i.test(
      transportStderr,
    );
    if (deprecationMatch) {
      throw new Error(
        `assertion failed [no /search/code deprecation warning on stderr]:\n` +
          `  stderr contained the deprecation line. Excerpt:\n` +
          `  ${transportStderr.split("\n").filter((l) => /search\/code/.test(l)).slice(0, 3).join("\n  ")}`,
      );
    }
    log("ok", "FORA-13: /search/code deprecation warning suppressed");

    log("done", "all 7 tools smoke-tested green");
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
