// test/mock-confluence.mjs
// Lightweight in-memory Confluence Cloud (v2) REST mock for the smoke test
// — READ-ONLY (FORA-290).
//
// Implements the minimum surface the FORA Confluence MCP server touches:
//   GET  /api/v2/spaces?keys={key}                        (resolve space key → id)
//   GET  /api/v2/spaces/{id}/pages                        (list pages)
//   GET  /api/v2/pages/{id}?body-format=storage          (get one page)
//   GET  /api/content/search?cql=...&limit=...            (CQL search)
//
// Mutation routes (POST /api/v2/pages, PATCH /api/v2/pages/{id},
// POST /api/v2/footer-comments) are NOT implemented. The mock 405s
// any non-GET method, so the smoke test asserts the server never
// tries to mutate.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {string} pinnedSpaceId
 * @property {Array<Record<string, unknown>>} pages
 * @property {Array<Record<string, unknown>>} comments
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 */

/** @returns {MockState} */
export function initialState(pinnedSpaceId = "9001") {
  return {
    pinnedSpaceId,
    pages: [
      {
        id: "10001",
        title: "SDLC architecture overview",
        spaceId: pinnedSpaceId,
        parentId: null,
        status: "current",
        version: { number: 4, createdAt: "2026-06-10T10:00:00Z" },
        body: {
          representation: "storage",
          value:
            "<h1>SDLC architecture overview</h1><p>This page describes the FORA agent-of-agents platform.</p>",
        },
        _links: { webui: `/wiki/spaces/ENG/pages/10001` },
      },
      {
        id: "10002",
        title: "Runbook: spinning up a new MCP server",
        spaceId: pinnedSpaceId,
        parentId: "10001",
        status: "current",
        version: { number: 1, createdAt: "2026-06-12T10:00:00Z" },
        body: {
          representation: "storage",
          value: "<h1>Runbook</h1><ol><li>Copy the template</li><li>Ship a smoke test</li></ol>",
        },
        _links: { webui: `/wiki/spaces/ENG/pages/10002` },
      },
      {
        id: "10003",
        title: "Threat model: tenant isolation",
        spaceId: pinnedSpaceId,
        parentId: null,
        status: "current",
        version: { number: 2, createdAt: "2026-06-13T10:00:00Z" },
        body: {
          representation: "storage",
          value:
            "<h1>Threat model: tenant isolation</h1><p>Cross-tenant deny-by-default per ADR-0003 §5.</p>",
        },
        _links: { webui: `/wiki/spaces/ENG/pages/10003` },
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
      // Routing is on pathname; the smoke test inspects `url` (with the
      // query string) for CQL / filter assertions.
      const path = u.pathname;
      const entry = { method: req.method ?? "?", path, url: req.url ?? "/", body: null };
      state.callLog.push(entry);

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? safeJson(raw) : null;
        if (body !== null) entry.body = body;

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
  // READ-ONLY (FORA-290): the mock is a typed front-end. It only
  // honours GET requests; anything else is 405'd so the smoke test
  // can assert the server never tried to mutate.
  if (method !== "GET") {
    return sendJson(res, 405, {
      message: `mock: read-only — ${method} ${path} refused`,
    });
  }

  // GET /api/v2/spaces?keys={key}
  let m = path.match(/^\/api\/v2\/spaces$/);
  if (m) {
    const keys = url.searchParams.getAll("keys");
    const results = keys.length === 0 || keys.includes("ENG")
      ? [
          {
            id: state.pinnedSpaceId,
            key: "ENG",
            name: "Engineering",
            type: "global",
            status: "current",
          },
        ]
      : [];
    return sendJson(res, 200, { results });
  }

  // GET /api/v2/spaces/{id}/pages
  m = path.match(/^\/api\/v2\/spaces\/([^/]+)\/pages$/);
  if (m) {
    if (m[1] !== state.pinnedSpaceId) {
      return sendJson(res, 403, { message: "mock: not the pinned space" });
    }
    return sendJson(res, 200, {
      results: state.pages.map(stripBodyForList),
    });
  }

  // GET /api/v2/pages/{id}
  m = path.match(/^\/api\/v2\/pages\/([^/]+)$/);
  if (m) {
    const page = state.pages.find((p) => p.id === m[1]);
    if (!page) return sendJson(res, 404, { message: "Not Found" });
    return sendJson(res, 200, page);
  }

  // GET /api/content/search?cql=...
  if (path === "/api/content/search") {
    const cql = (url.searchParams.get("cql") ?? "").toLowerCase();
    // Defensive: the cql must include a space = X guard. The server
    // should always inject this. If the caller didn't, the mock
    // returns 403 to mirror the real server's behavior.
    if (!/\(\s*space\s*=\s*\d+\s*\)/.test(cql) && !/\bspace\s*=\s*\d+/i.test(cql)) {
      return sendJson(res, 403, { message: "mock: cql missing space scope" });
    }
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const textMatch = cql.match(/text\s*~\s*"([^"]+)"/);
    const query = textMatch ? textMatch[1].toLowerCase() : "";
    const hits = state.pages
      .filter((p) => p.spaceId === state.pinnedSpaceId)
      .filter((p) => {
        if (!query) return true;
        const bodyText = String(p.body?.value ?? "").toLowerCase();
        const titleText = String(p.title).toLowerCase();
        return bodyText.includes(query) || titleText.includes(query);
      })
      .slice(0, limit)
      .map((p) => ({
        content: {
          id: p.id,
          title: p.title,
          type: "page",
          space: { id: p.spaceId, key: "ENG", name: "Engineering" },
          _links: { webui: p._links?.webui },
        },
        title: p.title,
        excerpt: `…${query}…`,
        url: p._links?.webui,
        resultParentContainer: { name: "Engineering", id: p.spaceId },
      }));
    return sendJson(res, 200, {
      results: hits,
      start: 0,
      limit,
      size: hits.length,
    });
  }

  return sendJson(res, 404, { message: `mock: no route for ${method} ${path}` });
}

function stripBodyForList(p) {
  // List endpoint returns a slim shape (no body). The mock matches that.
  const { body: _body, ...rest } = p;
  return rest;
}
