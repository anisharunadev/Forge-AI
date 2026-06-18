// test/mock-atlassian.mjs
// Lightweight in-memory Atlassian Jira Cloud REST v3 mock for the smoke test.
//
// Implements the minimum surface the FORA Jira MCP server touches:
//   POST /rest/api/3/search/jql          (list_issues, search_jql)
//   GET  /rest/api/3/issue/{key}         (get_issue, scope check)
//   GET  /rest/api/3/issue/{key}/transitions
//   POST /rest/api/3/issue               (create_issue)
//   POST /rest/api/3/issue/{key}/comment (add_comment)
//   POST /rest/api/3/issue/{key}/transitions (transition_issue)
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the create / comment / transition payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} issues
 * @property {Array<Record<string, unknown>>} comments
 * @property {Array<{ id: string, name: string, to: { name: string } }>} transitions
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 * @property {string} pinnedProject
 */

/** @param {{ pinnedProject?: string }} [opts] @returns {MockState} */
export function initialState(opts = {}) {
  return {
    pinnedProject: opts.pinnedProject ?? "FORA",
    issues: [
      {
        id: "20001",
        key: "FORA-1",
        fields: {
          project: { key: "FORA" },
          summary: "Build the thing",
          status: { name: "Open", statusCategory: { key: "new" } },
          issuetype: { name: "Task" },
          priority: { name: "Medium" },
          updated: "2026-06-16T10:00:00.000+0000",
          created: "2026-06-15T10:00:00.000+0000",
          description: {
            type: "doc",
            version: 1,
            content: [{ type: "paragraph", content: [{ type: "text", text: "Original description." }] }],
          },
          labels: ["smoke"],
          reporter: { displayName: "Smoke Tester" },
          assignee: null,
        },
      },
      {
        id: "20002",
        key: "FORA-2",
        fields: {
          project: { key: "FORA" },
          summary: "Ship the thing",
          status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
          issuetype: { name: "Task" },
          priority: { name: "High" },
          updated: "2026-06-16T11:00:00.000+0000",
          created: "2026-06-15T11:00:00.000+0000",
          description: null,
          labels: [],
          reporter: { displayName: "Smoke Tester" },
          assignee: { displayName: "Smoke Tester" },
        },
      },
    ],
    comments: [],
    transitions: [
      { id: "11", name: "To Do",       to: { name: "To Do" } },
      { id: "21", name: "In Progress", to: { name: "In Progress" } },
      { id: "31", name: "Done",        to: { name: "Done" } },
    ],
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

function findIssue(state, key) {
  return state.issues.find((i) => i.key === key);
}

function handle(state, method, path, url, body, res) {
  // POST /rest/api/3/search/jql
  let m = path.match(/^\/rest\/api\/3\/search\/jql$/);
  if (m && method === "POST") {
    const jql = (body?.jql ?? "").toString();
    const maxResults = Number(body?.maxResults ?? 50);
    const startAt = Number(body?.startAt ?? 0);
    // Naive JQL filter — match the pinned project's issues, plus a
    // best-effort status filter. The smoke test only sends simple JQL.
    const statusMatch = jql.match(/status\s*=\s*"([^"]+)"/i);
    const list = state.issues.filter((i) => {
      const p = i.fields?.project?.key;
      if (p !== state.pinnedProject) return false;
      if (statusMatch && i.fields?.status?.name !== statusMatch[1]) return false;
      return true;
    });
    return sendJson(res, 200, {
      total: list.length,
      startAt,
      maxResults,
      issues: list,
    });
  }

  // GET /rest/api/3/issue/{key}/transitions
  m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/);
  if (m && method === "GET") {
    return sendJson(res, 200, { transitions: state.transitions });
  }

  // POST /rest/api/3/issue/{key}/transitions
  if (m && method === "POST") {
    const trans = body?.transition?.id;
    const match = state.transitions.find((t) => t.id === trans);
    const issue = findIssue(state, m[1]);
    if (match && issue) {
      issue.fields = issue.fields ?? {};
      issue.fields.status = { name: match.to.name, statusCategory: { key: "done" } };
    }
    return sendJson(res, 204, undefined);
  }

  // POST /rest/api/3/issue/{key}/comment
  m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
  if (m && method === "POST") {
    const id = "5000" + (state.comments.length + 1);
    const comment = {
      id,
      self: `https://example/rest/api/3/comment/${id}`,
      created: new Date().toISOString(),
    };
    state.comments.push(comment);
    return sendJson(res, 201, comment);
  }

  // GET /rest/api/3/issue/{key}
  m = path.match(/^\/rest\/api\/3\/issue\/([^/]+)$/);
  if (m && method === "GET") {
    const issue = findIssue(state, m[1]);
    if (!issue) return sendJson(res, 404, { errorMessages: ["Issue not found"] });
    return sendJson(res, 200, issue);
  }

  // POST /rest/api/3/issue  (create_issue)
  if (path === "/rest/api/3/issue" && method === "POST") {
    const number = 100 + state.issues.length + 1;
    const key = `${state.pinnedProject}-${number}`;
    const newIssue = {
      id: String(30000 + number),
      key,
      self: `https://example/rest/api/3/issue/${30000 + number}`,
      fields: {
        project: { key: state.pinnedProject },
        summary: body?.fields?.summary ?? "(untitled)",
        status: { name: "Open", statusCategory: { key: "new" } },
        issuetype: body?.fields?.issuetype ?? { name: "Task" },
        priority: body?.fields?.priority ?? null,
        updated: new Date().toISOString(),
        created: new Date().toISOString(),
        description: body?.fields?.description ?? null,
        labels: body?.fields?.labels ?? [],
        reporter: { displayName: "smoke-bot" },
        assignee: null,
      },
    };
    state.issues.push(newIssue);
    return sendJson(res, 201, {
      id: newIssue.id,
      key: newIssue.key,
      self: newIssue.self,
    });
  }

  return sendJson(res, 404, { errorMessages: [`mock: no route for ${method} ${path}`] });
}
