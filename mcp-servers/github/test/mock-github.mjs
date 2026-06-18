// test/mock-github.mjs
// Lightweight in-memory GitHub REST + GraphQL mock for the smoke test.
//
// Implements the minimum surface the FORA GitHub MCP server touches:
//   GET  /orgs/{org}/repos
//   GET  /repos/{owner}/{repo}/pulls
//   GET  /repos/{owner}/{repo}/pulls/{n}
//   POST /repos/{owner}/{repo}/issues/{n}/comments
//   GET  /repos/{owner}/{repo}/issues
//   POST /graphql                       (FORA-14: create_issue is GraphQL now)
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the comment / issue creation payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} repos
 * @property {Array<Record<string, unknown>>} pulls
 * @property {Array<Record<string, unknown>>} issues
 * @property {Array<Record<string, unknown>>} comments
 * @property {Record<string, string>} repoNodeIds        FORA-14: GraphQL Node IDs by "owner/repo"
 * @property {Record<string, Record<string, string>>} labelNodeIds  FORA-14: label Node IDs by "owner/repo" → name → id
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 */

/** @returns {MockState} */
export function initialState() {
  return {
    repos: [
      {
        id: 101,
        name: "forge",
        full_name: "acme-corp/forge",
        private: false,
        default_branch: "main",
        html_url: "https://github.example/acme-corp/forge",
      },
      {
        id: 102,
        name: "atlas",
        full_name: "acme-corp/atlas",
        private: true,
        default_branch: "main",
        html_url: "https://github.example/acme-corp/atlas",
      },
    ],
    // FORA-14: GraphQL Node IDs for repos and labels. The create_issue tool
    // migrated off REST POST /repos/{owner}/{repo}/issues to the GraphQL
    // createIssue mutation, which requires repositoryId + labelIds. We
    // synthesize stable Node IDs in the same shape GitHub returns.
    repoNodeIds: {
      "acme-corp/forge": "R_node_forge_101",
      "acme-corp/atlas": "R_node_atlas_102",
    },
    labelNodeIds: {
      "acme-corp/forge": {
        smoke: "L_node_smoke_1",
        bug: "L_node_bug_2",
        roadmap: "L_node_roadmap_3",
      },
      "acme-corp/atlas": {
        smoke: "L_node_atlas_smoke_1",
      },
    },
    pulls: [
      {
        number: 7,
        title: "Wire up the SDLC orchestrator",
        state: "open",
        user: { login: "octocat" },
        head: { ref: "feat/orchestrator", sha: "deadbeef" },
        base: { ref: "main" },
        html_url: "https://github.example/acme-corp/forge/pull/7",
        created_at: "2026-06-10T10:00:00Z",
        updated_at: "2026-06-12T11:00:00Z",
        body: "Connects the master orchestrator to the BA/Architect/Developer/QA agents.",
        additions: 320,
        deletions: 12,
        changed_files: 9,
        mergeable: true,
      },
      {
        number: 6,
        title: "Add MCP server scaffold",
        state: "closed",
        user: { login: "mona" },
        head: { ref: "feat/mcp", sha: "cafef00d" },
        base: { ref: "main" },
        html_url: "https://github.example/acme-corp/forge/pull/6",
        created_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-02T11:00:00Z",
        body: null,
        additions: 80,
        deletions: 4,
        changed_files: 3,
        mergeable: null,
      },
    ],
    issues: [
      {
        number: 12,
        title: "Track MCP server roadmap",
        state: "open",
        user: { login: "octocat" },
        html_url: "https://github.example/acme-corp/forge/issues/12",
        created_at: "2026-06-05T10:00:00Z",
        labels: [{ name: "roadmap" }],
      },
    ],
    comments: [],
    callLog: [],
  };
}

/**
 * Start the mock server. Returns the base URL and a shutdown function.
 *
 * @param {MockState} state
 * @param {number} port
 * @returns {Promise<{ baseUrl: string, shutdown: () => Promise<void> }>}
 */
export function startMockServer(state, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = u.pathname;
      state.callLog.push({ method: req.method ?? "?", path, body: null });

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? safeJson(raw) : null;
        if (body !== null) {
          state.callLog[state.callLog.length - 1].body = body;
        }

        try {
          handle(state, req.method ?? "GET", path, u, body, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              message: "mock server error",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("mock server did not bind to a TCP port"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        shutdown: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * FORA-14: handle the GraphQL `createIssue` flow with the same payload
 * shapes GitHub returns. We only implement the two operations the MCP
 * server's createIssue tool issues: `ResolveRepoAndLabels` (a query) and
 * `CreateIssue` (a mutation). Anything else gets a 200 with an `errors`
 * array so the client surfaces a real failure rather than a 404.
 */
function handleGraphql(state, body, res) {
  const query = typeof body?.query === "string" ? body.query : "";
  const variables = (body && typeof body.variables === "object" && body.variables) || {};

  // query ResolveRepoAndLabels
  if (/query\s+ResolveRepoAndLabels\b/.test(query)) {
    const owner = String(variables.owner ?? "").toLowerCase();
    const repo = String(variables.repo ?? "").toLowerCase();
    const key = `${owner}/${repo}`;
    const repoNodeId = state.repoNodeIds[key];
    if (!repoNodeId) {
      return sendJson(res, 200, {
        data: { repository: null },
        errors: [{ message: `Could not resolve to a Repository with owner=${variables.owner} name=${variables.repo}.` }],
      });
    }
    const labelsForRepo = state.labelNodeIds[key] ?? {};
    const data = { repository: { id: repoNodeId } };
    // The MCP client builds aliases like `label0`, `label1`, … keyed off
    // $labelName0, $labelName1. We mirror the same shape back.
    Object.keys(variables).forEach((vname) => {
      const m = vname.match(/^labelName(\d+)$/);
      if (!m) return;
      const alias = `label${m[1]}`;
      const labelName = variables[vname];
      const nodeId = labelsForRepo[labelName];
      data.repository[alias] = nodeId ? { id: nodeId } : null;
    });
    return sendJson(res, 200, { data });
  }

  // mutation CreateIssue
  if (/mutation\s+CreateIssue\b/.test(query)) {
    const input = (variables && variables.input) || {};
    const repoId = input.repositoryId;
    // Reverse-look up which repo this Node ID belongs to so we can attach
    // the issue to the right list and build the html_url.
    const ownerRepo = Object.keys(state.repoNodeIds).find(
      (k) => state.repoNodeIds[k] === repoId,
    );
    if (!ownerRepo) {
      return sendJson(res, 200, {
        data: null,
        errors: [{ message: `Repository with id=${repoId} not found.` }],
      });
    }
    const [owner, repo] = ownerRepo.split("/");
    const number = 100 + state.issues.length + 1;
    const title = String(input.title ?? "(untitled)");
    const url = `https://github.example/${owner}/${repo}/issues/${number}`;
    const labelIds = Array.isArray(input.labelIds) ? input.labelIds : [];
    const labelsForRepo = state.labelNodeIds[ownerRepo] ?? {};
    const resolvedLabelNames = labelIds
      .map((id) => Object.entries(labelsForRepo).find(([, nid]) => nid === id)?.[0])
      .filter((n) => typeof n === "string");
    state.issues.push({
      number,
      title,
      state: "open",
      user: { login: "fora-bot" },
      html_url: url,
      created_at: new Date().toISOString(),
      labels: resolvedLabelNames.map((n) => ({ name: n })),
    });
    return sendJson(res, 200, {
      data: {
        createIssue: {
          issue: { number, title, url, state: "OPEN" },
        },
      },
    });
  }

  return sendJson(res, 200, {
    data: null,
    errors: [{ message: "mock: unhandled GraphQL operation. Only ResolveRepoAndLabels and CreateIssue are implemented in this mock (FORA-14)." }],
  });
}

function handle(state, method, path, url, body, res) {
  // GET /orgs/{org}/repos
  let m = path.match(/^\/orgs\/([^/]+)\/repos$/);
  if (m && method === "GET") {
    return sendJson(res, 200, state.repos);
  }

  // GET /repos/{owner}/{repo}/pulls/{n}
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
  if (m && method === "GET") {
    const pr = state.pulls.find(
      (p) => p.number === Number(m[3]),
    );
    if (!pr) return sendJson(res, 404, { message: "Not Found" });
    return sendJson(res, 200, pr);
  }

  // GET /repos/{owner}/{repo}/pulls
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
  if (m && method === "GET") {
    const stateFilter = url.searchParams.get("state") ?? "open";
    const list = state.pulls.filter(
      (p) => stateFilter === "all" || p.state === stateFilter,
    );
    return sendJson(res, 200, list);
  }

  // POST /repos/{owner}/{repo}/issues/{n}/comments  (PR comments use the
  // issues endpoint under the hood — this is GitHub's real behavior).
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/);
  if (m && method === "POST") {
    const id = 9000 + state.comments.length + 1;
    const comment = {
      id,
      body: body?.body ?? "",
      html_url: `https://github.example/${m[1]}/${m[2]}/issues/${m[3]}#issuecomment-${id}`,
      user: { login: "fora-bot" },
    };
    state.comments.push(comment);
    return sendJson(res, 201, comment);
  }

  // GET /repos/{owner}/{repo}/issues
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/);
  if (m && method === "GET") {
    const stateFilter = url.searchParams.get("state") ?? "open";
    const list = state.issues.filter(
      (i) => stateFilter === "all" || i.state === stateFilter,
    );
    return sendJson(res, 200, list);
  }

  // POST /repos/{owner}/{repo}/issues
  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/);
  if (m && method === "POST") {
    // FORA-14: the create_issue tool migrated to GraphQL, so the old REST
    // route is no longer exercised. We keep a stub that returns 410 Gone
    // so any caller that still hits it fails loudly rather than silently
    // succeeding with a fake payload.
    return sendJson(res, 410, {
      message: "POST /repos/{owner}/{repo}/issues is deprecated and removed in this mock; use POST /graphql with the createIssue mutation (FORA-14).",
    });
  }

  // POST /graphql — FORA-14. The create_issue tool now goes through GraphQL
  // with two operations chained server-side per call:
  //   1) query ResolveRepoAndLabels — returns repository.id and aliased
  //      label{0..n} lookups so a single round trip resolves the repo + labels.
  //   2) mutation CreateIssue — uses the resolved repositoryId/labelIds to
  //      create the issue and return { number, title, url, state }.
  if (path === "/graphql" && method === "POST") {
    return handleGraphql(state, body, res);
  }

  // GET /search/code
  if (path === "/search/code" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const org = url.searchParams.get("org") ?? "acme-corp";
    const hits = [
      {
        name: "orchestrator.ts",
        path: "src/orchestrator.ts",
        repository: { full_name: `${org}/forge` },
        html_url: `https://github.example/${org}/forge/blob/main/src/orchestrator.ts`,
        score: 9.5,
      },
    ].filter((h) => !q || q.includes("orchestrator"));
    // Mirror the deprecation header GitHub returns on /search/code in
    // production. The MCP server's Octokit log wrapper is expected to
    // swallow the resulting "is deprecated" warning so it never reaches
    // stderr. See FORA-13 and src/client.ts SEARCH_CODE_DEPRECATION_PATTERN.
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("deprecation", "true");
    res.setHeader("sunset", "Sun, 27 Sep 2026 00:00:00 GMT");
    res.setHeader(
      "link",
      '<https://docs.github.com/rest/search/search#search-code>; rel="deprecation"',
    );
    res.end(JSON.stringify({ total_count: hits.length, items: hits }));
    return;
  }

  return sendJson(res, 404, { message: `mock: no route for ${method} ${path}` });
}
