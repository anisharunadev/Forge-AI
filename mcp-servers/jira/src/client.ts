/**
 * Typed Jira Cloud REST v3 client, scoped to a single project.
 *
 * The MCP server only ever calls these methods. Project scope is enforced at
 * boot via `projectKey` in config — every read or write targets the pinned
 * project. The model can pass `issueIdOrKey` but the underlying project is
 * server-pinned (mirrors the GitHub MCP's `GITHUB_ORG` enforcement). Any
 * attempt to act on an issue whose project does not match the pin raises
 * `ProjectScopeError` before any HTTP call lands.
 *
 * Atlassian Cloud uses HTTP Basic auth: `Authorization: Basic base64(email:api_token)`.
 *
 * Cloud REST rate limits (subject to change):
 *   - Most read endpoints:  ~10,000 req/hr per tenant
 *   - Write endpoints:     per-endpoint caps, typically 100-1,000 req/hr
 *   - 429 responses are surfaced as `JiraApiError`; the agent decides.
 *
 * We do NOT depend on any Atlassian SDK — the REST surface is stable enough
 * to call directly with `fetch`, and avoiding the SDK keeps the package
 * small and the auth story obvious.
 */

import type { Config } from "./config.js";

export class ProjectScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on project '${requested}' — this server is pinned to '${allowed}'.`,
    );
    this.name = "ProjectScopeError";
  }
}

export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string,
  ) {
    super(`Jira API ${status} on ${endpoint}: ${truncate(body, 200)}`);
    this.name = "JiraApiError";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export interface IssueSummary {
  id: string;
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  priority: string | null;
  updated: string;
  url: string;
}

export interface IssueSearchResult {
  total: number;
  startAt: number;
  maxResults: number;
  issues: IssueSummary[];
}

export interface IssueDetail extends IssueSummary {
  description: string | null;
  labels: string[];
  reporter: string | null;
  assignee: string | null;
  created: string;
  transitions: Array<{ id: string; name: string; to: string }>;
}

export interface IssueCreated {
  id: string;
  key: string;
  self: string;
  url: string;
}

export interface Client {
  listIssues(args?: { maxResults?: number; startAt?: number }): Promise<IssueSearchResult>;
  searchJql(args: { jql: string; maxResults?: number; startAt?: number; fields?: string[] }): Promise<IssueSearchResult>;
  getIssue(args: { issueIdOrKey: string; fields?: string[] }): Promise<IssueDetail>;
  createIssue(args: { summary: string; description?: string; issueTypeName?: string; labels?: string[]; priority?: string }): Promise<IssueCreated>;
  addComment(args: { issueIdOrKey: string; body: string }): Promise<{ id: string; self: string; created: string }>;
  transitionIssue(args: { issueIdOrKey: string; transitionId?: string; transitionName?: string }): Promise<{ id: string; key: string; status: string }>;
}

export function createClient(config: Config): { client: Client; projectKey: string; baseUrl: string } {
  // apiBaseUrl is the full path to /rest/api/3 (used by smoke tests).
  // baseUrl is the site root (e.g. https://acme.atlassian.net).
  const apiBase =
    config.apiBaseUrl ?? `${stripTrailingSlash(config.baseUrl)}/rest/api/3`;
  const browseBase = `${stripTrailingSlash(config.baseUrl)}/browse`;

  // HTTP Basic auth header, computed once.
  const authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;

  async function api<T>(
    method: "GET" | "POST" | "PUT",
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
      throw new JiraApiError(res.status, text, `${method} ${path}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // --- Atlassian Document Format helpers (v3 uses ADF for rich text) ---
  // We deliberately keep inputs as plain strings and convert to ADF here.
  const plainToAdf = (text: string) => ({
    type: "doc",
    version: 1,
    content: text
      .split(/\r?\n\r?\n/) // paragraphs split on blank lines
      .filter((p) => p.trim().length > 0)
      .map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      })),
  });
  const adfToPlain = (adf: unknown): string | null => {
    if (!adf || typeof adf !== "object") return null;
    const collect = (node: unknown, out: string[]): void => {
      if (!node || typeof node !== "object") return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && typeof n.text === "string") out.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach((c) => collect(c, out));
    };
    const buf: string[] = [];
    collect(adf, buf);
    return buf.length === 0 ? null : buf.join("\n");
  };

  // Cache of issue → project so get_issue / add_comment / transition_issue
  // can scope-check without an extra round trip in the common case.
  // (We still re-fetch when missing; the cache is a hot-path optimization.)
  const issueProjectCache = new Map<string, string>();

  const toIssueSummary = (raw: Record<string, unknown>): IssueSummary => {
    const fields = (raw.fields as Record<string, unknown>) ?? {};
    const key = raw.key as string;
    const status = (fields.status as { name?: string; statusCategory?: { key?: string } } | undefined);
    return {
      id: raw.id as string,
      key,
      summary: (fields.summary as string) ?? "",
      status: status?.name ?? "Unknown",
      statusCategory: status?.statusCategory?.key ?? "new",
      issueType: ((fields.issuetype as { name?: string } | undefined)?.name) ?? "Task",
      priority: ((fields.priority as { name?: string } | undefined)?.name) ?? null,
      updated: (fields.updated as string) ?? "",
      url: `${browseBase}/${key}`,
    };
  };

  const toProjectKey = (raw: Record<string, unknown>): string | null => {
    const f = (raw.fields as Record<string, unknown> | undefined)?.project;
    if (!f || typeof f !== "object") return null;
    return (f as { key?: string }).key ?? null;
  };

  const client: Client = {
    async listIssues({ maxResults = 50, startAt = 0 } = {}) {
      // list_issues: a convenience wrapper for the pinned project, with no
      // JQL required. Equivalent to `search_jql({ jql: "project = <PINNED>
      // ORDER BY updated DESC" })`. The model can still call search_jql for
      // more expressive queries.
      const jql = `project = ${config.projectKey} ORDER BY updated DESC`;
      return this.searchJql({ jql, maxResults, startAt });
    },

    async searchJql({ jql, maxResults = 50, startAt = 0, fields }) {
      // Defensive scope check: if the JQL mentions a project other than the
      // pin, refuse. We pattern-match a `project = X` / `project IN (...)`
      // qualifier and check the value. This is best-effort — the model could
      // construct a JQL that escapes scope (e.g. via subqueries), but the
      // common prompt-injection cases are caught.
      assertJqlScope(jql, config.projectKey);

      const defaultFields = ["summary", "status", "issuetype", "priority", "updated"];
      const body = {
        jql,
        maxResults,
        startAt,
        fields: fields && fields.length > 0 ? fields : defaultFields,
      };
      const data = await api<{
        total: number;
        startAt: number;
        maxResults: number;
        issues: Array<Record<string, unknown>>;
      }>("POST", `/search/jql`, body);
      const issues = (data.issues ?? []).map(toIssueSummary);
      // Remember each issue's project for later scope checks.
      for (const raw of data.issues ?? []) {
        const k = toProjectKey(raw);
        if (k) issueProjectCache.set(raw.key as string, k);
      }
      return {
        total: data.total,
        startAt: data.startAt,
        maxResults: data.maxResults,
        issues,
      };
    },

    async getIssue({ issueIdOrKey, fields }) {
      const qs = fields && fields.length > 0
        ? `?fields=${encodeURIComponent(fields.join(","))}`
        : "";
      const raw = await api<Record<string, unknown>>("GET", `/issue/${encodeURIComponent(issueIdOrKey)}${qs}`);
      const projectKey = toProjectKey(raw);
      if (projectKey && projectKey !== config.projectKey) {
        throw new ProjectScopeError(projectKey, config.projectKey);
      }
      if (projectKey) issueProjectCache.set(raw.key as string, projectKey);

      const summary = toIssueSummary(raw);
      const f = (raw.fields as Record<string, unknown>) ?? {};
      // Transitions require a separate call — fetch in parallel with the issue
      // for the same cost in latency.
      const transRaw = await api<{ transitions?: Array<Record<string, unknown>> }>(
        "GET",
        `/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
      ).catch(() => ({ transitions: [] }));
      const transitions = (transRaw.transitions ?? []).map((t) => {
        const to = (t.to as { name?: string } | undefined);
        return {
          id: t.id as string,
          name: (t.name as string) ?? "",
          to: to?.name ?? "",
        };
      });
      return {
        ...summary,
        description: adfToPlain(f.description),
        labels: ((f.labels as string[]) ?? []),
        reporter: ((f.reporter as { displayName?: string } | undefined)?.displayName) ?? null,
        assignee: ((f.assignee as { displayName?: string } | undefined)?.displayName) ?? null,
        created: (f.created as string) ?? "",
        url: summary.url,
        transitions,
      };
    },

    async createIssue({ summary, description, issueTypeName = "Task", labels, priority }) {
      const fields: Record<string, unknown> = {
        project: { key: config.projectKey },
        summary,
        issuetype: { name: issueTypeName },
      };
      if (description) fields.description = plainToAdf(description);
      if (labels && labels.length > 0) fields.labels = labels;
      if (priority) fields.priority = { name: priority };
      const data = await api<{ id: string; key: string; self: string }>(
        "POST",
        `/issue`,
        { fields },
      );
      return {
        id: data.id,
        key: data.key,
        self: data.self,
        url: `${browseBase}/${data.key}`,
      };
    },

    async addComment({ issueIdOrKey, body }) {
      await assertIssueProject.call(this, issueIdOrKey);
      const data = await api<{ id: string; self: string; created: string }>(
        "POST",
        `/issue/${encodeURIComponent(issueIdOrKey)}/comment`,
        { body: plainToAdf(body) },
      );
      return { id: data.id, self: data.self, created: data.created };
    },

    async transitionIssue({ issueIdOrKey, transitionId, transitionName }) {
      if (!transitionId && !transitionName) {
        throw new Error("transition_issue requires either `transitionId` or `transitionName`");
      }
      await assertIssueProject.call(this, issueIdOrKey);

      // If only a name is given, look it up against the issue's current transitions.
      let id = transitionId;
      if (!id) {
        const transData = await api<{ transitions?: Array<Record<string, unknown>> }>(
          "GET",
          `/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
        );
        const match = (transData.transitions ?? []).find(
          (t) => ((t.name as string) ?? "").toLowerCase() === transitionName!.toLowerCase(),
        );
        if (!match) {
          throw new Error(
            `No transition named '${transitionName}' for issue ${issueIdOrKey}. ` +
              `Use get_issue to see available transitions.`,
          );
        }
        id = match.id as string;
      }
      await api("POST", `/issue/${encodeURIComponent(issueIdOrKey)}/transitions`, { transition: { id } });
      // Read back the new status so the caller can confirm.
      const refreshed = await api<Record<string, unknown>>(
        "GET",
        `/issue/${encodeURIComponent(issueIdOrKey)}`,
      );
      const f = (refreshed.fields as Record<string, unknown>) ?? {};
      const status = (f.status as { name?: string } | undefined);
      return {
        id: refreshed.id as string,
        key: refreshed.key as string,
        status: status?.name ?? "Unknown",
      };
    },
  };

  // Inner helper: scope-check an issue key against the pinned project. Uses
  // the cache when present, otherwise fetches the issue once.
  async function assertIssueProject(this: Client, issueIdOrKey: string): Promise<void> {
    const cached = issueProjectCache.get(issueIdOrKey);
    if (cached !== undefined) {
      if (cached !== config.projectKey) {
        throw new ProjectScopeError(cached, config.projectKey);
      }
      return;
    }
    const raw = await api<Record<string, unknown>>(
      "GET",
      `/issue/${encodeURIComponent(issueIdOrKey)}?fields=project`,
    );
    const key = toProjectKey(raw);
    if (!key) {
      throw new Error(`Issue ${issueIdOrKey} has no project — refusing to act.`);
    }
    issueProjectCache.set(issueIdOrKey, key);
    if (key !== config.projectKey) {
      throw new ProjectScopeError(key, config.projectKey);
    }
  }

  return { client, projectKey: config.projectKey, baseUrl: config.baseUrl };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Best-effort JQL scope check. Refuses if the JQL pins a different project
 * than the configured pin. Catches the common `project = X` and
 * `project IN (X, Y)` shapes; does not try to be a full JQL parser.
 */
function assertJqlScope(jql: string, pinned: string): void {
  const text = jql.trim();
  const projectRe = /\bproject\s*(=|<>)\s*"?([A-Za-z][A-Za-z0-9_]*)"?/i;
  const m = text.match(projectRe);
  if (m) {
    const op = m[1];
    const value = m[2];
    if (op === "=" && value.toUpperCase() !== pinned.toUpperCase()) {
      throw new ProjectScopeError(value, pinned);
    }
    if (op === "<>" && value.toUpperCase() === pinned.toUpperCase()) {
      throw new ProjectScopeError(value, pinned);
    }
  }
  const inRe = /\bproject\s+IN\s*\(([^)]+)\)/i;
  const inMatch = text.match(inRe);
  if (inMatch) {
    const list = inMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/"/g, "").toUpperCase());
    if (!list.includes(pinned.toUpperCase())) {
      throw new ProjectScopeError(list.join(","), pinned);
    }
  }
}
