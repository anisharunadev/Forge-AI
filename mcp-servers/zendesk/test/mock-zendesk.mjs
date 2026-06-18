// test/mock-zendesk.mjs
// Lightweight in-memory Zendesk REST v2 mock for the smoke test.
//
// Implements the minimum surface the FORA Zendesk MCP server touches:
//   GET    /api/v2/tickets.json
//   GET    /api/v2/tickets/{id}.json?include=comments
//   GET    /api/v2/search.json
//   POST   /api/v2/tickets.json
//   PUT    /api/v2/tickets/{id}.json
//   GET    /api/v2/macros.json
//   POST   /api/v2/tickets/{id}/macros/{macroId}.json
//
// The mock records every call (method, path, body, auth) so the smoke test
// can assert the MCP server issued the right requests and that mutation
// payloads round-trip. The auth header is checked against the expected
// email + token shape; an absent or malformed header is recorded as
// `authPresent: false` so the smoke can fail loudly.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} tickets
 * @property {Array<Record<string, unknown>>} macros
 * @property {string} expectedSubdomain
 * @property {string} expectedEmail
 * @property {string} expectedToken
 * @property {Array<{ method: string, path: string, body: unknown, authPresent: boolean }>} callLog
 */

/** @returns {MockState} */
export function initialState({
  subdomain = "acme",
  email = "agent@acme.example",
  apiToken = "zd_smoketest_fake_token",
} = {}) {
  return {
    expectedSubdomain: subdomain,
    expectedEmail: email,
    expectedToken: apiToken,
    tickets: [
      {
        id: 1,
        subject: "Welcome to your Zendesk",
        status: "open",
        priority: "normal",
        requester_id: 100,
        assignee_id: 200,
        tags: ["welcome", "onboarding"],
        created_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-10T11:00:00Z",
        description: "Welcome to your new Zendesk account. Reach out anytime.",
        comments: [
          {
            id: 11,
            type: "Comment",
            body: "Welcome to your new Zendesk account. Reach out anytime.",
            public: true,
            author_id: 200,
            created_at: "2026-06-01T10:00:00Z",
          },
        ],
        url: "https://acme.zendesk.example/api/v2/tickets/1.json",
      },
      {
        id: 2,
        subject: "MCP smoke ticket",
        status: "new",
        priority: "high",
        requester_id: 101,
        assignee_id: null,
        tags: ["smoke", "mcp"],
        created_at: "2026-06-15T10:00:00Z",
        updated_at: "2026-06-15T10:00:00Z",
        description: "Used by the FORA MCP smoke test.",
        comments: [],
        url: "https://acme.zendesk.example/api/v2/tickets/2.json",
      },
    ],
    macros: [
      {
        id: 50,
        title: "Set priority to high and add smoke tag",
        description: "FORA MCP smoke macro.",
        active: true,
        url: "https://acme.zendesk.example/api/v2/macros/50.json",
        actions: [
          { field: "priority", value: "high" },
          { field: "current_tags", value: ["smoke", "macro-applied"] },
        ],
      },
      {
        id: 51,
        title: "Mark as solved",
        description: "FORA MCP smoke macro #2.",
        active: true,
        url: "https://acme.zendesk.example/api/v2/macros/51.json",
        actions: [{ field: "status", value: "solved" }],
      },
    ],
    callLog: [],
  };
}

/**
 * Compute the expected Basic auth header value for the mock's pinned
 * credentials: `Basic base64("{email}/token:{apiToken}")`. Exposed so the
 * smoke test can build the same header for its `Authorization` assertions.
 */
export function expectedAuthHeader({ email, apiToken }) {
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`;
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
      const authPresent = expectedAuthHeader({ email: state.expectedEmail, apiToken: state.expectedToken }) === auth;
      state.callLog.push({ method: req.method ?? "?", path, body: null, authPresent });

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

function handle(state, method, path, url, body, res) {
  // GET /api/v2/tickets.json?page=&per_page=
  if (path === "/api/v2/tickets.json" && method === "GET") {
    return sendJson(res, 200, { tickets: state.tickets, count: state.tickets.length });
  }

  // GET /api/v2/tickets/{id}.json?include=comments
  let m = path.match(/^\/api\/v2\/tickets\/(\d+)\.json$/);
  if (m && method === "GET") {
    const id = Number(m[1]);
    const t = state.tickets.find((t) => t.id === id);
    if (!t) return sendJson(res, 404, { error: "notFound", description: `Ticket ${id} not found` });
    return sendJson(res, 200, { ticket: t });
  }

  // GET /api/v2/search.json?query=&page=&per_page=
  if (path === "/api/v2/search.json" && method === "GET") {
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    const results = state.tickets.filter(
      (t) =>
        !q ||
        String(t.subject).toLowerCase().includes(q) ||
        String(t.description).toLowerCase().includes(q) ||
        (Array.isArray(t.tags) && t.tags.some((tag) => tag.toLowerCase().includes(q))),
    );
    return sendJson(res, 200, {
      count: results.length,
      next_page: null,
      previous_page: null,
      results,
    });
  }

  // POST /api/v2/tickets.json
  if (path === "/api/v2/tickets.json" && method === "POST") {
    const input = body?.ticket ?? {};
    const id = 1000 + state.tickets.length + 1;
    const t = {
      id,
      subject: String(input.subject ?? "(untitled)"),
      status: input.status ?? "new",
      priority: input.priority ?? null,
      requester_id: input.requester?.id ?? 100,
      assignee_id: input.assignee_id ?? null,
      tags: input.tags ?? [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      description: input.comment?.body ?? "",
      comments: input.comment
        ? [
            {
              id: id * 10,
              type: "Comment",
              body: input.comment.body,
              public: input.comment.public !== false,
              author_id: input.comment.author_id ?? 0,
              created_at: new Date().toISOString(),
            },
          ]
        : [],
      external_id: input.external_id ?? null,
      url: `https://${state.expectedSubdomain}.zendesk.example/api/v2/tickets/${id}.json`,
    };
    state.tickets.push(t);
    return sendJson(res, 201, { ticket: t });
  }

  // PUT /api/v2/tickets/{id}.json  (used for update_ticket + add_comment)
  m = path.match(/^\/api\/v2\/tickets\/(\d+)\.json$/);
  if (m && method === "PUT") {
    const id = Number(m[1]);
    const t = state.tickets.find((t) => t.id === id);
    if (!t) return sendJson(res, 404, { error: "notFound", description: `Ticket ${id} not found` });
    const input = body?.ticket ?? {};
    if (input.subject !== undefined) t.subject = input.subject;
    if (input.priority !== undefined) t.priority = input.priority;
    if (input.status !== undefined) t.status = input.status;
    if (input.tags !== undefined) t.tags = input.tags;
    if (Array.isArray(input.add_tags)) {
      t.tags = Array.from(new Set([...(t.tags ?? []), ...input.add_tags]));
    }
    if (Array.isArray(input.remove_tags)) {
      t.tags = (t.tags ?? []).filter((tag) => !input.remove_tags.includes(tag));
    }
    if (input.comment && input.comment.body) {
      const cid = (t.comments?.length ?? 0) + 1 + id * 100;
      const newComment = {
        id: cid,
        type: "Comment",
        body: input.comment.body,
        public: input.comment.public !== false,
        author_id: input.comment.author_id ?? 0,
        created_at: new Date().toISOString(),
      };
      t.comments = [...(t.comments ?? []), newComment];
    }
    if (input.external_id !== undefined) t.external_id = input.external_id;
    t.updated_at = new Date().toISOString();
    return sendJson(res, 200, { ticket: t });
  }

  // GET /api/v2/macros.json
  if (path === "/api/v2/macros.json" && method === "GET") {
    return sendJson(res, 200, { macros: state.macros, count: state.macros.length });
  }

  // POST /api/v2/tickets/{id}/macros/{macroId}.json
  m = path.match(/^\/api\/v2\/tickets\/(\d+)\/macros\/(\d+)\.json$/);
  if (m && method === "POST") {
    const id = Number(m[1]);
    const macroId = Number(m[2]);
    const t = state.tickets.find((t) => t.id === id);
    if (!t) return sendJson(res, 404, { error: "notFound", description: `Ticket ${id} not found` });
    const macro = state.macros.find((m) => m.id === macroId);
    if (!macro) return sendJson(res, 404, { error: "notFound", description: `Macro ${macroId} not found` });
    for (const action of macro.actions ?? []) {
      if (action.field === "priority") t.priority = action.value;
      if (action.field === "status") t.status = action.value;
      if (action.field === "current_tags" && Array.isArray(action.value)) t.tags = action.value;
    }
    t.updated_at = new Date().toISOString();
    return sendJson(res, 200, { result: { ticket: t } });
  }

  return sendJson(res, 404, { error: "notFound", description: `mock: no route for ${method} ${path}` });
}
