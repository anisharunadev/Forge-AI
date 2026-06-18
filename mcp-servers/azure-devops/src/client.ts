/**
 * Typed Azure DevOps REST 7.1 client, scoped to a single project.
 *
 * The MCP server only ever calls these methods. Every method takes only IDs
 * and primitives — no raw URLs, no raw HTTP, no fetch surfaces. The project
 * is intentionally NOT a method parameter: it's pinned at startup. The
 * `assertProject()` helper is exposed for tools that may pass an explicit
 * project identifier in the future.
 *
 * The client uses plain `fetch` against the AzDO REST 7.1 surface
 * (`/{orgUrl}/_apis/...` and `/{orgUrl}/{project}/_apis/...`). No SDK — the
 * AzDO JS SDK is unmaintained and the REST contract is small and stable.
 */

import type { Config } from "./config.js";

export class ProjectScopeError extends Error {
  constructor(requestedProject: string, allowedProject: string) {
    super(
      `Refusing to act on project '${requestedProject}' — this server is pinned to '${allowedProject}'.`,
    );
    this.name = "ProjectScopeError";
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, public readonly body: string) {
    super(`Azure DevOps API ${status} on ${url}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

export interface Client {
  listProjects(): Promise<ProjectSummary[]>;
  listRepos(args?: { top?: number }): Promise<RepoSummary[]>;
  listPipelines(args?: { top?: number }): Promise<PipelineSummary[]>;
  runPipeline(args: { pipelineId: number; variables?: Record<string, { value: string }> }): Promise<PipelineRun>;
  getPipelineRun(args: { pipelineId: number; runId: number }): Promise<PipelineRun>;
  listWorkItems(args: { wiql?: string; top?: number }): Promise<WorkItemSummary[]>;
  getWorkItem(args: { id: number; expand?: string }): Promise<WorkItemDetail>;
  createWorkItem(args: { type: string; title: string; description?: string; fields?: Record<string, string> }): Promise<WorkItemDetail>;
  addWorkItemComment(args: { id: number; text: string }): Promise<WorkItemComment>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  state: string;
  url: string;
}

export interface RepoSummary {
  id: string;
  name: string;
  defaultBranch: string;
  url: string;
  remoteUrl: string;
}

export interface PipelineSummary {
  id: number;
  name: string;
  folder?: string;
  url: string;
}

export interface PipelineRun {
  id: number;
  pipelineId: number;
  state: string;
  result?: string;
  url: string;
  createdDate: string;
  variables?: Record<string, { value?: string }>;
}

export interface WorkItemSummary {
  id: number;
  rev: number;
  title: string;
  state: string;
  workItemType: string;
  url: string;
}

export interface WorkItemDetail extends WorkItemSummary {
  description?: string;
  fields: Record<string, unknown>;
}

export interface WorkItemComment {
  id: number;
  text: string;
  url: string;
  createdBy?: string;
  createdDate: string;
}

/**
 * Normalise a project identifier the caller may have passed. Today the
 * project is server-pinned so callers shouldn't pass one, but we keep the
 * hook so a future tool (e.g. an admin that explicitly scopes to a
 * sub-project) can be added without rewriting the assertion.
 */
function assertProject(requested: string | undefined, pinned: string): void {
  if (requested !== undefined && requested !== pinned) {
    throw new ProjectScopeError(requested, pinned);
  }
}

/**
 * Construct a `fetch` that:
 *   - sets Basic auth from the PAT (`base64(":" + pat)`),
 *   - pins `api-version` on every request,
 *   - parses JSON, throws `HttpError` on non-2xx.
 */
function buildFetch(config: Config): (path: string, init?: RequestInit) => Promise<unknown> {
  const auth = `Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`;
  const base = config.apiBaseUrl ?? `${config.orgUrl}/${config.project}`;
  const ua = config.userAgent;

  return async (path: string, init?: RequestInit) => {
    // `path` is `/...` (no host). We append `?api-version=` if not present
    // and preserve any pre-existing query string the caller passed.
    const url = joinUrl(base, path, config.apiVersion);
    const res = await fetch(url, {
      ...init,
      headers: {
        "authorization": auth,
        "user-agent": ua,
        "accept": "application/json",
        ...(init?.body ? { "content-type": "application/json-patch+json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, url, text);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(res.status, url, `non-JSON body: ${text.slice(0, 200)}`);
    }
  };
}

function joinUrl(base: string, path: string, apiVersion: string): string {
  // Always emit api-version=7.1 unless the caller already provided one in
  // the path's query string.
  const sep = path.includes("?") ? "&" : "?";
  const hasApiVersion = /[?&]api-version=/.test(path);
  const v = hasApiVersion ? "" : `${sep}api-version=${encodeURIComponent(apiVersion)}`;
  // The mock may serve the project list at a different host than the
  // project-scoped routes; we treat `path` as absolute-relative to `base`.
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}${v}`;
}

export function createClient(config: Config): { client: Client; project: string } {
  const project = config.project;
  const callFetch = buildFetch(config);

  const client: Client = {
    async listProjects() {
      // Project list is org-scoped, not project-scoped, so we go up one
      // level from the project base. The mock and real AzDO both expose
      // `/_apis/projects`.
      const base = config.apiBaseUrl ?? config.orgUrl;
      const url = joinUrl(base, `/_apis/projects`, config.apiVersion);
      const res = await fetch(url, {
        headers: {
          "authorization": `Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`,
          "user-agent": config.userAgent,
          "accept": "application/json",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, url, text);
      const data = JSON.parse(text) as { value: Array<Record<string, unknown>> };
      return (data.value ?? []).map(toProjectSummary);
    },

    async listRepos({ top = 50 } = {}) {
      const data = (await callFetch(`/_apis/git/repositories`, {
        method: "GET",
      })) as { value: Array<Record<string, unknown>> };
      return (data.value ?? []).slice(0, top).map(toRepoSummary);
    },

    async listPipelines({ top = 50 } = {}) {
      const data = (await callFetch(`/_apis/pipelines`, {
        method: "GET",
      })) as { value: Array<Record<string, unknown>> };
      return (data.value ?? []).slice(0, top).map(toPipelineSummary);
    },

    async runPipeline({ pipelineId, variables }) {
      const body = variables ? { variables } : {};
      const data = (await callFetch(`/_apis/pipelines/${pipelineId}/runs`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return toPipelineRun(data);
    },

    async getPipelineRun({ pipelineId, runId }) {
      const data = (await callFetch(
        `/_apis/pipelines/${pipelineId}/runs/${runId}`,
        { method: "GET" },
      )) as Record<string, unknown>;
      return toPipelineRun(data);
    },

    async listWorkItems({ wiql = "SELECT [System.Id] FROM WorkItems", top = 50 } = {}) {
      // Two-step: run a WIQL query, then batch-fetch the resulting IDs.
      const wiqlRes = (await callFetch(`/_apis/wit/wiql`, {
        method: "POST",
        body: JSON.stringify({ query: wiql }),
      })) as { workItems?: Array<{ id: number }> };
      const ids = (wiqlRes.workItems ?? []).map((w) => w.id).slice(0, top);
      if (ids.length === 0) return [];
      const detail = (await callFetch(
        `/_apis/wit/workitems?ids=${ids.join(",")}&api-version=${config.apiVersion}`,
        { method: "GET" },
      )) as { value: Array<Record<string, unknown>> };
      return (detail.value ?? []).map(toWorkItemSummary);
    },

    async getWorkItem({ id, expand }) {
      const path = expand
        ? `/_apis/wit/workitems/${id}?$expand=${encodeURIComponent(expand)}`
        : `/_apis/wit/workitems/${id}`;
      const data = (await callFetch(path, { method: "GET" })) as Record<string, unknown>;
      return toWorkItemDetail(data);
    },

    async createWorkItem({ type, title, description, fields = {} }) {
      // AzDO work item creation is a JSON Patch document.
      const ops: Array<{ op: string; path: string; value: unknown }> = [
        { op: "add", path: "/fields/System.Title", value: title },
      ];
      if (description !== undefined) {
        ops.push({ op: "add", path: "/fields/System.Description", value: description });
      }
      for (const [k, v] of Object.entries(fields)) {
        ops.push({ op: "add", path: `/fields/${k}`, value: v });
      }
      const data = (await callFetch(
        `/_apis/wit/workitems/$${encodeURIComponent(type)}`,
        {
          method: "POST",
          body: JSON.stringify(ops),
        },
      )) as Record<string, unknown>;
      return toWorkItemDetail(data);
    },

    async addWorkItemComment({ id, text }) {
      const data = (await callFetch(`/_apis/wit/workitems/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ text }),
      })) as Record<string, unknown>;
      return toWorkItemComment(data);
    },
  };

  return { client, project };
}

// ──────────────────────────────────────────────────────────────────────
// Normalisers — AzDO returns inconsistent shapes; these flatten them to
// the typed summaries the MCP tools promise.
// ──────────────────────────────────────────────────────────────────────

function toProjectSummary(p: Record<string, unknown>): ProjectSummary {
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    description: p.description as string | undefined,
    state: String(p.state ?? "wellFormed"),
    url: String(p.url ?? ""),
  };
}

function toRepoSummary(r: Record<string, unknown>): RepoSummary {
  return {
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    defaultBranch: String((r.defaultBranch as string) ?? "refs/heads/main").replace(/^refs\/heads\//, ""),
    url: String(r.url ?? ""),
    remoteUrl: String(r.remoteUrl ?? r.url ?? ""),
  };
}

function toPipelineSummary(p: Record<string, unknown>): PipelineSummary {
  return {
    id: Number(p.id ?? 0),
    name: String(p.name ?? ""),
    folder: p.folder as string | undefined,
    url: String(p.url ?? ""),
  };
}

function toPipelineRun(r: Record<string, unknown>): PipelineRun {
  return {
    id: Number(r.id ?? 0),
    pipelineId: Number(
      (r.pipeline as { id?: number } | undefined)?.id ?? r.pipelineId ?? 0,
    ),
    state: String(r.state ?? "unknown"),
    result: r.result as string | undefined,
    url: String(r.url ?? ""),
    createdDate: String(r.createdDate ?? new Date().toISOString()),
    variables: r.variables as Record<string, { value?: string }> | undefined,
  };
}

function toWorkItemSummary(w: Record<string, unknown>): WorkItemSummary {
  const fields = (w.fields as Record<string, unknown> | undefined) ?? {};
  return {
    id: Number(w.id ?? 0),
    rev: Number(w.rev ?? 0),
    title: String(fields["System.Title"] ?? ""),
    state: String(fields["System.State"] ?? "New"),
    workItemType: String(fields["System.WorkItemType"] ?? "Task"),
    url: String(w.url ?? ""),
  };
}

function toWorkItemDetail(w: Record<string, unknown>): WorkItemDetail {
  const fields = (w.fields as Record<string, unknown> | undefined) ?? {};
  return {
    ...toWorkItemSummary(w),
    description: (fields["System.Description"] as string | undefined) ?? undefined,
    fields,
  };
}

function toWorkItemComment(c: Record<string, unknown>): WorkItemComment {
  return {
    id: Number(c.id ?? 0),
    text: String(c.text ?? ""),
    url: String(c.url ?? ""),
    createdBy: ((c.createdBy as Record<string, unknown> | undefined)?.displayName as string | undefined),
    createdDate: String(c.createdDate ?? new Date().toISOString()),
  };
}
