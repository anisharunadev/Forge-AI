// test/mock-azdo.mjs
// Lightweight in-memory Azure DevOps REST 7.1 mock for the smoke test.
//
// Implements the minimum surface the FORA Azure DevOps MCP server touches:
//   GET   /_apis/projects
//   GET   /{project}/_apis/git/repositories
//   GET   /{project}/_apis/pipelines
//   POST  /{project}/_apis/pipelines/{id}/runs
//   GET   /{project}/_apis/pipelines/{id}/runs/{runId}
//   POST  /{project}/_apis/wit/wiql
//   GET   /{project}/_apis/wit/workitems?ids=...
//   GET   /{project}/_apis/wit/workitems/{id}
//   POST  /{project}/_apis/wit/workitems/${type}      (URL-encoded $type)
//   POST  /{project}/_apis/wit/workitems/{id}/comments
//
// The project segment is optional in the path — the mock strips it before
// routing so the same server handles `GET /_apis/projects` (org-level) and
// `GET /forge-project/_apis/...` (project-level) with a single dispatcher.
//
// The mock records every call (method, path, body) so the smoke test can
// assert the MCP server issued the right requests and that mutation
// payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} projects
 * @property {Array<Record<string, unknown>>} repos
 * @property {Array<Record<string, unknown>>} pipelines
 * @property {Array<Record<string, unknown>>} pipelineRuns
 * @property {Array<Record<string, unknown>>} workItems
 * @property {Array<Record<string, unknown>>} comments
 * @property {string} project                        The "pinned" project name
 * @property {string} expectedPat                    The PAT the mock expects
 * @property {Array<{ method: string, path: string, body: unknown, authPresent: boolean }>} callLog
 */

/** @returns {MockState} */
export function initialState({ project = "forge", pat = "mock-pat-smoketest" } = {}) {
  return {
    project,
    expectedPat: pat,
    projects: [
      {
        id: "p-forge",
        name: "Forge",
        description: "Smoke-test project for the FORA AzDO MCP server.",
        state: "wellFormed",
        url: "https://dev.azure.example/forge/_apis/projects/p-forge",
      },
      {
        id: "p-atlas",
        name: "Atlas",
        description: "Adjacent test project — should be hidden by the project pin.",
        state: "wellFormed",
        url: "https://dev.azure.example/atlas/_apis/projects/p-atlas",
      },
    ],
    repos: [
      {
        id: "r-forge-1",
        name: "forge-app",
        defaultBranch: "refs/heads/main",
        url: "https://dev.azure.example/forge/_apis/git/repositories/r-forge-1",
        remoteUrl: "https://forge@dev.azure.example/forge/forge-app",
      },
      {
        id: "r-forge-2",
        name: "forge-infra",
        defaultBranch: "refs/heads/main",
        url: "https://dev.azure.example/forge/_apis/git/repositories/r-forge-2",
        remoteUrl: "https://forge@dev.azure.example/forge/forge-infra",
      },
    ],
    pipelines: [
      {
        id: 12,
        name: "forge-ci",
        folder: "\\",
        url: "https://dev.azure.example/forge/_apis/pipelines/12",
      },
      {
        id: 13,
        name: "forge-release",
        folder: "\\Releases",
        url: "https://dev.azure.example/forge/_apis/pipelines/13",
      },
    ],
    pipelineRuns: [],
    workItems: [
      {
        id: 101,
        rev: 1,
        fields: {
          "System.Id": 101,
          "System.Title": "Wire MCP server to orchestrator",
          "System.State": "Active",
          "System.WorkItemType": "Task",
          "System.Description": "Connects the AzDO MCP tools to the master orchestrator.",
        },
        url: "https://dev.azure.example/forge/_apis/wit/workitems/101",
      },
      {
        id: 102,
        rev: 1,
        fields: {
          "System.Id": 102,
          "System.Title": "Smoke-test AzDO end-to-end",
          "System.State": "New",
          "System.WorkItemType": "Bug",
        },
        url: "https://dev.azure.example/forge/_apis/wit/workitems/102",
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
      const auth = String(req.headers["authorization"] ?? "");
      const authPresent = /^Basic\s+/.test(auth);
      state.callLog.push({ method: req.method ?? "?", path, body: null, authPresent });

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? safeJson(raw) : null;
        if (body !== null) {
          state.callLog[state.callLog.length - 1].body = body;
        }

        // Strip a single optional project segment so the dispatcher can
        // match `/_apis/...` whether the URL is org-level (e.g. `/_apis/
        // projects`) or project-level (e.g. `/forge/_apis/...`).
        const tail = stripProject(path, state.project);

        try {
          handle(state, req.method ?? "GET", tail, u, body, res);
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

function stripProject(path, project) {
  const prefix = `/${project}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length - 1); // keep the leading "/"
  }
  return path;
}

function handle(state, method, tail, url, body, res) {
  // GET /_apis/projects
  if (tail === "/_apis/projects" && method === "GET") {
    return sendJson(res, 200, { value: state.projects, count: state.projects.length });
  }

  // GET /_apis/git/repositories
  if (tail === "/_apis/git/repositories" && method === "GET") {
    return sendJson(res, 200, { value: state.repos, count: state.repos.length });
  }

  // GET /_apis/pipelines
  if (tail === "/_apis/pipelines" && method === "GET") {
    return sendJson(res, 200, { value: state.pipelines, count: state.pipelines.length });
  }

  // POST /_apis/pipelines/{id}/runs
  let m = tail.match(/^\/_apis\/pipelines\/(\d+)\/runs$/);
  if (m && method === "POST") {
    const pipelineId = Number(m[1]);
    const id = 9000 + state.pipelineRuns.length + 1;
    const run = {
      id,
      pipelineId,
      state: "Queued",
      result: null,
      url: `https://dev.azure.example/forge/_apis/pipelines/${pipelineId}/runs/${id}`,
      createdDate: new Date().toISOString(),
      variables: body?.variables,
    };
    state.pipelineRuns.push(run);
    return sendJson(res, 200, run);
  }

  // GET /_apis/pipelines/{id}/runs/{runId}
  m = tail.match(/^\/_apis\/pipelines\/(\d+)\/runs\/(\d+)$/);
  if (m && method === "GET") {
    const run = state.pipelineRuns.find(
      (r) => r.pipelineId === Number(m[1]) && r.id === Number(m[2]),
    );
    if (!run) return sendJson(res, 404, { message: "Run not found" });
    return sendJson(res, 200, run);
  }

  // POST /_apis/wit/wiql
  if (tail === "/_apis/wit/wiql" && method === "POST") {
    // Return the first N work-item IDs. We don't actually parse the WIQL —
    // a real WIQL parser is out of scope for a mock. The smoke only
    // exercises default-list semantics.
    const top = state.workItems.length;
    return sendJson(res, 200, {
      queryType: "flat",
      columns: [],
      workItems: state.workItems.slice(0, top).map((w) => ({ id: w.id, url: w.url })),
    });
  }

  // GET /_apis/wit/workitems?ids=1,2,3
  if (tail === "/_apis/wit/workitems" && method === "GET") {
    const idsParam = (url.searchParams.get("ids") ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean);
    const value = state.workItems.filter((w) => idsParam.includes(w.id));
    return sendJson(res, 200, { value, count: value.length });
  }

  // GET /_apis/wit/workitems/{id}
  m = tail.match(/^\/_apis\/wit\/workitems\/(\d+)$/);
  if (m && method === "GET") {
    const id = Number(m[1]);
    const wi = state.workItems.find((w) => w.id === id);
    if (!wi) return sendJson(res, 404, { message: `Work item ${id} not found` });
    return sendJson(res, 200, wi);
  }

  // POST /_apis/wit/workitems/$TYPE — create. The $ is percent-encoded as %24.
  m = tail.match(/^\/_apis\/wit\/workitems\/\$([^/]+)$/);
  if (m && method === "POST") {
    const type = decodeURIComponent(m[1]);
    // The body is a JSON Patch document. We walk it to extract title +
    // description so the smoke can assert the right fields were set.
    const ops = Array.isArray(body) ? body : [];
    const fields = {};
    for (const op of ops) {
      if (op && op.op === "add" && typeof op.path === "string" && op.path.startsWith("/fields/")) {
        fields[op.path.slice("/fields/".length)] = op.value;
      }
    }
    const id = 200 + state.workItems.length + 1;
    const wi = {
      id,
      rev: 1,
      fields: {
        "System.Id": id,
        "System.Title": fields["System.Title"] ?? "(untitled)",
        "System.State": "New",
        "System.WorkItemType": type,
        ...(fields["System.Description"] !== undefined
          ? { "System.Description": fields["System.Description"] }
          : {}),
        ...Object.fromEntries(
          Object.entries(fields).filter(
            ([k]) => !["System.Title", "System.Description"].includes(k),
          ),
        ),
      },
      url: `https://dev.azure.example/forge/_apis/wit/workitems/${id}`,
    };
    state.workItems.push(wi);
    return sendJson(res, 201, wi);
  }

  // POST /_apis/wit/workitems/{id}/comments
  m = tail.match(/^\/_apis\/wit\/workitems\/(\d+)\/comments$/);
  if (m && method === "POST") {
    const id = 7000 + state.comments.length + 1;
    const comment = {
      id,
      text: body?.text ?? "",
      url: `https://dev.azure.example/forge/_apis/wit/workitems/${m[1]}/comments/${id}`,
      createdBy: { displayName: "fora-bot" },
      createdDate: new Date().toISOString(),
    };
    state.comments.push(comment);
    return sendJson(res, 201, comment);
  }

  return sendJson(res, 404, { message: `mock: no route for ${method} ${tail}` });
}
