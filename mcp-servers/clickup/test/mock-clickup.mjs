// test/mock-clickup.mjs
// Lightweight in-memory ClickUp REST v2 mock for the smoke test.
//
// Implements the minimum surface the FORA ClickUp MCP server touches:
//   GET  /api/v2/list/{listId}/task            (list_tasks)
//   GET  /api/v2/task/{taskId}                 (get_task, scope check)
//   GET  /api/v2/task/{taskId}/comment          (list_comments)
//   POST /api/v2/list/{listId}/task            (create_task)
//   PUT  /api/v2/task/{taskId}                 (update_task, set_task_status)
//   POST /api/v2/task/{taskId}/comment          (add_comment)
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the create / comment / update payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {Array<Record<string, unknown>>} tasks
 * @property {Record<string, Array<Record<string, unknown>>>} commentsByTask
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 * @property {string} pinnedListId
 */

/** @param {{ pinnedListId?: string }} [opts] @returns {MockState} */
export function initialState(opts = {}) {
  const pinnedListId = opts.pinnedListId ?? "9000";
  return {
    pinnedListId,
    tasks: [
      {
        id: "9001",
        name: "Wire up the MCP server",
        description: "Initial task in the pinned List.",
        status: { status: "to do", type: "open", orderindex: 0, color: "#d3d3d3" },
        priority: { id: "3", priority: "normal", color: "#d3d3d3" },
        assignee: { username: "smoke-bot", email: "smoke@example.com" },
        creator: { username: "smoke-bot", email: "smoke@example.com" },
        due_date: null,
        date_created: 1718645000000,
        date_updated: 1718645112000,
        list: { id: pinnedListId, name: "Smoke List" },
        tags: [{ name: "smoke" }],
        url: `https://app.clickup.com/t/9001`,
      },
      {
        id: "9002",
        name: "Land the day-one slice",
        description: "Day-one deliverable per FORA-202.",
        status: { status: "in progress", type: "custom", orderindex: 1, color: "#4196ff" },
        priority: { id: "2", priority: "high", color: "#f8ae00" },
        assignee: null,
        creator: { username: "smoke-bot", email: "smoke@example.com" },
        due_date: 1719000000000,
        date_created: 1718645112000,
        date_updated: 1718646000000,
        list: { id: pinnedListId, name: "Smoke List" },
        tags: [],
        url: `https://app.clickup.com/t/9002`,
      },
      // A task in a different List — used to verify the scope guard.
      {
        id: "9100",
        name: "Outside the pinned List",
        description: "Belongs to a different List; must be refused.",
        status: { status: "open", type: "open" },
        priority: null,
        assignee: null,
        creator: { username: "smoke-bot", email: "smoke@example.com" },
        due_date: null,
        date_created: 1718645000000,
        date_updated: 1718645000000,
        list: { id: "9999", name: "Other List" },
        tags: [],
        url: `https://app.clickup.com/t/9100`,
      },
    ],
    commentsByTask: {},
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
      state.callLog.push({ method: req.method ?? "?", path, body: null, query: u.search });

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
              err: "mock server error",
              message: err instanceof Error ? err.message : String(err),
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

function findTask(state, taskId) {
  return state.tasks.find((t) => t.id === String(taskId));
}

function handle(state, method, path, url, body, res) {
  // GET /api/v2/list/{listId}/task
  let m = path.match(/^\/api\/v2\/list\/([^/]+)\/task$/);
  if (m && method === "GET") {
    const listId = m[1];
    const page = Number(url.searchParams.get("page") ?? "0");
    const pageSize = Number(url.searchParams.get("page_size") ?? "50");
    const statusesRaw = url.searchParams.get("statuses[]");
    const wantedStatuses = statusesRaw ? statusesRaw.split(",").map((s) => s.trim().toLowerCase()) : null;
    let tasks = state.tasks.filter((t) => String(t.list?.id) === listId);
    if (wantedStatuses && wantedStatuses.length > 0) {
      tasks = tasks.filter((t) => wantedStatuses.includes((t.status?.status ?? "").toLowerCase()));
    }
    return sendJson(res, 200, { tasks });
  }

  // POST /api/v2/list/{listId}/task  (create_task)
  if (m && method === "POST") {
    const listId = m[1];
    const newId = String(10000 + state.tasks.length + 1);
    const newTask = {
      id: newId,
      name: body?.name ?? "(untitled)",
      description: body?.description ?? null,
      status: { status: body?.status ?? "to do", type: "open", orderindex: 0, color: "#d3d3d3" },
      priority: body?.priority != null
        ? { id: String(body.priority), priority: ["urgent","high","normal","low"][body.priority - 1] ?? "normal" }
        : null,
      assignee: null,
      creator: { username: "smoke-bot", email: "smoke@example.com" },
      due_date: body?.due_date ?? null,
      date_created: Date.now(),
      date_updated: Date.now(),
      list: { id: listId, name: "Smoke List" },
      tags: [],
      url: `https://app.clickup.com/t/${newId}`,
    };
    state.tasks.push(newTask);
    return sendJson(res, 200, newTask);
  }

  // GET /api/v2/task/{taskId}/comment
  m = path.match(/^\/api\/v2\/task\/([^/]+)\/comment$/);
  if (m && method === "GET") {
    const taskId = m[1];
    const comments = state.commentsByTask[taskId] ?? [];
    return sendJson(res, 200, { comments });
  }

  // POST /api/v2/task/{taskId}/comment  (add_comment)
  if (m && method === "POST") {
    const taskId = m[1];
    const id = String(50000 + Object.values(state.commentsByTask).reduce((n, c) => n + c.length, 0) + 1);
    const comment = {
      id,
      date: Date.now(),
      user: { username: "smoke-bot", email: "smoke@example.com" },
      comment_text: body?.comment_text ?? "",
    };
    state.commentsByTask[taskId] = state.commentsByTask[taskId] ?? [];
    state.commentsByTask[taskId].push(comment);
    return sendJson(res, 200, comment);
  }

  // PUT /api/v2/task/{taskId}  (update_task, set_task_status)
  m = path.match(/^\/api\/v2\/task\/([^/]+)$/);
  if (m && method === "PUT") {
    const taskId = m[1];
    const task = findTask(state, taskId);
    if (!task) return sendJson(res, 404, { err: "Task not found", id: taskId });
    if (body?.name !== undefined) task.name = body.name;
    if (body?.description !== undefined) task.description = body.description;
    if (body?.priority !== undefined) {
      task.priority = {
        id: String(body.priority),
        priority: ["urgent","high","normal","low"][body.priority - 1] ?? "normal",
      };
    }
    if (body?.due_date !== undefined) task.due_date = body.due_date;
    if (body?.status !== undefined) {
      task.status = {
        status: body.status,
        type: task.status?.type ?? "custom",
        orderindex: task.status?.orderindex ?? 0,
        color: task.status?.color ?? "#d3d3d3",
      };
    }
    task.date_updated = Date.now();
    return sendJson(res, 200, task);
  }

  // GET /api/v2/task/{taskId}  (get_task, scope check)
  if (m && method === "GET") {
    const taskId = m[1];
    const task = findTask(state, taskId);
    if (!task) return sendJson(res, 404, { err: "Task not found", id: taskId });
    return sendJson(res, 200, task);
  }

  return sendJson(res, 404, { err: `mock: no route for ${method} ${path}` });
}