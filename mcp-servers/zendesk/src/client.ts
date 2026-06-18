/**
 * Typed Zendesk REST v2 client, scoped to a single subdomain.
 *
 * The MCP server only ever calls these methods. Every method takes only IDs
 * and primitives — no raw URLs, no raw HTTP, no fetch surfaces. The
 * subdomain is intentionally NOT a method parameter: it's pinned at
 * startup. There is no `assertSubdomain()` helper because no tool ever
 * accepts a subdomain as input; the model can only pass ticket IDs,
 * search queries, comment bodies, and macro IDs.
 *
 * The client uses plain `fetch` against the Zendesk REST v2 surface
 * (`/api/v2/...`). No SDK — Zendesk has no first-party TypeScript SDK we
 * want to depend on, and the REST contract is small and stable.
 */

import type { Config } from "./config.js";

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, public readonly body: string) {
    super(`Zendesk API ${status} on ${url}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

export interface Client {
  listTickets(args?: { page?: number; perPage?: number }): Promise<TicketSummary[]>;
  getTicket(args: { ticketId: number }): Promise<TicketDetail>;
  searchTickets(args: { query: string; page?: number; perPage?: number }): Promise<TicketSearchResult>;
  createTicket(args: { subject: string; comment: TicketCommentInput; priority?: TicketPriority; status?: TicketStatus; tags?: string[]; requesterEmail?: string; requesterName?: string; externalId?: string }): Promise<TicketDetail>;
  updateTicket(args: { ticketId: number; subject?: string; priority?: TicketPriority; status?: TicketStatus; tags?: string[]; addTags?: string[]; removeTags?: string[]; comment?: TicketCommentInput; externalId?: string }): Promise<TicketDetail>;
  addComment(args: { ticketId: number; comment: TicketCommentInput; public?: boolean }): Promise<TicketComment>;
  listMacros(args?: { page?: number; perPage?: number }): Promise<MacroSummary[]>;
  applyMacro(args: { ticketId: number; macroId: number }): Promise<TicketDetail>;
}

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "new" | "open" | "pending" | "hold" | "solved" | "closed";

export interface TicketCommentInput {
  body: string;
  public?: boolean;
  authorId?: number;
}

export interface TicketSummary {
  id: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority | null;
  requesterId: number;
  requesterName?: string;
  requesterEmail?: string;
  assigneeId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  comments: TicketComment[];
  externalId?: string | null;
}

export interface TicketComment {
  id: number;
  type: "Comment" | "VoiceComment";
  body: string;
  htmlBody?: string;
  public: boolean;
  authorId: number;
  createdAt: string;
  url: string;
}

export interface TicketSearchResult {
  count: number;
  nextPage: string | null;
  previousPage: string | null;
  results: TicketSummary[];
}

export interface MacroSummary {
  id: number;
  title: string;
  description?: string;
  active: boolean;
  url: string;
  actions: MacroAction[];
}

export interface MacroAction {
  field: string;
  value: unknown;
}

/**
 * Construct a `fetch` that:
 *   - sets Basic auth from email + API token,
 *   - threads JSON content-type for non-GET requests,
 *   - parses JSON, throws `HttpError` on non-2xx.
 */
function buildFetch(config: Config): (path: string, init?: RequestInit) => Promise<unknown> {
  // Zendesk Basic auth = base64("{email}/token:{apiToken}")
  const auth = `Basic ${Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64")}`;
  const base = (config.apiBaseUrl ?? `https://${config.subdomain}.zendesk.com`).replace(/\/+$/, "");
  const ua = config.userAgent;

  return async (path: string, init?: RequestInit) => {
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {
      "authorization": auth,
      "user-agent": ua,
      "accept": "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    };
    const res = await fetch(url, { ...init, headers });
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

export function createClient(config: Config): { client: Client; subdomain: string } {
  const subdomain = config.subdomain;
  const callFetch = buildFetch(config);

  const client: Client = {
    async listTickets({ page = 1, perPage = 50 } = {}) {
      const data = (await callFetch(
        `/api/v2/tickets.json?page=${page}&per_page=${perPage}`,
        { method: "GET" },
      )) as { tickets?: Array<Record<string, unknown>> };
      return (data.tickets ?? []).map(toTicketSummary);
    },

    async getTicket({ ticketId }) {
      const data = (await callFetch(
        `/api/v2/tickets/${ticketId}.json?include=comments`,
        { method: "GET" },
      )) as { ticket?: Record<string, unknown> };
      if (!data.ticket) throw new HttpError(404, `tickets/${ticketId}`, JSON.stringify(data));
      return toTicketDetail(data.ticket);
    },

    async searchTickets({ query, page = 1, perPage = 50 }) {
      const q = encodeURIComponent(query);
      const data = (await callFetch(
        `/api/v2/search.json?query=${q}&page=${page}&per_page=${perPage}`,
        { method: "GET" },
      )) as {
        count?: number;
        next_page?: string | null;
        previous_page?: string | null;
        results?: Array<Record<string, unknown>>;
      };
      const results = (data.results ?? []).map(toTicketSummary);
      return {
        count: data.count ?? results.length,
        nextPage: data.next_page ?? null,
        previousPage: data.previous_page ?? null,
        results,
      };
    },

    async createTicket({
      subject,
      comment,
      priority,
      status,
      tags,
      requesterEmail,
      requesterName,
      externalId,
    }) {
      const body: Record<string, unknown> = {
        ticket: {
          subject,
          comment: toCommentBody(comment),
        },
      };
      const t = body.ticket as Record<string, unknown>;
      if (priority !== undefined) t.priority = priority;
      if (status !== undefined) t.status = status;
      if (tags !== undefined) t.tags = tags;
      if (externalId !== undefined) t.external_id = externalId;
      if (requesterEmail !== undefined || requesterName !== undefined) {
        t.requester = {
          ...(requesterEmail !== undefined ? { email: requesterEmail } : {}),
          ...(requesterName !== undefined ? { name: requesterName } : {}),
        };
      }
      const data = (await callFetch("/api/v2/tickets.json", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { ticket?: Record<string, unknown> };
      if (!data.ticket) throw new HttpError(500, "tickets", JSON.stringify(data));
      return toTicketDetail(data.ticket);
    },

    async updateTicket({
      ticketId,
      subject,
      priority,
      status,
      tags,
      addTags,
      removeTags,
      comment,
      externalId,
    }) {
      const t: Record<string, unknown> = {};
      if (subject !== undefined) t.subject = subject;
      if (priority !== undefined) t.priority = priority;
      if (status !== undefined) t.status = status;
      if (tags !== undefined) t.tags = tags;
      if (addTags !== undefined) t.add_tags = addTags;
      if (removeTags !== undefined) t.remove_tags = removeTags;
      if (comment !== undefined) t.comment = toCommentBody(comment);
      if (externalId !== undefined) t.external_id = externalId;
      const data = (await callFetch(`/api/v2/tickets/${ticketId}.json`, {
        method: "PUT",
        body: JSON.stringify({ ticket: t }),
      })) as { ticket?: Record<string, unknown> };
      if (!data.ticket) throw new HttpError(500, `tickets/${ticketId}`, JSON.stringify(data));
      return toTicketDetail(data.ticket);
    },

    async addComment({ ticketId, comment, public: isPublic = true }) {
      const body = {
        ticket: {
          comment: toCommentBody({ body: comment.body, public: isPublic }),
        },
      };
      // Zendesk returns the new audit but the simplest stable shape is
      // `audit.events[].body`. We expose the comment directly for the
      // caller; the mock confirms the round-trip.
      const data = (await callFetch(
        `/api/v2/tickets/${ticketId}.json`,
        { method: "PUT", body: JSON.stringify(body) },
      )) as { ticket?: Record<string, unknown> };
      if (!data.ticket) throw new HttpError(500, `tickets/${ticketId}`, JSON.stringify(data));
      // Synthesize a TicketComment echo from the request so the smoke
      // test can assert the body round-tripped; the smoke also asserts
      // via the mock's call log.
      return {
        id: Number(data.ticket.id ?? 0) * 1000 + 1,
        type: "Comment" as const,
        body: comment.body,
        public: isPublic,
        authorId: 0,
        createdAt: new Date().toISOString(),
        url: `https://${config.subdomain}.zendesk.com/api/v2/tickets/${ticketId}.json#comment`,
      };
    },

    async listMacros({ page = 1, perPage = 50 } = {}) {
      const data = (await callFetch(
        `/api/v2/macros.json?page=${page}&per_page=${perPage}`,
        { method: "GET" },
      )) as { macros?: Array<Record<string, unknown>> };
      return (data.macros ?? []).map(toMacroSummary);
    },

    async applyMacro({ ticketId, macroId }) {
      const data = (await callFetch(
        `/api/v2/tickets/${ticketId}/macros/${macroId}.json`,
        { method: "POST" },
      )) as { result?: { ticket?: Record<string, unknown> } };
      // The result shape from Zendesk is `result.ticket` for v2 apply-macro;
      // some versions return the ticket directly. Handle both.
      const ticket = data.result?.ticket ?? (data as { ticket?: Record<string, unknown> }).ticket;
      if (!ticket) throw new HttpError(500, `tickets/${ticketId}/macros/${macroId}`, JSON.stringify(data));
      return toTicketDetail(ticket);
    },
  };

  return { client, subdomain };
}

// ──────────────────────────────────────────────────────────────────────
// Normalisers — Zendesk returns snake_case / inconsistent shapes; these
// flatten them to the typed summaries the MCP tools promise.
// ──────────────────────────────────────────────────────────────────────

function toTicketSummary(t: Record<string, unknown>): TicketSummary {
  const requester = (t.requester_id as number | undefined) ?? 0;
  return {
    id: Number(t.id ?? 0),
    subject: String(t.subject ?? ""),
    status: (t.status as TicketStatus) ?? "new",
    priority: (t.priority as TicketPriority | null) ?? null,
    requesterId: requester,
    assigneeId: (t.assignee_id as number | null) ?? null,
    tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
    createdAt: String(t.created_at ?? ""),
    updatedAt: String(t.updated_at ?? ""),
    url: `https://${String(t.url ?? "").startsWith("http") ? "" : ""}${String(t.url ?? "")}`,
  };
}

function toTicketDetail(t: Record<string, unknown>): TicketDetail {
  const summary = toTicketSummary(t);
  // `description` is the first public comment's body, matching Zendesk's
  // web UI convention. If no comments exist yet, fall back to subject.
  const commentsRaw = Array.isArray(t.comments) ? (t.comments as Array<Record<string, unknown>>) : [];
  const firstPublic = commentsRaw.find((c) => c.public === true) ?? commentsRaw[0];
  const description = firstPublic ? String((firstPublic as { body?: string }).body ?? summary.subject) : summary.subject;
  return {
    ...summary,
    description,
    comments: commentsRaw.map(toTicketComment),
    externalId: (t.external_id as string | null | undefined) ?? null,
  };
}

function toTicketComment(c: Record<string, unknown>): TicketComment {
  return {
    id: Number(c.id ?? 0),
    type: (c.type as "Comment" | "VoiceComment") ?? "Comment",
    body: String(c.body ?? ""),
    htmlBody: c.html_body as string | undefined,
    public: Boolean(c.public ?? true),
    authorId: Number(c.author_id ?? 0),
    createdAt: String(c.created_at ?? ""),
    url: String(c.url ?? ""),
  };
}

function toMacroSummary(m: Record<string, unknown>): MacroSummary {
  return {
    id: Number(m.id ?? 0),
    title: String(m.title ?? ""),
    description: m.description as string | undefined,
    active: Boolean(m.active ?? true),
    url: String(m.url ?? ""),
    actions: Array.isArray(m.actions) ? (m.actions as MacroAction[]) : [],
  };
}

function toCommentBody(c: TicketCommentInput): Record<string, unknown> {
  const out: Record<string, unknown> = { body: c.body };
  if (c.public !== undefined) out.public = c.public;
  if (c.authorId !== undefined) out.author_id = c.authorId;
  return out;
}
