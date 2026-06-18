/**
 * Typed Confluence Cloud (v2) API client, scoped to a single space —
 * READ-ONLY (FORA-290).
 *
 * The MCP server only ever calls these methods. Every method that takes
 * a `pageId` asserts it belongs to the pinned space before any data is
 * returned. The model can never escape the space pin via a tool
 * argument.
 *
 * Auth: Basic auth header built from email + API token (Atlassian Cloud
 * standard). On startup we resolve the configured CONFLUENCE_SPACE_KEY to
 * the numeric space ID that v2 requires.
 *
 * SCOPE: This client exposes ONLY the read methods required by
 * SecurityEngineer's FORA-290 allow-list. There are no create / update
 * / comment methods — the broker-side counterpart for any write
 * concern would be a future FORA-92 follow-up behind a `confirm: true`
 * Zod gate.
 */

import type { Config } from "./config.js";

export class SpaceScopeError extends Error {
  constructor(requestedSpaceId: string, allowedSpaceId: string) {
    super(
      `Refusing to act on space '${requestedSpaceId}' — this server is pinned to '${allowedSpaceId}'.`,
    );
    this.name = "SpaceScopeError";
  }
}

export class ConfluenceApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ConfluenceApiError";
    this.status = status;
    this.body = body;
  }
}

export interface PageSummary {
  id: string;
  title: string;
  spaceId: string;
  parentId: string | null;
  version: { number: number; createdAt: string };
  status: "current" | "archived" | "trashed" | "draft";
  _links?: { webui?: string };
}

export interface PageDetail extends PageSummary {
  body: { representation: "storage" | "atlas_doc_format"; value: string };
}

export interface SearchHit {
  id: string;
  title: string;
  spaceId: string;
  url?: string;
  excerpt: string;
}

export interface Client {
  listPages(args?: {
    limit?: number;
    cursor?: string;
    title?: string;
  }): Promise<PageSummary[]>;
  getPage(args: { page_id: string }): Promise<PageDetail>;
  search(args: { cql: string; limit?: number }): Promise<SearchHit[]>;
}

interface Resolved {
  baseUrl: string; // ends with /wiki
  spaceId: string;
  authHeader: string;
  userAgent: string;
}

export interface CreateClientResult {
  client: Client;
  spaceId: string;
  spaceKey: string;
}

/**
 * Build the typed client. Resolves the configured CONFLUENCE_SPACE_KEY to
 * the space ID that v2 requires by calling /spaces?keys=... on first use.
 * The spaceId is then pinned for the lifetime of this process.
 */
export async function createClient(config: Config): Promise<CreateClientResult> {
  const baseUrl = stripTrailingSlash(config.apiBaseUrl ?? config.baseUrl);
  const authHeader =
    "Basic " +
    Buffer.from(`${config.email}:${config.apiToken}`, "utf8").toString("base64");
  const userAgent = config.userAgent;

  const spaceId = await resolveSpaceId(baseUrl, authHeader, userAgent, config.spaceKey);
  const resolved: Resolved = { baseUrl, spaceId, authHeader, userAgent };

  const assertSpace = (pageSpaceId: string) => {
    if (pageSpaceId !== resolved.spaceId) {
      throw new SpaceScopeError(pageSpaceId, resolved.spaceId);
    }
  };

  const client: Client = {
    async listPages({ limit = 25, cursor, title } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      if (title) params.set("title", title);
      const path = `/api/v2/spaces/${resolved.spaceId}/pages?${params.toString()}`;
      const res = await confluenceFetch(resolved, path, { method: "GET" });
      const data = (await res.json()) as { results: Array<Record<string, unknown>> };
      return data.results.map(toPageSummary);
    },

    async getPage({ page_id }) {
      const path = `/api/v2/pages/${encodeURIComponent(page_id)}?body-format=storage`;
      const res = await confluenceFetch(resolved, path, { method: "GET" });
      const data = (await res.json()) as Record<string, unknown>;
      const summary = toPageSummary(data);
      // Confirm the page actually belongs to our pinned space; if it doesn't,
      // the agent prompt is trying to escape scope — refuse.
      assertSpace(summary.spaceId);
      return toPageDetail(data, summary);
    },

    async search({ cql, limit = 20 }) {
      // Confluence v2 doesn't have a /search endpoint; the canonical
      // search lives on the v1 surface (`/wiki/rest/api/content/search`)
      // and accepts a `cql` query string. We pin the space in the
      // query so the model cannot search across other spaces.
      const pinnedCql = injectSpaceScope(cql, resolved.spaceId);
      const params = new URLSearchParams({
        cql: pinnedCql,
        limit: String(limit),
      });
      const path = `/api/content/search?${params.toString()}`;
      const res = await confluenceFetch(resolved, path, { method: "GET" });
      const data = (await res.json()) as {
        results: Array<Record<string, unknown>>;
        start: number;
        limit: number;
        size: number;
      };
      const hits = (data.results ?? []).map(toSearchHit);
      // Defence in depth: every hit must be in the pinned space.
      for (const h of hits) {
        if (h.spaceId !== resolved.spaceId) {
          throw new SpaceScopeError(h.spaceId, resolved.spaceId);
        }
      }
      return hits;
    },
  };

  return { client, spaceId: resolved.spaceId, spaceKey: config.spaceKey };
}

async function resolveSpaceId(
  baseUrl: string,
  authHeader: string,
  userAgent: string,
  spaceKey: string,
): Promise<string> {
  const path = `/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      authorization: authHeader,
      accept: "application/json",
      "user-agent": userAgent,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to resolve Confluence space key '${spaceKey}': HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as { results?: Array<{ id: string; key: string }> };
  const found = data.results?.[0];
  if (!found) {
    throw new Error(
      `Confluence space key '${spaceKey}' not found on the site. Check CONFLUENCE_SPACE_KEY.`,
    );
  }
  return found.id;
}

async function confluenceFetch(
  resolved: Resolved,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  // READ-ONLY (FORA-290): refuse any non-GET request at the boundary.
  if (init.method !== "GET") {
    throw new ConfluenceApiError(
      405,
      null,
      `Method ${init.method} not allowed — fora-mcp-confluence is read-only (FORA-290).`,
    );
  }
  const headers: Record<string, string> = {
    authorization: resolved.authHeader,
    accept: "application/json",
    "user-agent": resolved.userAgent,
  };
  const res = await fetch(`${resolved.baseUrl}${path}`, {
    method: init.method,
    headers,
  });
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    const message =
      (payload as { message?: string } | null)?.message ??
      `Confluence API ${init.method} ${path} returned ${res.status}`;
    throw new ConfluenceApiError(res.status, payload, message);
  }
  return res;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Inject the pinned space id into a CQL query. CQL clauses are joined
 * with `AND`; if the query already constrains `space = …` we leave it
 * alone (the per-hit check would have caught a cross-space leak), but
 * for the common case the model passes a topic-shaped query
 * (`text ~ "threat model"`) and we add the space guard.
 */
function injectSpaceScope(cql: string, spaceId: string): string {
  const trimmed = cql.trim();
  if (/\bspace\s*=\s*/i.test(trimmed)) return trimmed;
  return `(space = ${spaceId}) AND (${trimmed})`;
}

function toPageSummary(p: Record<string, unknown>): PageSummary {
  const version = (p.version as { number?: number; createdAt?: string } | undefined) ?? {};
  return {
    id: p.id as string,
    title: p.title as string,
    spaceId: p.spaceId as string,
    parentId: (p.parentId as string | null | undefined) ?? null,
    version: {
      number: version.number ?? 0,
      createdAt: version.createdAt ?? "",
    },
    status: ((p.status as string) ?? "current") as PageSummary["status"],
    _links: p._links as PageSummary["_links"],
  };
}

function toPageDetail(p: Record<string, unknown>, summary: PageSummary): PageDetail {
  const body = (p.body as { representation?: string; value?: string } | undefined) ?? {};
  return {
    ...summary,
    body: {
      representation: (body.representation as "storage" | "atlas_doc_format") ?? "storage",
      value: (body.value as string) ?? "",
    },
  };
}

function toSearchHit(r: Record<string, unknown>): SearchHit {
  // v1 content/search response shape: each result has `content` (the
  // slim page summary), `title`, `excerpt`, `url`, `resultParentContainer`
  // (space display), and `space` (id on the v1 path). We normalise into
  // SearchHit with a string `spaceId`.
  const content = (r.content as Record<string, unknown> | undefined) ?? {};
  const spaceId =
    (content.space as Record<string, unknown> | undefined)?.id ??
    (r.space as Record<string, unknown> | undefined)?.id ??
    "";
  const links = (content._links as Record<string, unknown> | undefined) ?? {};
  const webui = (links.webui as string | undefined) ?? undefined;
  return {
    id: (content.id as string) ?? (r.id as string) ?? "",
    title: (content.title as string) ?? (r.title as string) ?? "",
    spaceId: String(spaceId),
    url: webui,
    excerpt: (r.excerpt as string) ?? "",
  };
}
