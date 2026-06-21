/**
 * Typed Kiro IDE state client.
 *
 * Kiro is an emerging IDE; its daemon/socket protocol is not yet a public,
 * fully documented surface. The client is structured around a `Client`
 * interface so the transport (Unix socket vs. local HTTP) and the wire
 * shape can change without touching the tool handlers.
 *
 * Two transport implementations are provided:
 *   - `socketClient`     — speaks to the Kiro daemon over a Unix socket
 *                          (default: /tmp/kiro.sock). JSON over the socket.
 *   - `httpClient`       — speaks to the Kiro daemon over local HTTP
 *                          (e.g. http://127.0.0.1:9123). JSON over fetch.
 *
 * `createClient(config)` picks the transport at startup time. If both are
 * configured, the socket wins. The wire is a thin JSON envelope; the
 * payload shapes are derived from Kiro's evolving MCP spec — see the
 * README for current assumptions and the list of endpoints we expect.
 *
 * The endpoints the client expects (all GET unless noted):
 *   GET  /v1/state/open-files              — list of files currently open
 *   GET  /v1/state/selection               — current editor selection
 *   GET  /v1/tasks/active                  — pending + running task queue
 *   GET  /v1/agents/runs?limit=N           — recent agent runs
 *
 * All endpoints scope to the workspace id passed in the `X-Kiro-Workspace`
 * header. The model never gets to choose a different workspace.
 */

import type { Config } from "./config.js";

export class KiroApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "KiroApiError";
  }
}

export interface OpenFile {
  /** Absolute path of the file open in the editor. */
  path: string;
  /** Optional logical name (e.g. the project-relative path or a tab label). */
  name?: string;
  /** True if this is the active/focused tab. */
  active?: boolean;
  /** True if the file has unsaved changes. */
  dirty?: boolean;
  /** Optional language identifier (e.g. "typescript", "python"). */
  language?: string;
}

export interface Selection {
  /** Absolute path of the file containing the selection. */
  filePath: string;
  /** Inclusive 1-based start line. */
  startLine: number;
  /** Inclusive 1-based end line. */
  endLine: number;
  /** Optional start column (1-based, inclusive). */
  startColumn?: number;
  /** Optional end column (1-based, inclusive). */
  endColumn?: number;
  /** The selected text, if the daemon returns it. */
  text?: string;
}

export type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface KiroTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** ISO-8601 timestamp the task was created. */
  createdAt: string;
  /** ISO-8601 timestamp the task started running, if applicable. */
  startedAt?: string;
  /** ISO-8601 timestamp the task completed/failed, if applicable. */
  finishedAt?: string;
  /** Optional agent that owns this task. */
  agent?: string;
  /** Optional progress (0-100). */
  progress?: number;
  /** Free-form detail (e.g. error message, current step). */
  detail?: string;
}

export type AgentRunStatus = "running" | "succeeded" | "failed" | "cancelled" | "aborted";

export interface AgentRun {
  id: string;
  /** The agent that executed the run (e.g. "kiro.refactor"). */
  agent: string;
  /** Short title or summary of what the run did. */
  title: string;
  status: AgentRunStatus;
  /** ISO-8601 timestamp the run started. */
  startedAt: string;
  /** ISO-8601 timestamp the run finished, if applicable. */
  finishedAt?: string;
  /** Optional token usage or other cost signals. */
  tokens?: number;
  /** Optional free-form summary or output reference. */
  summary?: string;
}

export interface Client {
  getOpenFiles(): Promise<OpenFile[]>;
  getCurrentSelection(): Promise<Selection | null>;
  getActiveTaskQueue(): Promise<KiroTask[]>;
  getAgentRunHistory(args: { limit?: number }): Promise<AgentRun[]>;
}

interface TransportRequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

interface Transport {
  request<T>(opts: TransportRequestOptions): Promise<T>;
  close(): void;
}

// ---------------------------------------------------------------------------
// HTTP transport (fetch over local HTTP).
// ---------------------------------------------------------------------------

class HttpTransport implements Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
    private readonly workspaceId: string,
    private readonly userAgent: string,
  ) {}

  async request<T>(opts: TransportRequestOptions): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${opts.path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.authToken}`,
      "x-kiro-workspace": this.workspaceId,
      "user-agent": this.userAgent,
      accept: "application/json",
    };
    const init: RequestInit = { method: opts.method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const message =
        (parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : `HTTP ${res.status}`) || `HTTP ${res.status}`;
      throw new KiroApiError(
        `Kiro daemon error: ${opts.method} ${opts.path} → ${res.status} ${message}`,
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }

  close(): void {
    // fetch has no persistent connection to close.
  }
}

// ---------------------------------------------------------------------------
// Unix socket transport (raw JSON over the socket).
//
// Node's `net` module is used to open a fresh connection per request. The
// daemon is expected to close the connection after responding (or to keep
// it open and stream a terminator; the Kiro daemon's spec is still
// evolving, so we keep this simple and one-shot).
// ---------------------------------------------------------------------------

import { Socket } from "node:net";

class SocketTransport implements Transport {
  private readonly socketPath: string;
  private readonly authToken: string;
  private readonly workspaceId: string;
  private readonly userAgent: string;

  constructor(
    socketPath: string,
    authToken: string,
    workspaceId: string,
    userAgent: string,
  ) {
    this.socketPath = socketPath;
    this.authToken = authToken;
    this.workspaceId = workspaceId;
    this.userAgent = userAgent;
  }

  private rawRequest(payload: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        sock.destroy(new Error("kiro socket request timed out"));
      }, 5_000);
      sock.setNoDelay(true);
      sock.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      sock.on("data", (c) => {
        // The 'data' event in newer @types/node is typed as Uint8Array;
        // coerce to Buffer for our local use.
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      });
      sock.once("close", () => {
        clearTimeout(timeout);
        // Buffer.concat's signature in newer @types/node is generic over
        // ArrayBufferLike; cast through Uint8Array to bridge the lib types.
        const text = Buffer.concat(chunks as unknown as Uint8Array[]).toString("utf8");
        if (!text) {
          reject(new Error("kiro socket closed with no data"));
          return;
        }
        resolve(text);
      });
      sock.connect(this.socketPath, () => {
        sock.write(payload);
        sock.end();
      });
    });
  }

  async request<T>(opts: TransportRequestOptions): Promise<T> {
    const envelope = {
      method: opts.method,
      path: opts.path,
      body: opts.body ?? null,
      headers: {
        authorization: `Bearer ${this.authToken}`,
        "x-kiro-workspace": this.workspaceId,
        "user-agent": this.userAgent,
      },
    };
    const text = await this.rawRequest(JSON.stringify(envelope));
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new KiroApiError(
        `Kiro socket returned non-JSON response for ${opts.method} ${opts.path}`,
        0,
        text,
      );
    }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const errObj = (parsed as { error: { message?: string; status?: number } }).error;
      const status = errObj.status ?? 500;
      throw new KiroApiError(
        `Kiro daemon error: ${opts.method} ${opts.path} → ${status} ${errObj.message ?? "unknown"}`,
        status,
        parsed,
      );
    }
    if (parsed && typeof parsed === "object" && "result" in parsed) {
      return (parsed as { result: T }).result;
    }
    return parsed as T;
  }

  close(): void {
    // The socket transport is one-shot per request; nothing to close.
  }
}

// ---------------------------------------------------------------------------
// Client factory.
// ---------------------------------------------------------------------------

export function createClient(config: Config): {
  client: Client;
  workspaceId: string;
  transportKind: "socket" | "http";
} {
  const transport: Transport = config.httpBaseUrl
    ? new HttpTransport(
        config.httpBaseUrl,
        config.authToken,
        config.workspaceId,
        config.userAgent,
      )
    : new SocketTransport(
        config.socketPath,
        config.authToken,
        config.workspaceId,
        config.userAgent,
      );

  const transportKind: "socket" | "http" = config.httpBaseUrl ? "http" : "socket";

  async function req<T>(path: string): Promise<T> {
    return transport.request<T>({ method: "GET", path });
  }

  const client: Client = {
    async getOpenFiles() {
      const res = await req<{ files?: OpenFile[] } | OpenFile[]>("/v1/state/open-files");
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.files)) return res.files;
      return [];
    },

    async getCurrentSelection() {
      // Kiro's spec may return `{ selection: null }` when nothing is selected;
      // the tool surfaces a null selection as "no selection".
      const res = await req<{ selection?: Selection | null } | Selection | null>(
        "/v1/state/selection",
      );
      if (res === null) return null;
      if (res && typeof res === "object" && "selection" in res) {
        return (res as { selection: Selection | null }).selection ?? null;
      }
      return res as Selection;
    },

    async getActiveTaskQueue() {
      const res = await req<{ tasks?: KiroTask[] } | KiroTask[]>("/v1/tasks/active");
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.tasks)) return res.tasks;
      return [];
    },

    async getAgentRunHistory({ limit = 25 } = {}) {
      const safeLimit = Math.max(1, Math.min(limit, 200));
      const res = await req<{ runs?: AgentRun[] } | AgentRun[]>(
        `/v1/agents/runs?limit=${safeLimit}`,
      );
      if (Array.isArray(res)) return res;
      if (res && Array.isArray(res.runs)) return res.runs;
      return [];
    },
  };

  return { client, workspaceId: config.workspaceId, transportKind };
}
