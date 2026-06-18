// test/mock-slack.mjs
// Lightweight in-memory Slack Web API mock for the smoke test.
//
// Implements the minimum surface the FORA Slack MCP server touches:
//   POST /api/auth.test
//   GET  /api/conversations.list
//   GET  /api/conversations.info
//   GET  /api/conversations.history
//   GET  /api/conversations.replies
//   POST /api/chat.postMessage
//   POST /api/chat.update
//   POST /api/reactions.add
//   GET  /api/search.messages
//
// The mock records every call (method, path, body) so the smoke test can
// assert that the MCP server actually issued the right requests and that
// the post/update/add payloads round-trip.

import http from "node:http";
import { URL } from "node:url";

/**
 * @typedef {Object} MockState
 * @property {string} teamId            The pinned workspace id the mock advertises.
 * @property {Array<Record<string, unknown>>} channels
 * @property {Record<string, Array<Record<string, unknown>>>} historyByChannel  channelId → messages
 * @property {Array<Record<string, unknown>>} postedMessages
 * @property {Array<{ channel: string, ts: string, name: string }>} reactions
 * @property {Array<{ method: string, path: string, body: unknown }>} callLog
 */

/** @returns {MockState} */
export function initialState({ teamId = "T0123MOCK" } = {}) {
  return {
    teamId,
    channels: [
      {
        id: "C001",
        name: "general",
        is_private: false,
        is_archived: false,
        num_members: 42,
        team: teamId,
        topic: { value: "Company-wide announcements" },
        purpose: { value: "General chatter and FYIs." },
      },
      {
        id: "C002",
        name: "forge",
        is_private: true,
        is_archived: false,
        num_members: 7,
        team: teamId,
        topic: { value: "FORA engineering" },
        purpose: { value: "Engineering coordination." },
      },
      {
        id: "C003",
        name: "design",
        is_private: false,
        is_archived: true,
        num_members: 0,
        team: teamId,
        topic: { value: "" },
        purpose: { value: "" },
      },
      // A channel that lives in a different workspace. Our client must
      // refuse to act on it (ChannelScopeError) even though the bot's token
      // could potentially reach it via a multi-workspace install.
      {
        id: "C_OTHER",
        name: "other-workspace-channel",
        is_private: false,
        is_archived: false,
        num_members: 5,
        team: "T_OTHER_TEAM",
        topic: { value: "" },
        purpose: { value: "" },
      },
    ],
    historyByChannel: {
      C001: [
        {
          ts: "1700000001.000100",
          user: "U001",
          text: "Welcome to general",
          reply_count: 0,
        },
        {
          ts: "1700000010.000200",
          user: "U002",
          text: "Smoke thread parent",
          reply_count: 2,
          latest_reply: "1700000020.000300",
        },
        {
          ts: "1700000030.000400",
          user: "U003",
          text: "Loose message with no replies",
          reply_count: 0,
        },
      ],
      C002: [
        {
          ts: "1700001000.000100",
          user: "U010",
          text: "Forge thread root",
          reply_count: 1,
          latest_reply: "1700001001.000200",
        },
      ],
    },
    postedMessages: [],
    reactions: [],
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
      const callEntry = { method: req.method ?? "?", path, body: null };
      state.callLog.push(callEntry);

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        // Slack accepts both form-encoded (POST) and query (GET). Parse form
        // bodies into a plain object so the smoke test can inspect them.
        if (raw) {
          if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded")) {
            callEntry.body = Object.fromEntries(new URLSearchParams(raw));
          } else {
            try {
              callEntry.body = JSON.parse(raw);
            } catch {
              callEntry.body = raw;
            }
          }
        }

        try {
          handle(state, req.method ?? "GET", path, u, callEntry.body, res);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: "mock_server_error",
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

function okJson(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, ...payload }));
}

function errJson(res, error, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: false, error }));
}

function handle(state, method, path, url, body, res) {
  // POST /api/auth.test
  if (path === "/api/auth.test" && method === "POST") {
    return okJson(res, {
      url: "https://acme.slack.com/",
      team: "Acme",
      team_id: state.teamId,
      user_id: "U_BOT",
      bot_id: "B_BOT",
    });
  }

  // GET /api/conversations.list
  if (path === "/api/conversations.list" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const cursor = url.searchParams.get("cursor");
    const types = (url.searchParams.get("types") ?? "public_channel,private_channel").split(",");
    // Real Slack only returns channels in the workspace the token is authed
    // to. Mirror that: filter by team before applying the types filter.
    let channels = state.channels.filter((c) => {
      if (c.team !== state.teamId) return false;
      if (c.is_archived) return false;
      if (c.is_private && !types.includes("private_channel")) return false;
      if (!c.is_private && !types.includes("public_channel")) return false;
      return true;
    });
    // Cursor is faked: cursor="next" means "return empty + no next cursor".
    if (cursor === "next") {
      return okJson(res, { channels: [], response_metadata: {} });
    }
    channels = channels.slice(0, limit);
    return okJson(res, { channels, response_metadata: {} });
  }

  // GET /api/conversations.info?channel=X
  if (path === "/api/conversations.info" && method === "GET") {
    const channel = url.searchParams.get("channel") ?? "";
    const found = state.channels.find((c) => c.id === channel);
    if (!found) return errJson(res, "channel_not_found");
    return okJson(res, { channel: found });
  }

  // GET /api/conversations.history?channel=X
  if (path === "/api/conversations.history" && method === "GET") {
    const channel = url.searchParams.get("channel") ?? "";
    const messages = state.historyByChannel[channel] ?? [];
    return okJson(res, { messages, has_more: false });
  }

  // GET /api/conversations.replies?channel=X&ts=Y
  if (path === "/api/conversations.replies" && method === "GET") {
    const channel = url.searchParams.get("channel") ?? "";
    const ts = url.searchParams.get("ts") ?? "";
    const history = state.historyByChannel[channel] ?? [];
    const parent = history.find((m) => m.ts === ts);
    if (!parent) return errJson(res, "thread_not_found");
    // The mock only has the parent; that's enough to prove the route is
    // hit. The smoke test asserts the returned messages contain the parent.
    return okJson(res, { messages: [parent] });
  }

  // POST /api/chat.postMessage
  if (path === "/api/chat.postMessage" && method === "POST") {
    const channel = body?.channel ?? "";
    const text = body?.text ?? "";
    const threadTs = body?.thread_ts;
    const ts = `1700000${String(state.postedMessages.length + 100).padStart(3, "0")}.000700`;
    const posted = {
      ts,
      user: "U_BOT",
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
    state.postedMessages.push(posted);
    return okJson(res, {
      channel,
      ts,
      message: { ts, user: "U_BOT", text, ...(threadTs ? { thread_ts: threadTs } : {}) },
    });
  }

  // POST /api/chat.update
  if (path === "/api/chat.update" && method === "POST") {
    const channel = body?.channel ?? "";
    const ts = body?.ts ?? "";
    const text = body?.text ?? "";
    return okJson(res, {
      channel,
      ts,
      text,
      message: { ts, user: "U_BOT", text },
    });
  }

  // POST /api/reactions.add
  if (path === "/api/reactions.add" && method === "POST") {
    const channel = body?.channel ?? "";
    const ts = body?.timestamp ?? body?.ts ?? "";
    const name = body?.name ?? "";
    state.reactions.push({ channel, ts, name });
    return okJson(res, {});
  }

  // GET /api/search.messages?query=...
  if (path === "/api/search.messages" && method === "GET") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const all = [];
    for (const [channel, msgs] of Object.entries(state.historyByChannel)) {
      for (const m of msgs) {
        if (String(m.text).toLowerCase().includes(query)) {
          all.push({
            type: "message",
            channel: { id: channel, name: state.channels.find((c) => c.id === channel)?.name ?? "" },
            ts: m.ts,
            user: m.user,
            text: m.text,
            permalink: `https://acme.slack.com/archives/${channel}/p${m.ts.replace(".", "")}`,
          });
        }
      }
    }
    return okJson(res, {
      messages: { total: all.length, matches: all },
    });
  }

  return errJson(res, `mock: no route for ${method} ${path}`);
}
