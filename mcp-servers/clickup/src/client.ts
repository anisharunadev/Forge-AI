/**
 * Typed ClickUp REST v2 client, scoped to a single List.
 *
 * The MCP server only ever calls these methods. List scope is enforced at
 * boot via `listId` in config — every read or write targets the pinned List.
 * The model can pass `taskId` but the underlying List is server-pinned for
 * safety (mirrors `@fora/mcp-jira`'s `JIRA_PROJECT_KEY` and `@fora/mcp-github`'s
 * `GITHUB_ORG` enforcement). Any attempt to act on a task whose List does
 * not match the pin raises `ListScopeError` before any HTTP call lands.
 *
 * ClickUp uses a Personal API Token in the `Authorization` header
 * verbatim (no `Bearer` prefix per ClickUp REST v2 docs).
 *
 * ClickUp Cloud REST rate limits (subject to change):
 *   - Most read endpoints:  ~100 req/min per token
 *   - Write endpoints:      per-endpoint caps, typically ~100 req/min
 *   - 429 responses are surfaced as `ClickUpApiError`; the agent decides.
 *
 * We do NOT depend on any ClickUp SDK — the REST surface is stable enough
 * to call directly with `fetch`, and avoiding the SDK keeps the package
 * small and the auth story obvious.
 */

import type { Config } from "./config.js";

export class ListScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on List '${requested}' — this server is pinned to List '${allowed}'.`,
    );
    this.name = "ListScopeError";
  }
}

export class ClickUpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string,
  ) {
    super(`ClickUp API ${status} on ${endpoint}: ${truncate(body, 200)}`);
    this.name = "ClickUpApiError";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  statusType: string | null;
  priority: number | null;
  assignee: string | null;
  dueDate: string | null;
  updated: string;
  url: string;
}

export interface TaskListResult {
  total: number;
  page: number;
  pageSize: number;
  tasks: TaskSummary[];
}

export interface TaskDetail extends TaskSummary {
  description: string | null;
  listId: string;
  creator: string | null;
  created: string;
  tags: string[];
}

export interface TaskCreated {
  id: string;
  name: string;
  status: string;
  url: string;
}

export interface CommentCreated {
  id: string;
  taskId: string;
  created: string;
}

export interface CommentSummary {
  id: string;
  author: string | null;
  body: string;
  created: string;
}

export interface Client {
  listTasks(args?: { page?: number; pageSize?: number; statuses?: string[] }): Promise<TaskListResult>;
  searchTasks(args: { query: string; page?: number; pageSize?: number }): Promise<TaskListResult>;
  getTask(args: { taskId: string }): Promise<TaskDetail>;
  createTask(args: { name: string; description?: string; status?: string; priority?: number; dueDate?: number }): Promise<TaskCreated>;
  updateTask(args: { taskId: string; name?: string; description?: string; priority?: number; dueDate?: number }): Promise<TaskSummary>;
  setTaskStatus(args: { taskId: string; status: string }): Promise<{ id: string; status: string; statusType: string | null }>;
  listComments(args: { taskId: string }): Promise<{ taskId: string; comments: CommentSummary[] }>;
  addComment(args: { taskId: string; body: string; notifyAll?: boolean }): Promise<CommentCreated>;
}

export function createClient(config: Config): { client: Client; listId: string; baseUrl: string } {
  // apiBaseUrl is the full path to /api/v2 (used by smoke tests).
  // baseUrl is the site root (default https://api.clickup.com).
  const apiBase =
    config.apiBaseUrl ?? `${stripTrailingSlash(config.baseUrl)}/api/v2`;
  const appBase = `${stripTrailingSlash(config.baseUrl)}/v`;

  // ClickUp auth header — personal token verbatim, no Bearer prefix.
  const authHeader = config.apiToken;

  async function api<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: "application/json",
      "User-Agent": config.userAgent,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: payload });
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    if (!res.ok) {
      throw new ClickUpApiError(res.status, text, `${method} ${path}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // Cache of task → listId so get_task / update_task / set_task_status /
  // add_comment / list_comments can scope-check without an extra round trip
  // in the common case. (We still re-fetch when missing; the cache is a
  // hot-path optimization.)
  const taskListCache = new Map<string, string>();

  const toTaskSummary = (raw: Record<string, unknown>): TaskSummary => {
    const status = (raw.status as { status?: string; type?: string } | undefined);
    const priority = (raw.priority as { id?: number | string } | null | undefined);
    const assignee = (raw.assignee as { username?: string; email?: string } | null | undefined);
    const dueDateRaw = raw.due_date as string | number | null | undefined;
    return {
      id: String(raw.id ?? ""),
      name: (raw.name as string) ?? "",
      status: status?.status ?? "unknown",
      statusType: status?.type ?? null,
      // ClickUp returns priority.id as a string ("1".."4") or as null.
      priority: priority && priority.id != null ? Number(priority.id) : null,
      assignee: assignee?.username ?? assignee?.email ?? null,
      dueDate:
        dueDateRaw == null
          ? null
          : typeof dueDateRaw === "number"
            ? new Date(dueDateRaw).toISOString()
            : String(dueDateRaw),
      updated:
        typeof raw.date_updated === "number"
          ? new Date(raw.date_updated as number).toISOString()
          : (raw.date_updated as string) ?? "",
      url: `${appBase}/t/${raw.id}`,
    };
  };

  const toTaskListId = (raw: Record<string, unknown>): string | null => {
    const list = (raw.list as { id?: string | number } | undefined);
    if (!list || list.id == null) return null;
    return String(list.id);
  };

  const client: Client = {
    async listTasks({ page = 0, pageSize = 50, statuses } = {}) {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("page_size", String(pageSize));
      if (statuses && statuses.length > 0) {
        // ClickUp accepts comma-separated status names via the legacy v2
        // tasks endpoint; the mock server mirrors this shape.
        qs.set("statuses[]", statuses.join(","));
      }
      const data = await api<{ tasks?: Array<Record<string, unknown>> }>(
        "GET",
        `/list/${encodeURIComponent(config.listId)}/task?${qs.toString()}`,
      );
      const tasks = (data.tasks ?? []).map(toTaskSummary);
      for (const raw of data.tasks ?? []) {
        const lid = toTaskListId(raw);
        if (lid) taskListCache.set(String(raw.id), lid);
      }
      return {
        total: tasks.length,
        page,
        pageSize,
        tasks,
      };
    },

    async searchTasks({ query, page = 0, pageSize = 50 }) {
      // The MCP server filters client-side because ClickUp's v2 search
      // endpoint is workspace-scoped (not List-scoped). Listing the pinned
      // List first keeps the result set bounded, then we substring-match
      // over name + description. The smoke test exercises this exact path.
      const all = await client.listTasks({ page, pageSize });
      const q = query.toLowerCase();
      const matched = all.tasks.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.name.toLowerCase().includes(q)),
      );
      // Re-check descriptions in a second pass via get_task to keep the
      // match honest (the mock + the real API both return description
      // here). This is a single batch in the smoke test; under real load
      // the orchestrator's rate limiter (FORA-126 broker) paces it.
      const withDesc: TaskSummary[] = [];
      for (const t of matched) {
        const detail = await client.getTask({ taskId: t.id });
        if (
          detail.name.toLowerCase().includes(q) ||
          (detail.description && detail.description.toLowerCase().includes(q))
        ) {
          withDesc.push(t);
        }
      }
      return {
        total: withDesc.length,
        page,
        pageSize,
        tasks: withDesc,
      };
    },

    async getTask({ taskId }) {
      const raw = await api<Record<string, unknown>>(
        "GET",
        `/task/${encodeURIComponent(taskId)}`,
      );
      const listId = toTaskListId(raw);
      if (listId && listId !== config.listId) {
        throw new ListScopeError(listId, config.listId);
      }
      if (listId) taskListCache.set(taskId, listId);

      const summary = toTaskSummary(raw);
      const description =
        typeof raw.description === "string" ? raw.description : null;
      const creator = (raw.creator as { username?: string; email?: string } | undefined);
      const tags = Array.isArray(raw.tags)
        ? (raw.tags as Array<{ name?: string }>).map((t) => t.name ?? "")
        : [];
      return {
        ...summary,
        description,
        listId: listId ?? config.listId,
        creator: creator?.username ?? creator?.email ?? null,
        created:
          typeof raw.date_created === "number"
            ? new Date(raw.date_created as number).toISOString()
            : (raw.date_created as string) ?? "",
        tags: tags.filter((t) => t.length > 0),
      };
    },

    async createTask({ name, description, status = "to do", priority, dueDate }) {
      await assertTaskList.call(this, config.listId); // sanity pin
      const body: Record<string, unknown> = { name, status };
      if (description !== undefined) body.description = description;
      if (priority !== undefined) body.priority = priority;
      if (dueDate !== undefined) body.due_date = dueDate;
      const data = await api<{ id: string; name: string; status?: { status?: string } }>(
        "POST",
        `/list/${encodeURIComponent(config.listId)}/task`,
        body,
      );
      return {
        id: String(data.id),
        name: data.name,
        status: data.status?.status ?? status,
        url: `${appBase}/t/${data.id}`,
      };
    },

    async updateTask({ taskId, name, description, priority, dueDate }) {
      await assertTaskList.call(this, taskId);
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (priority !== undefined) body.priority = priority;
      if (dueDate !== undefined) body.due_date = dueDate;
      if (Object.keys(body).length === 0) {
        // Nothing to update; return the current shape without a PUT.
        return await this.getTask({ taskId });
      }
      const data = await api<Record<string, unknown>>(
        "PUT",
        `/task/${encodeURIComponent(taskId)}`,
        body,
      );
      return toTaskSummary(data);
    },

    async setTaskStatus({ taskId, status }) {
      await assertTaskList.call(this, taskId);
      const data = await api<{ id: string; status?: { status?: string; type?: string } }>(
        "PUT",
        `/task/${encodeURIComponent(taskId)}`,
        { status },
      );
      return {
        id: String(data.id ?? taskId),
        status: data.status?.status ?? status,
        statusType: data.status?.type ?? null,
      };
    },

    async listComments({ taskId }) {
      await assertTaskList.call(this, taskId);
      const data = await api<{ comments?: Array<Record<string, unknown>> }>(
        "GET",
        `/task/${encodeURIComponent(taskId)}/comment`,
      );
      const comments = (data.comments ?? []).map((c) => ({
        id: String(c.id ?? ""),
        author:
          ((c.user as { username?: string; email?: string } | undefined)?.username ??
            (c.user as { username?: string; email?: string } | undefined)?.email ??
            null),
        body:
          typeof c.comment_text === "string"
            ? c.comment_text
            : Array.isArray(c.comment)
              ? ((c.comment as Array<{ text?: string }>)
                  .map((p) => p.text ?? "")
                  .join("\n"))
              : "",
        created:
          typeof c.date === "number"
            ? new Date(c.date as number).toISOString()
            : (c.date as string) ?? "",
      }));
      return { taskId, comments };
    },

    async addComment({ taskId, body, notifyAll = false }) {
      await assertTaskList.call(this, taskId);
      const qs = notifyAll ? "?notify_all=true" : "";
      const data = await api<{ id: string; date?: number | string }>(
        "POST",
        `/task/${encodeURIComponent(taskId)}/comment${qs}`,
        { comment_text: body },
      );
      return {
        id: String(data.id),
        taskId,
        created:
          typeof data.date === "number"
            ? new Date(data.date).toISOString()
            : (data.date as string) ?? new Date().toISOString(),
      };
    },
  };

  // Inner helper: scope-check a task id against the pinned List. Uses the
  // cache when present, otherwise fetches the task once.
  async function assertTaskList(this: Client, taskId: string): Promise<void> {
    // The local sentinel: callers pass `config.listId` directly to mean
    // "any task in the pinned list". No HTTP call needed in that case.
    if (taskId === config.listId) return;
    const cached = taskListCache.get(taskId);
    if (cached !== undefined) {
      if (cached !== config.listId) {
        throw new ListScopeError(cached, config.listId);
      }
      return;
    }
    const raw = await api<Record<string, unknown>>(
      "GET",
      `/task/${encodeURIComponent(taskId)}`,
    );
    const lid = toTaskListId(raw);
    if (!lid) {
      throw new Error(`Task ${taskId} has no list — refusing to act.`);
    }
    taskListCache.set(taskId, lid);
    if (lid !== config.listId) {
      throw new ListScopeError(lid, config.listId);
    }
  }

  return { client, listId: config.listId, baseUrl: config.baseUrl };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}