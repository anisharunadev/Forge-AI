/**
 * Typed Slack Web API client, scoped to a single workspace
 * — READ-ONLY (FORA-290).
 *
 * The MCP server only ever calls these methods. Workspace scope is
 * enforced at boot via `teamId` in config — `auth.test` is called once
 * on startup and the response's `team_id` MUST match the pin. Every
 * read targets the pinned workspace.
 *
 * The model can pass a `channel` id as a tool argument, but it is
 * asserted against the pinned workspace on every call via
 * `conversations.info` (with a per-process cache keyed by channel id).
 * This prevents an escaped prompt from reaching a channel that exists
 * in a different workspace, even one the bot was incidentally
 * installed in.
 *
 * SCOPE: This client exposes ONLY the read methods required by
 * SecurityEngineer's FORA-290 allow-list. There are no post / update /
 * reaction methods — the broker-side counterpart for any write concern
 * would be a future FORA-92 follow-up behind a `confirm: true` Zod
 * gate.
 *
 * Slack Web API tier limits (subject to change; see api.slack.com/methods):
 *   - Most read methods:   ~50 req/min per workspace
 *   - search.messages:     Tier 3 (~20 req/min)
 *   - 429 responses are surfaced as `SlackApiError`; the agent decides.
 *
 * We do NOT depend on any Slack SDK — the Web API is stable enough to
 * call directly with `fetch`, and avoiding the SDK keeps the package
 * small and the auth story obvious.
 */

import type { Config } from "./config.js";

export class TeamScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on workspace '${requested}' — this server is pinned to '${allowed}'.`,
    );
    this.name = "TeamScopeError";
  }
}

export class ChannelScopeError extends Error {
  constructor(channel: string, teamId: string) {
    super(
      `Refusing to act on channel '${channel}' — it does not belong to pinned workspace '${teamId}'.`,
    );
    this.name = "ChannelScopeError";
  }
}

export class SlackApiError extends Error {
  constructor(
    public readonly slackError: string,
    public readonly body: string,
    public readonly endpoint: string,
  ) {
    super(`Slack API error '${slackError}' on ${endpoint}: ${truncate(body, 200)}`);
    this.name = "SlackApiError";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export interface ChannelSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  memberCount: number;
  topic: string;
  purpose: string;
}

export interface ThreadParent {
  channel: string;
  ts: string;
  user: string;
  text: string;
  replyCount: number;
  latestReply: string;
}

export interface ThreadMessage {
  ts: string;
  user: string;
  text: string;
  threadTs: string;
  isThreadParent: boolean;
  replyCount: number;
}

export interface ThreadDetail {
  channel: string;
  parentTs: string;
  messages: ThreadMessage[];
}

export interface SearchHit {
  channel: string;
  channelName: string;
  ts: string;
  user: string;
  text: string;
  permalink: string;
}

export interface Client {
  /** Workspace id the client is pinned to (echoed back for the orchestrator). */
  teamId: string;
  listChannels(args?: { limit?: number; cursor?: string; types?: string }): Promise<{ channels: ChannelSummary[]; nextCursor: string | null }>;
  listThreads(args: { channel: string; limit?: number; oldest?: string; latest?: string }): Promise<{ threads: ThreadParent[]; channel: string }>;
  getThread(args: { channel: string; thread_ts: string; limit?: number }): Promise<ThreadDetail>;
  searchMessages(args: { query: string; count?: number; page?: number }): Promise<{ total: number; hits: SearchHit[] }>;
}

export function createClient(config: Config): { client: Client; teamId: string } {
  const apiBase = (config.apiBaseUrl ?? "https://slack.com/api").replace(/\/+$/, "");

  async function api<T>(
    method: "GET" | "POST",
    path: string,
    form?: Record<string, string>,
  ): Promise<T> {
    // READ-ONLY (FORA-290): the read tools below all hit GET endpoints.
    // We allow POST for `auth.test` (the startup team assertion) and
    // for the initial `auth.test` ping; the smoke test never calls a
    // POST mutation endpoint. We refuse any POST whose path is on the
    // write side.
    if (method === "POST" && !path.endsWith("/api/auth.test")) {
      throw new SlackApiError(
        "read_only",
        "",
        `${method} ${path} refused — fora-mcp-slack is read-only (FORA-290).`,
      );
    }
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "User-Agent": config.userAgent,
    };
    let payload: string | undefined;
    if (form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      payload = new URLSearchParams(form).toString();
    }

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    if (!text) {
      throw new SlackApiError("empty_response", "", `${method} ${path}`);
    }
    let parsed: { ok?: boolean; error?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SlackApiError("invalid_json", text, `${method} ${path}`);
    }
    if (!res.ok) {
      throw new SlackApiError(`http_${res.status}`, text, `${method} ${path}`);
    }
    if (parsed.ok === false) {
      throw new SlackApiError(parsed.error ?? "unknown_error", text, `${method} ${path}`);
    }
    return parsed as T;
  }

  // --- Startup assertion: the bot's token must belong to the pinned team. ---
  let confirmedTeamId: string = config.teamId;
  let teamConfirmed = false;
  const assertTeamOnStartup = async (): Promise<void> => {
    if (teamConfirmed) return;
    const res = await api<{ team_id?: string; team?: string; user_id?: string; bot_id?: string }>(
      "POST",
      "/api/auth.test",
    );
    const actualTeam = res.team_id ?? res.team;
    if (!actualTeam) {
      throw new Error(
        `auth.test response missing team_id; refusing to start. ` +
          `Body: ${JSON.stringify(res).slice(0, 200)}`,
      );
    }
    if (actualTeam !== config.teamId) {
      throw new TeamScopeError(actualTeam, config.teamId);
    }
    confirmedTeamId = actualTeam;
    teamConfirmed = true;
  };

  // --- Per-call channel scope check ---
  const channelTeamCache = new Map<string, string>();
  const assertChannelTeam = async (channel: string): Promise<void> => {
    const cached = channelTeamCache.get(channel);
    if (cached !== undefined) {
      if (cached !== confirmedTeamId) {
        throw new ChannelScopeError(channel, confirmedTeamId);
      }
      return;
    }
    const res = await api<{ channel?: { team?: string; id?: string; name?: string } }>(
      "GET",
      `/api/conversations.info?channel=${encodeURIComponent(channel)}`,
    );
    const team = res.channel?.team;
    if (!team) {
      throw new ChannelScopeError(channel, confirmedTeamId);
    }
    channelTeamCache.set(channel, team);
    if (team !== confirmedTeamId) {
      throw new ChannelScopeError(channel, confirmedTeamId);
    }
  };

  const toChannelSummary = (raw: Record<string, unknown>): ChannelSummary => ({
    id: raw.id as string,
    name: raw.name as string,
    isPrivate: Boolean(raw.is_private),
    isArchived: Boolean(raw.is_archived),
    memberCount: (raw.num_members as number) ?? 0,
    topic: ((raw.topic as { value?: string } | undefined)?.value) ?? "",
    purpose: ((raw.purpose as { value?: string } | undefined)?.value) ?? "",
  });

  const toThreadParent = (
    raw: Record<string, unknown>,
    channel: string,
  ): ThreadParent => ({
    channel,
    ts: raw.ts as string,
    user: ((raw.user as string) ?? (raw.bot_id as string) ?? ""),
    text: (raw.text as string) ?? "",
    replyCount: (raw.reply_count as number) ?? 0,
    latestReply: (raw.latest_reply as string) ?? (raw.ts as string),
  });

  const toThreadMessage = (raw: Record<string, unknown>): ThreadMessage => {
    const ts = raw.ts as string;
    const threadTs = (raw.thread_ts as string | undefined) ?? ts;
    return {
      ts,
      user: ((raw.user as string) ?? (raw.bot_id as string) ?? ""),
      text: (raw.text as string) ?? "",
      threadTs,
      isThreadParent: threadTs === ts,
      replyCount: (raw.reply_count as number) ?? 0,
    };
  };

  const toSearchHit = (raw: Record<string, unknown>): SearchHit => {
    const channel = raw.channel as Record<string, unknown> | undefined;
    return {
      channel: (channel?.id as string) ?? "",
      channelName: (channel?.name as string) ?? "",
      ts: (raw.ts as string) ?? "",
      user: ((raw.user as string) ?? (raw.username as string) ?? ""),
      text: (raw.text as string) ?? "",
      permalink: (raw.permalink as string) ?? "",
    };
  };

  const client: Client = {
    teamId: confirmedTeamId,

    async listChannels({ limit = 100, cursor, types = "public_channel,private_channel" } = {}) {
      await assertTeamOnStartup();
      const params = new URLSearchParams({ limit: String(limit), types });
      if (cursor) params.set("cursor", cursor);
      const data = await api<{
        channels?: Array<Record<string, unknown>>;
        response_metadata?: { next_cursor?: string };
      }>("GET", `/api/conversations.list?${params.toString()}`);
      const channels = (data.channels ?? []).map(toChannelSummary);
      const nextCursor = data.response_metadata?.next_cursor ?? null;
      return { channels, nextCursor };
    },

    async listThreads({ channel, limit = 50, oldest, latest }) {
      await assertTeamOnStartup();
      await assertChannelTeam(channel);
      const params = new URLSearchParams({ channel, limit: String(limit) });
      if (oldest) params.set("oldest", oldest);
      if (latest) params.set("latest", latest);
      const data = await api<{
        messages?: Array<Record<string, unknown>>;
      }>("GET", `/api/conversations.history?${params.toString()}`);
      const parents = (data.messages ?? []).filter(
        (m) => Number(m.reply_count ?? 0) > 0,
      );
      return {
        channel,
        threads: parents.map((m) => toThreadParent(m, channel)),
      };
    },

    async getThread({ channel, thread_ts, limit = 100 }) {
      await assertTeamOnStartup();
      await assertChannelTeam(channel);
      const params = new URLSearchParams({ channel, ts: thread_ts, limit: String(limit) });
      const data = await api<{
        messages?: Array<Record<string, unknown>>;
      }>("GET", `/api/conversations.replies?${params.toString()}`);
      return {
        channel,
        parentTs: thread_ts,
        messages: (data.messages ?? []).map(toThreadMessage),
      };
    },

    async searchMessages({ query, count = 20, page = 1 }) {
      await assertTeamOnStartup();
      // Slack's search.messages is workspace-scoped, so a bot token can
      // only see messages in its own workspace. We trust the workspace
      // boundary; the model can scope further with `in:#channel-name`
      // qualifiers.
      const data = await api<{
        messages?: { total?: number; matches?: Array<Record<string, unknown>> };
      }>(
        "GET",
        `/api/search.messages?query=${encodeURIComponent(query)}&count=${count}&page=${page}`,
      );
      const total = data.messages?.total ?? 0;
      const hits = (data.messages?.matches ?? []).map(toSearchHit);
      return { total, hits };
    },
  };

  return { client, teamId: config.teamId };
}
