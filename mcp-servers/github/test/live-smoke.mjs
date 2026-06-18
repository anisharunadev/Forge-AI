// test/live-smoke.mjs
// Live end-to-end smoke for the FORA GitHub MCP server.
//
// Runs the compiled MCP server pointed at the real api.github.com (not a mock),
// drives every tool via the MCP client, and asserts on:
//
//   1. All 7 tools return real, plausible payloads.
//   2. Org-pinning refuses cross-org repos with an OrgScopeError.
//   3. Rate-limit / auth errors surface as MCP errors (not crashes).
//
// Required env:
//   GITHUB_TOKEN   a real PAT or installation token with repo+read:org
//   GITHUB_ORG     the org to pin to (must be reachable by the token)
//   GITHUB_REPO    the test repo inside that org
//   PR_NUMBER      (optional) a PR number in that repo. Defaults to 1.
//
// Exits non-zero on the first assertion failure. The whole transcript is
// streamed to stdout in [live] lines so the operator can attach it as evidence.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

function log(label, msg) {
  process.stdout.write(`[live] ${label}: ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[live] FAILED: ${msg}\n`);
  process.exit(1);
}

function assertTrue(cond, label) {
  if (!cond) fail(`assertion failed [${label}]: expected truthy`);
  log("ok", label);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`assertion failed [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  log("ok", label);
}

function assertIncludes(arr, predicate, label) {
  if (!arr.some(predicate)) {
    fail(`assertion failed [${label}]: no matching entry in ${JSON.stringify(arr).slice(0, 500)}`);
  }
  log("ok", label);
}

// callToolJson — wraps client.callTool and returns the parsed JSON content.
// Tolerates transient GitHub 5xx by retrying up to RETRIES times with
// exponential backoff. If the response is `isError: true`, returns the
// parsed content (which may be an object) and lets the caller assert on
// the error shape.
const RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callToolJson(client, name, args, labelForLog) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const res = await client.callTool({ name, arguments: args });
    const text = res?.content?.[0]?.text ?? "";
    // Try to parse as JSON. If it fails, the body is almost certainly an
    // HTML error page (e.g. 502 Bad Gateway from api.github.com) — retry.
    try {
      const parsed = JSON.parse(text);
      return { res, parsed };
    } catch (e) {
      lastErr = e;
      const isHtml = /^\s*</.test(text);
      if (isHtml && attempt < RETRIES - 1) {
        const backoff = 500 * Math.pow(2, attempt);
        log("retry", `${labelForLog ?? name} attempt ${attempt + 1}/${RETRIES} got HTML (likely 5xx), backing off ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      // Non-retryable: surface the error
      fail(`${labelForLog ?? name} returned non-JSON body: ${text.slice(0, 200)}`);
    }
  }
  fail(`${labelForLog ?? name} exhausted ${RETRIES} retries: ${lastErr?.message ?? "unknown"}`);
}

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.GITHUB_ORG;
const REPO = process.env.GITHUB_REPO;
const PR_NUMBER = Number(process.env.PR_NUMBER ?? "6");

if (!TOKEN) fail("GITHUB_TOKEN env var is required for the live smoke");
if (!ORG) fail("GITHUB_ORG env var is required for the live smoke");
if (!REPO) fail("GITHUB_REPO env var is required for the live smoke");

log("setup", `org='${ORG}' repo='${REPO}' pr=#${PR_NUMBER}`);

// 1. Spawn the compiled MCP server as a child process pointed at real api.github.com.
const child = spawn(process.execPath, [serverEntry], {
  env: {
    ...process.env,
    GITHUB_TOKEN: TOKEN,
    GITHUB_ORG: ORG,
    // GITHUB_API_BASE_URL intentionally not set — the server should default
    // to https://api.github.com, which is what we want to exercise.
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let childStderr = "";
child.stderr.on("data", (b) => {
  childStderr += b.toString("utf8");
  process.stderr.write(`[live][server] ${b.toString("utf8")}`);
});
child.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    process.stderr.write(`[live] MCP server exited early code=${code}\n`);
  }
});

// 2. MCP client over stdio. We point the client at the same binary so we get
//    a fresh child process; cheaper than reusing the spawned one. We pipe the
//    transport child's stderr so the FORA-13 deprecation-warning assertion
//    below can read what Octokit actually logged on real GitHub responses.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: {
    ...process.env,
    GITHUB_TOKEN: TOKEN,
    GITHUB_ORG: ORG,
  },
  stderr: "pipe",
});
const client = new Client({ name: "fora-live-smoke", version: "0.0.0" });
await client.connect(transport);

// Buffer the transport child's stderr; mirror it to our stderr for the
// operator. We assert below that no /search/code deprecation line escaped
// the MCP server's Octokit log wrapper (FORA-13).
let transportStderr = "";
transport.stderr?.on("data", (b) => {
  const s = b.toString("utf8");
  transportStderr += s;
  process.stderr.write(`[live][transport] ${s}`);
});

let exitCode = 0;
try {
  // 3a. list_repos — must include our test repo.
  log("call", "list_repos");
  const { parsed: repos } = await callToolJson(client, "list_repos", { per_page: 100 }, "list_repos");
  assertTrue(Array.isArray(repos), "list_repos returns an array");
  assertTrue(repos.length > 0, "list_repos returns at least 1 repo");
  assertIncludes(
    repos,
    (r) => r.full_name === `${ORG}/${REPO}`,
    `list_repos includes ${ORG}/${REPO}`,
  );
  log("evidence", `repos[0..3] = ${repos.slice(0, 3).map((r) => r.full_name).join(", ")}`);

  // 3b. get_pr — should return the seed PR.
  log("call", `get_pr #${PR_NUMBER}`);
  const { parsed: pr } = await callToolJson(client, "get_pr", { owner: ORG, repo: REPO, pull_number: PR_NUMBER }, "get_pr");
  assertEqual(pr.number, PR_NUMBER, "get_pr returns correct PR number");
  assertTrue(typeof pr.title === "string" && pr.title.length > 0, "get_pr returns a title");
  assertTrue("additions" in pr && typeof pr.additions === "number", "get_pr returns additions");
  assertTrue("mergeable" in pr, "get_pr returns mergeable");
  log("evidence", `pr.title='${pr.title}' additions=${pr.additions} mergeable=${pr.mergeable} html_url=${pr.html_url}`);

  // 3c. list_prs — should include our seed PR.
  log("call", "list_prs");
  const { parsed: prs } = await callToolJson(client, "list_prs", { owner: ORG, repo: REPO, state: "all" }, "list_prs");
  assertTrue(Array.isArray(prs), "list_prs returns an array");
  assertIncludes(prs, (p) => p.number === PR_NUMBER, `list_prs includes PR #${PR_NUMBER}`);

  // 3d. create_pr_comment — write a real comment on the seed PR.
  const commentBody = `## FORA live E2E smoke

Posted at ${new Date().toISOString()} by \`@fora/mcp-github\`.`;
  log("call", "create_pr_comment");
  const { parsed: comment } = await callToolJson(client, "create_pr_comment", {
    owner: ORG,
    repo: REPO,
    pull_number: PR_NUMBER,
    body: commentBody,
  }, "create_pr_comment");
  assertTrue(typeof comment.id === "number" && comment.id > 0, "create_pr_comment returns an id");
  assertTrue(typeof comment.html_url === "string" && comment.html_url.includes("issuecomment"), "create_pr_comment returns html_url");
  log("evidence", `comment.id=${comment.id} html_url=${comment.html_url}`);

  // 3e. list_issues — GitHub returns both issues and PRs in /issues; the MCP
  //     server passes the response through unchanged. The seed issues are #1..#5.
  log("call", "list_issues state=open");
  const { parsed: issues } = await callToolJson(client, "list_issues", { owner: ORG, repo: REPO, state: "open" }, "list_issues");
  assertTrue(Array.isArray(issues), "list_issues returns an array");
  assertTrue(issues.length >= 1, "list_issues returns at least 1 open issue");
  assertIncludes(issues, (i) => i.number === 1, "list_issues includes issue #1");
  log("evidence", `open issues: ${issues.map((i) => `#${i.number}`).join(", ")}`);

  // 3f. create_issue — write a real new issue, then list_issues should include it.
  const newIssueTitle = `FORA live smoke @ ${new Date().toISOString()}`;
  log("call", "create_issue");
  const { parsed: newIssue } = await callToolJson(client, "create_issue", {
    owner: ORG,
    repo: REPO,
    title: newIssueTitle,
    body: "Created by the FORA live E2E smoke (FORA-11).",
  }, "create_issue");
  assertTrue(typeof newIssue.number === "number" && newIssue.number > 0, "create_issue returns a number");
  assertEqual(newIssue.title, newIssueTitle, "create_issue returns correct title");
  assertTrue(typeof newIssue.html_url === "string", "create_issue returns html_url");
  log("evidence", `new issue #${newIssue.number}: ${newIssue.html_url}`);

  // 3g. search_code — must hit the GitHub search endpoint and return the
  //     correct shape. We use a common term ('function') that finds indexed
  //     code across the org; the orchestrator.ts seed in our new repo will
  //     not be indexed for several minutes after creation, so we do not
  //     assert on it specifically.
  log("call", "search_code q=function");
  const { parsed: search } = await callToolJson(client, "search_code", { q: "function" }, "search_code(function)");
  assertTrue(Array.isArray(search), "search_code returns an array");
  assertTrue(search.length >= 1, "search_code returns at least 1 hit for a common term");
  assertTrue(
    search.every((h) => typeof h.path === "string" && typeof h.html_url === "string"),
    "search_code hits have the expected shape (path, html_url)",
  );
  assertTrue(
    search.some((h) => h.repository.full_name === `${ORG}/forge-ai-app`
      || h.repository.full_name === `${ORG}/cloud-report-app`),
    "search_code returns hits from the pinned org (org qualifier appended)",
  );
  log("evidence", `search hits: ${search.map((h) => `${h.repository.full_name}/${h.path}`).slice(0, 3).join(", ")}`);

  // 3g.bonus — also confirm the org qualifier is appended when not supplied.
  // The MCP server does this in client.ts: searchCode appends ' org:<org>'
  // to the query so a malicious query string can't escape scope.
  log("call", "search_code q='KnackForge' (should still be org-scoped)");
  const { parsed: scoped } = await callToolJson(client, "search_code", { q: "KnackForge" }, "search_code(KnackForge)");
  assertTrue(Array.isArray(scoped), "scoped search_code returns an array");
  // Every hit must be inside the pinned org — that's the org-pinning guarantee
  // for the search tool. (If a malicious model tried to escape, hits from
  // outside the org would show up here.)
  const offOrgHits = scoped.filter((h) => !h.repository.full_name.startsWith(`${ORG}/`));
  assertEqual(offOrgHits.length, 0, "scoped search_code returns zero hits outside the pinned org");
  log("evidence", `scoped search hits all in ${ORG}: ${scoped.length} hits, 0 off-org`);

  // 3g.fora13 — confirm Octokit's `/search/code` deprecation warning never
  // reaches stderr. api.github.com sends `Deprecation: true` and
  // `Sunset: Sun, 27 Sep 2026 …` headers on every /search/code response, and
  // Octokit's request layer turns that into `[@octokit/request] "GET
  // …/search/code…" is deprecated …`. The MCP server's Octokit log wrapper
  // (src/client.ts SEARCH_CODE_DEPRECATION_PATTERN) swallows that single
  // line; everything else still flows. If this fires, either GitHub stopped
  // returning the header (unblocks a follow-up) or the suppression pattern
  // drifted.
  const depMatch = /\[@octokit\/request\][^\n]*\/search\/code[^\n]*deprecated/i.test(
    transportStderr,
  );
  if (depMatch) {
    fail(
      "FORA-13: /search/code deprecation warning leaked to stderr. " +
        "Excerpt: " +
        transportStderr
          .split("\n")
          .filter((l) => /search\/code/.test(l))
          .slice(0, 3)
          .join(" | "),
    );
  }
  log("ok", "FORA-13: /search/code deprecation warning suppressed");

  // 4. Org-pinning denial — call with the wrong owner and confirm the server
  //    refuses with an `isError: true` response rather than letting the call
  //    land. The MCP SDK catches the thrown OrgScopeError and wraps it as
  //    a result with `isError: true` and the message in the content block.
  log("call", "org-pinning denial: get_pr with owner='some-other-org'");
  let denied = false;
  let deniedMsg = "";
  try {
    const denialRes = await client.callTool({
      name: "get_pr",
      arguments: { owner: "some-other-org", repo: REPO, pull_number: PR_NUMBER },
    });
    if (denialRes?.isError === true) {
      const text = denialRes?.content?.[0]?.text ?? "";
      denied = /pinned to '.*'/.test(text) || /Refusing to act on org/.test(text);
      deniedMsg = text;
    }
  } catch (err) {
    const text = err?.message ?? String(err);
    denied = /pinned to '.*'/.test(text) || /Refusing to act on org/.test(text);
    deniedMsg = text;
  }
  if (!denied) {
    fail(`org-pinning denial expected but server accepted the cross-org call. last err: ${deniedMsg}`);
  }
  log("ok", "org-pinning denied cross-org call (isError: true with OrgScopeError message)");
  log("evidence", `denial message: ${deniedMsg}`);

  // 5. Rate-limit / auth-error path — call with a deliberately bad token
  //    against a separate child process; the server should surface a clear
  //    MCP error rather than crash.
  log("call", "rate-limit / auth error path with bad token");
  const badTransport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      GITHUB_TOKEN: "ghp_this_is_a_fake_token_for_auth_error_test",
      GITHUB_ORG: ORG,
    },
  });
  const badClient = new Client({ name: "fora-live-smoke-bad", version: "0.0.0" });
  let authErr = "";
  try {
    await badClient.connect(badTransport);
    try {
      const r = await badClient.callTool({ name: "list_repos", arguments: {} });
      if (r?.isError === true) {
        authErr = r?.content?.[0]?.text ?? "(empty error content)";
      }
    } catch (e) {
      authErr = e?.message ?? String(e);
    }
  } finally {
    try { await badClient.close(); } catch {}
  }
  // GitHub returns 401 for a bogus token. The MCP server should propagate
  // that as an MCP tool error, not crash the process.
  assertTrue(authErr.length > 0, "bad-token call surfaced a non-empty error");
  assertTrue(
    /401|Unauthorized|Bad credentials|api.github.com/i.test(authErr),
    `bad-token error mentions 401/auth/api.github.com (got: ${authErr.split("\n")[0]})`,
  );
  log("evidence", `bad-token error (first line): ${authErr.split("\n")[0]}`);

  log("done", "all 7 tools live-tested green against api.github.com");
} catch (err) {
  process.stderr.write(
    `[live] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exitCode = 1;
} finally {
  try { await client.close(); } catch {}
  child.kill("SIGTERM");
  process.exit(exitCode);
}
