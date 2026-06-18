// test/mock-figma.mjs
// Lightweight in-memory Figma REST v1 mock for the smoke test.
//
// Implements the minimum surface the FORA Figma MCP server touches:
//   GET  /v1/files/{key}
//   GET  /v1/files/{key}/nodes?ids=…&depth=…
//   GET  /v1/images/{key}?ids=…&format=…&scale=…
//   GET  /v1/files/{key}/comments?as_md=…&after=…
//   POST /v1/files/{key}/comments
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the comment / image payloads round-trip.
//
// Contract drift: the Figma REST v1 comments endpoint does not paginate by
// default — it returns all comments for a file in a single response. The
// mock implements an `after` cursor so the smoke test can verify the
// server's cursor handling. In production, the server will see no `cursor`
// in the response and `next` will be undefined on every call.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {string} fileKey           The pinned file key the mock is serving.
 * @property {string} teamId            The team id the mock is asserting.
 * @property {Object} fileDocument      GET /v1/files/{key} payload
 * @property {Object} nodesById        Per-id node wrappers for /nodes
 * @property {Array<Object>} comments   In-memory comment list
 * @property {number} commentSeq        Monotonic id source
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 */

/** @returns {MockState} */
export function initialState({
  fileKey = "ACME_FILE_KEY_1",
  teamId = "TEAM_ACME",
} = {}) {
  const baseNode = {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          {
            id: "1:2",
            name: "Hero Frame",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
            children: [
              {
                id: "1:3",
                name: "Hero Title",
                type: "TEXT",
                characters: "Welcome to ACME",
              },
            ],
          },
          {
            id: "2:1",
            name: "Footer",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 920, width: 1440, height: 120 },
          },
        ],
      },
    ],
  };

  return {
    fileKey,
    teamId,
    fileDocument: {
      name: "ACME Marketing Site",
      role: "owner",
      lastModified: "2026-06-15T12:00:00Z",
      editorType: "figma",
      thumbnailUrl: "https://figma.example/thumb/acme.png",
      version: "1234567890:1",
      document: baseNode,
      components: {
        "comp:hero": { key: "comp:hero", name: "Hero", description: "Hero section" },
      },
      styles: {
        "S:brand-color": { key: "S:brand-color", name: "Brand/Primary", styleType: "FILL" },
      },
    },
    nodesById: {
      "1:2": {
        document: {
          id: "1:2",
          name: "Hero Frame",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
        },
        components: {
          "comp:hero": { key: "comp:hero", name: "Hero", description: "Hero section" },
        },
        styles: {
          "S:brand-color": { key: "S:brand-color", name: "Brand/Primary", styleType: "FILL" },
        },
      },
      "1:3": {
        document: {
          id: "1:3",
          name: "Hero Title",
          type: "TEXT",
          characters: "Welcome to ACME",
        },
        components: {},
        styles: {},
      },
      "2:1": {
        document: {
          id: "2:1",
          name: "Footer",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 920, width: 1440, height: 120 },
        },
        components: {},
        styles: {},
      },
    },
    comments: [],
    commentSeq: 0,
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

function handle(state, method, path, url, body, res) {
  const encodedKey = encodeURIComponent(state.fileKey);

  // GET /v1/files/{key}
  let m = path.match(new RegExp(`^/v1/files/([^/]+)$`));
  if (m && method === "GET") {
    if (m[1] !== state.fileKey) {
      return sendJson(res, 404, { message: `File not found: ${m[1]}` });
    }
    return sendJson(res, 200, state.fileDocument);
  }

  // GET /v1/files/{key}/nodes?ids=…&depth=…
  m = path.match(new RegExp(`^/v1/files/([^/]+)/nodes$`));
  if (m && method === "GET") {
    if (m[1] !== state.fileKey) {
      return sendJson(res, 404, { message: `File not found: ${m[1]}` });
    }
    const idsParam = url.searchParams.get("ids") ?? "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return sendJson(res, 400, { message: "ids is required" });
    }
    const nodes = {};
    const missing = [];
    for (const id of ids) {
      const wrapper = state.nodesById[id];
      if (wrapper) nodes[id] = wrapper;
      else missing.push(id);
    }
    if (missing.length > 0) {
      return sendJson(res, 400, {
        message: `Nodes not found in file ${state.fileKey}: ${missing.join(", ")}`,
      });
    }
    return sendJson(res, 200, {
      name: state.fileDocument.name,
      lastModified: state.fileDocument.lastModified,
      thumbnailUrl: state.fileDocument.thumbnailUrl,
      nodes,
    });
  }

  // GET /v1/images/{key}?ids=…&format=…&scale=…
  m = path.match(new RegExp(`^/v1/images/([^/]+)$`));
  if (m && method === "GET") {
    if (m[1] !== state.fileKey) {
      return sendJson(res, 404, { message: `File not found: ${m[1]}` });
    }
    const idsParam = url.searchParams.get("ids") ?? "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return sendJson(res, 400, { message: "ids is required" });
    }
    const format = url.searchParams.get("format") ?? "png";
    const images = {};
    for (const id of ids) {
      images[id] = `https://figma.example/render/${id}.${format}`;
    }
    return sendJson(res, 200, { err: null, images });
  }

  // GET /v1/files/{key}/comments?as_md=…&after=…
  m = path.match(new RegExp(`^/v1/files/([^/]+)/comments$`));
  if (m && method === "GET") {
    if (m[1] !== state.fileKey) {
      return sendJson(res, 404, { message: `File not found: ${m[1]}` });
    }
    const after = url.searchParams.get("after");
    let page = state.comments;
    if (after) {
      const idx = state.comments.findIndex((c) => c.id === after);
      if (idx < 0) {
        return sendJson(res, 400, { message: `Invalid after cursor: ${after}` });
      }
      page = state.comments.slice(idx + 1);
    }
    // Page in chunks of 2 to make pagination testable. cursor is set when
    // more remain. Real Figma does not paginate; the mock does so the
    // smoke can verify the `after` cursor handling on the server side.
    const PAGE_SIZE = 2;
    const slice = page.slice(0, PAGE_SIZE);
    const hasMore = page.length > PAGE_SIZE;
    const payload = { comments: slice };
    if (hasMore) {
      payload.cursor = slice[slice.length - 1].id;
    }
    return sendJson(res, 200, payload);
  }

  // POST /v1/files/{key}/comments
  m = path.match(new RegExp(`^/v1/files/([^/]+)/comments$`));
  if (m && method === "POST") {
    if (m[1] !== state.fileKey) {
      return sendJson(res, 404, { message: `File not found: ${m[1]}` });
    }
    if (!body || typeof body.message !== "string" || body.message.trim() === "") {
      return sendJson(res, 400, { message: "message is required" });
    }
    state.commentSeq += 1;
    const comment = {
      id: `cmt_${state.commentSeq}`,
      message: body.message,
      client_meta: body.client_meta ?? null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      order_id: `0:${state.commentSeq}`,
      parent_id: null,
      user: { id: "u_fora_bot", handle: "FORA Bot", img_url: null },
    };
    state.comments.push(comment);
    return sendJson(res, 201, comment);
  }

  return sendJson(res, 404, { message: `mock: no route for ${method} ${path}` });
}
