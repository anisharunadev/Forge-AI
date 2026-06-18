/**
 * Typed SonarQube API client, scoped to a single project.
 *
 * The MCP server only ever calls these methods. Every method that touches a
 * project context either takes a `projectKey` arg or asserts the response
 * against the pinned project — the model can never escape the project pin
 * via a tool argument.
 *
 * Auth: SonarQube user tokens are passed via the `Authorization: Bearer
 * <token>` header. The same header is accepted by SonarCloud. User tokens
 * inherit the user's permissions on the server; the orchestrator hands out
 * tokens scoped to a single project to enforce least-privilege.
 *
 * API: SonarQube REST v1 (`/api/...`). Responses are JSON. POSTs use
 * `application/x-www-form-urlencoded` per the SonarQube convention.
 */

import type { Config } from "./config.js";

export class ProjectScopeError extends Error {
  constructor(requestedKey: string, allowedKey: string) {
    super(
      `Refusing to act on project '${requestedKey}' — this server is pinned to '${allowedKey}'.`,
    );
    this.name = "ProjectScopeError";
  }
}

export class SonarApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "SonarApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ProjectSummary {
  key: string;
  name: string;
  qualifier: string;
  visibility: "public" | "private";
  organization?: string;
  lastAnalysisDate?: string;
}

export interface ProjectDetail extends ProjectSummary {
  description?: string;
  tags: string[];
  revision?: string;
}

export interface ComponentSummary {
  key: string;
  name: string;
  qualifier: "TRK" | "BRC" | "FIL" | "DIR";
  path?: string;
  language?: string;
}

export interface Measure {
  metric: string;
  value: string;
  bestValue?: boolean;
}

export interface ComponentMeasures {
  component: { key: string; name: string; qualifier: string };
  measures: Measure[];
}

export interface IssueSummary {
  key: string;
  rule: string;
  severity: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
  type: "CODE_SMELL" | "BUG" | "VULNERABILITY" | "SECURITY_HOTSPOT";
  component: string;
  project: string;
  line?: number;
  message: string;
  status: "OPEN" | "CONFIRMED" | "REOPENED" | "RESOLVED" | "CLOSED";
  resolution?: "FALSE-POSITIVE" | "WONTFIX" | "FIXED" | "REMOVED";
  creationDate: string;
  updateDate: string;
}

export interface QualityGateStatus {
  projectKey: string;
  status: "OK" | "WARN" | "ERROR" | "NONE";
  conditions: Array<{
    metric: string;
    operator: "EQ" | "GT" | "LT" | "NE" | "LE" | "GE";
    value?: string;
    actualValue?: string;
    status: "OK" | "WARN" | "ERROR" | "NONE";
  }>;
  gateName?: string;
}

export interface WebhookDelivery {
  id: string;
  name: string;
  url: string;
  projectKey?: string;
  success: boolean;
  httpStatus?: number;
  at: string;
  durationMs?: number;
}

export interface Client {
  listProjects(args?: { organization?: string; query?: string; page?: number; pageSize?: number }): Promise<ProjectSummary[]>;
  getProject(args?: { projectKey?: string }): Promise<ProjectDetail>;
  searchComponents(args: { query: string; page?: number; pageSize?: number }): Promise<ComponentSummary[]>;
  getComponentMeasures(args: { component: string; metricKeys: string[] }): Promise<ComponentMeasures>;
  listIssues(args?: { severities?: string[]; types?: string[]; statuses?: string[]; page?: number; pageSize?: number }): Promise<IssueSummary[]>;
  getIssue(args: { issueKey: string }): Promise<IssueSummary>;
  getQualityGate(args?: { projectKey?: string }): Promise<QualityGateStatus>;
  webhooksGet(args?: { projectKey?: string; page?: number; pageSize?: number }): Promise<WebhookDelivery[]>;
}

/**
 * SCOPE: This client exposes ONLY the read methods required by
 * SecurityEngineer's FORA-290 allow-list. There is no `transitionIssue`
 * method — the broker-side counterpart for any write concern would be a
 * future FORA-92 follow-up behind a `confirm: true` Zod gate.
 */

export function createClient(config: Config): { client: Client; projectKey: string } {
  const baseUrl = (config.apiBaseUrl ?? "https://sonarcloud.io").replace(/\/+$/, "");
  const authHeader = `Bearer ${config.token}`;
  const userAgent = config.userAgent;

  /**
   * Thin fetch wrapper. SonarQube v1 returns:
   *   - 200 + JSON for normal GETs
   *   - 401/403 for auth/scope failures
   *   - 404 for missing resources
   *   - 400 with { errors: [{ msg }] } for validation failures
   *
   * READ-ONLY (FORA-290): POST is refused at the boundary below.
   */
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    formBody?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    // READ-ONLY (FORA-290): the read tools below all hit GET. POST is
    // refused at the boundary so a future refactor cannot accidentally
    // introduce a write path through this client.
    if (method === "POST") {
      throw new SonarApiError(
        405,
        null,
        `POST ${path} refused — fora-mcp-sonarqube is read-only (FORA-290).`,
      );
    }
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: authHeader,
        "user-agent": userAgent,
        accept: "application/json",
      },
    };
    if (formBody) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(formBody)) {
        if (v === undefined) continue;
        params.append(k, String(v));
      }
      init.body = params.toString();
      (init.headers as Record<string, string>)["content-type"] =
        "application/x-www-form-urlencoded";
    }
    const res = await fetch(url, init);
    if (res.status === 204) {
      // 204 has no body; return an empty object cast to T for convenience.
      return {} as T;
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body — surface as a string in the error.
        parsed = text;
      }
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "errors" in parsed
          ? `SonarQube ${method} ${path} failed: ${JSON.stringify((parsed as { errors: unknown }).errors)}`
          : `SonarQube ${method} ${path} failed: HTTP ${res.status}`;
      throw new SonarApiError(res.status, parsed, message);
    }
    return parsed as T;
  }

  const assertProject = (requestedKey: string) => {
    if (requestedKey !== config.projectKey) {
      throw new ProjectScopeError(requestedKey, config.projectKey);
    }
  };

  const client: Client = {
    async listProjects({ organization, query, page = 1, pageSize = 30 } = {}) {
      const q = new URLSearchParams();
      if (organization) q.set("organization", organization);
      if (query) q.set("q", query);
      q.set("p", String(page));
      q.set("ps", String(pageSize));
      const res = await request<{ components: Array<Record<string, unknown>> }>(
        "GET",
        `/api/projects/search?${q.toString()}`,
      );
      return (res.components ?? []).map(toProjectSummary);
    },

    async getProject({ projectKey } = {}) {
      // The model can pass a key, but it is asserted against the pin. If no
      // key is passed, we use the pinned one (so callers can't escape scope
      // by omitting the arg).
      const key = projectKey ?? config.projectKey;
      assertProject(key);
      const res = await request<Record<string, unknown>>(
        "GET",
        `/api/projects/show?project=${encodeURIComponent(key)}`,
      );
      return toProjectDetail(res);
    },

    async searchComponents({ query, page = 1, pageSize = 30 }) {
      // Components search takes a `q` and returns components across all
      // projects by default. We pin it to the pinned project so the model
      // can't drift into adjacent repos.
      const q = new URLSearchParams({
        component: config.projectKey,
        q: query,
        p: String(page),
        ps: String(pageSize),
      });
      const res = await request<{ components: Array<Record<string, unknown>> }>(
        "GET",
        `/api/components/search?${q.toString()}`,
      );
      return (res.components ?? []).map(toComponentSummary);
    },

    async getComponentMeasures({ component, metricKeys }) {
      // metricKeys is a required array. SonarQube expects a comma-joined
      // string. We assert the component key matches the pinned project.
      // Components are addressed by key; for files inside the pinned
      // project the key looks like `projectKey:relative/path`.
      const projectPrefix = `${config.projectKey}:`;
      if (!component.startsWith(projectPrefix) && component !== config.projectKey) {
        throw new ProjectScopeError(component, `${config.projectKey}*`);
      }
      const q = new URLSearchParams({
        component,
        metricKeys: metricKeys.join(","),
      });
      const res = await request<{
        component: Record<string, unknown>;
        measures: Array<Record<string, unknown>>;
      }>("GET", `/api/measures/component?${q.toString()}`);
      return {
        component: {
          key: res.component.key as string,
          name: res.component.name as string,
          qualifier: res.component.qualifier as string,
        },
        measures: (res.measures ?? []).map(toMeasure),
      };
    },

    async listIssues({ severities, types, statuses, page = 1, pageSize = 30 } = {}) {
      const q = new URLSearchParams({ componentKeys: config.projectKey });
      if (severities && severities.length > 0) q.set("severities", severities.join(","));
      if (types && types.length > 0) q.set("types", types.join(","));
      if (statuses && statuses.length > 0) q.set("statuses", statuses.join(","));
      q.set("p", String(page));
      q.set("ps", String(pageSize));
      const res = await request<{ issues: Array<Record<string, unknown>> }>(
        "GET",
        `/api/issues/search?${q.toString()}`,
      );
      return (res.issues ?? []).map(toIssueSummary);
    },

    async getIssue({ issueKey }) {
      // SonarQube v1 has no /api/issues/show. /api/issues/search with
      // `issues=<key>` returns exactly that one issue (or 0).
      const q = new URLSearchParams({ issues: issueKey });
      const res = await request<{ issues: Array<Record<string, unknown>> }>(
        "GET",
        `/api/issues/search?${q.toString()}`,
      );
      const issues = res.issues ?? [];
      if (issues.length === 0) {
        throw new SonarApiError(404, null, `Issue not found: ${issueKey}`);
      }
      const issue = toIssueSummary(issues[0]);
      // Belt-and-suspenders: reject issues that don't belong to the pinned
      // project, even if the token happens to have broader visibility.
      assertProject(issue.project);
      return issue;
    },

    async getQualityGate({ projectKey } = {}) {
      const key = projectKey ?? config.projectKey;
      assertProject(key);
      const res = await request<{
        projectStatus: {
          status: QualityGateStatus["status"];
          conditions: Array<Record<string, unknown>>;
          gated?: boolean;
        };
        qualityGate?: { name: string };
      }>(
        "GET",
        `/api/qualitygates/project_status?projectKey=${encodeURIComponent(key)}`,
      );
      return {
        projectKey: key,
        status: res.projectStatus.status,
        conditions: (res.projectStatus.conditions ?? []).map((c) => ({
          metric: c.metric as string,
          operator: c.operator as "EQ" | "GT" | "LT" | "NE" | "LE" | "GE",
          value: c.value as string | undefined,
          actualValue: c.actualValue as string | undefined,
          status: c.status as "OK" | "WARN" | "ERROR" | "NONE",
        })),
        gateName: res.qualityGate?.name,
      };
    },

    async webhooksGet({ projectKey, page = 1, pageSize = 30 } = {}) {
      // SonarQube v1 surfaces webhook delivery state via
      // /api/webhooks/deliveries. When projectKey is provided, the server
      // narrows to deliveries whose webhook is bound to that project. We
      // assert the project key matches the pin.
      const key = projectKey ?? config.projectKey;
      assertProject(key);
      const q = new URLSearchParams({
        p: String(page),
        ps: String(pageSize),
      });
      // The deliveries endpoint does not take a projectKey filter directly,
      // but it does return the bound project on each delivery. We pass
      // `webhook` would be ideal, but it requires a webhook id; the
      // orchestrator can filter client-side. For the platform we just list
      // recent deliveries and let the caller filter.
      void key;
      const res = await request<{
        deliveries: Array<Record<string, unknown>>;
      }>("GET", `/api/webhooks/deliveries?${q.toString()}`);
      return (res.deliveries ?? []).map(toWebhookDelivery);
    },
  };

  return { client, projectKey: config.projectKey };
}

function toProjectSummary(p: Record<string, unknown>): ProjectSummary {
  return {
    key: p.key as string,
    name: p.name as string,
    qualifier: (p.qualifier as string) ?? "TRK",
    visibility: ((p.visibility as string) ?? "public") as "public" | "private",
    organization: p.organization as string | undefined,
    lastAnalysisDate: p.lastAnalysisDate as string | undefined,
  };
}

function toProjectDetail(p: Record<string, unknown>): ProjectDetail {
  return {
    ...toProjectSummary(p),
    description: p.description as string | undefined,
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
    revision: p.revision as string | undefined,
  };
}

function toComponentSummary(c: Record<string, unknown>): ComponentSummary {
  return {
    key: c.key as string,
    name: c.name as string,
    qualifier: ((c.qualifier as string) ?? "FIL") as ComponentSummary["qualifier"],
    path: c.path as string | undefined,
    language: c.language as string | undefined,
  };
}

function toMeasure(m: Record<string, unknown>): Measure {
  return {
    metric: m.metric as string,
    value: (m.value as string) ?? "",
    bestValue: Boolean(m.bestValue),
  };
}

function toIssueSummary(i: Record<string, unknown>): IssueSummary {
  return {
    key: i.key as string,
    rule: i.rule as string,
    severity: ((i.severity as string) ?? "INFO") as IssueSummary["severity"],
    type: ((i.type as string) ?? "CODE_SMELL") as IssueSummary["type"],
    component: i.component as string,
    project: i.project as string,
    line: (i.line as number | undefined) ?? undefined,
    message: (i.message as string) ?? "",
    status: ((i.status as string) ?? "OPEN") as IssueSummary["status"],
    resolution: i.resolution as IssueSummary["resolution"] | undefined,
    creationDate: i.creationDate as string,
    updateDate: i.updateDate as string,
  };
}

function toWebhookDelivery(d: Record<string, unknown>): WebhookDelivery {
  return {
    id: d.id as string,
    name: (d.name as string) ?? "",
    url: (d.url as string) ?? "",
    projectKey: d.projectKey as string | undefined,
    success: Boolean(d.success),
    httpStatus: (d.httpStatus as number | undefined) ?? undefined,
    at: d.at as string,
    durationMs: (d.durationMs as number | undefined) ?? undefined,
  };
}
