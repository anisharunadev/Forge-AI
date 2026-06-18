/**
 * Typed Figma REST v1 client, scoped to a single file.
 *
 * The MCP server only ever calls these methods. Every method embeds the
 * pinned `fileKey` in the URL — the model never gets to pass a different
 * file key. If a tool ever needs to accept an ID from the model, it is
 * validated against the shape of a Figma node_id (e.g. `1:2`) before any
 * call lands, but the file itself is fixed by the server.
 *
 * Figma's REST v1 surface is documented at:
 *   https://www.figma.com/developers/api
 *
 * The endpoints we use:
 *   GET  /v1/files/{key}                  — full file document
 *   GET  /v1/files/{key}/nodes?ids=…      — specific nodes
 *   GET  /v1/images/{key}?ids=…&format=…  — image renders
 *   GET  /v1/files/{key}/comments         — paginated via `after`
 *   POST /v1/files/{key}/comments         — create a comment
 *
 * Auth is the `X-Figma-Token` header (Figma's documented auth header for
 * personal access tokens). There is no SDK for the public REST v1 surface
 * that we want to depend on, so this client is hand-rolled over `fetch`.
 */

import type { Config } from "./config.js";

/**
 * The model can pass node IDs, never a file key. We don't expose a
 * FileScopeError the way the GitHub client exposes OrgScopeError because
 * the file is fixed in the URL — there's no per-call check to do. The
 * team scope is asserted at startup in `index.ts` (a single liveness call
 * to the file endpoint) so a misconfigured token fails fast.
 */

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "FigmaApiError";
  }
}

export interface Client {
  getFile(): Promise<FileDocument>;
  getFileNodes(args: { node_ids: string[]; depth?: number }): Promise<NodeLookup>;
  getNode(args: { node_id: string; depth?: number }): Promise<NodeWrapper>;
  getImages(args: {
    node_ids: string[];
    format?: "jpg" | "png" | "svg" | "pdf";
    scale?: number;
  }): Promise<Record<string, string>>;
  getComments(args: { as_md?: boolean; after?: string }): Promise<{
    comments: Comment[];
    next?: string;
  }>;
  postComment(args: {
    message: string;
    client_meta?: { x: number; y: number };
  }): Promise<Comment>;
}

/** File document — a slim view of Figma's full GET /v1/files/{key} response. */
export interface FileDocument {
  name: string;
  role: "owner" | "viewer" | "editor" | string;
  lastModified: string;
  editorType: "figma" | "figjam" | string;
  thumbnailUrl: string;
  version: string;
  document: Node;
  components: Record<string, Component>;
  styles: Record<string, Style>;
}

export interface Node {
  id: string;
  name: string;
  type: string;
  children?: Node[];
  [extra: string]: unknown;
}

export interface Component {
  key: string;
  name: string;
  description: string;
}

export interface Style {
  key: string;
  name: string;
  styleType: string;
}

export interface NodeLookup {
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  nodes: Record<string, NodeWrapper>;
}

/** Figma's per-node wrapper for /v1/files/{key}/nodes. */
export interface NodeWrapper {
  document: Node;
  components: Record<string, Component>;
  styles: Record<string, Style>;
}

export interface Comment {
  id: string;
  message: string;
  client_meta?: { x: number; y: number };
  created_at: string;
  resolved_at: string | null;
  order_id?: string;
  parent_id?: string | null;
  user: { id: string; handle: string; img_url?: string };
}

const FIGMA_API_DEFAULT_BASE = "https://api.figma.com";
const MAX_IDS_PER_NODE_CALL = 50; // Figma's documented cap for /v1/files/{key}/nodes

export function createClient(config: Config): {
  client: Client;
  fileKey: string;
  teamId: string;
} {
  const baseUrl = (config.apiBaseUrl ?? FIGMA_API_DEFAULT_BASE).replace(/\/$/, "");
  const fileKey = config.fileKey;
  const teamId = config.teamId;

  const headers: Record<string, string> = {
    "X-Figma-Token": config.token,
    "user-agent": config.userAgent,
    accept: "application/json",
  };

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      (init.headers as Record<string, string>)["content-type"] = "application/json";
      init.body = JSON.stringify(body);
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
      throw new FigmaApiError(
        `Figma API error: ${method} ${path} → ${res.status} ${message}`,
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }

  /**
   * Figma's REST v1 endpoints accept a comma-separated list of node ids
   * (e.g. `?ids=1:2,1:3`). Colons and commas are both valid inside a
   * URL query value, so we join without URI-encoding — putting an
   * `encodeURIComponent` here would double-encode the `%3A` after
   * URLSearchParams re-encodes the whole value, and the mock (and the
   * real Figma API) would receive `1%3A2%2C1%3A3` instead of `1:2,1:3`.
   */
  function encodeNodeIds(ids: string[]): string {
    return ids.join(",");
  }

  const client: Client = {
    async getFile() {
      return request<FileDocument>("GET", `/v1/files/${encodeURIComponent(fileKey)}`);
    },

    async getFileNodes({ node_ids, depth }) {
      if (node_ids.length === 0) {
        throw new Error("get_file_nodes requires at least one node id");
      }
      if (node_ids.length > MAX_IDS_PER_NODE_CALL) {
        throw new Error(
          `get_file_nodes accepts at most ${MAX_IDS_PER_NODE_CALL} node ids per call (got ${node_ids.length})`,
        );
      }
      const query = new URLSearchParams({ ids: encodeNodeIds(node_ids) });
      if (depth !== undefined) query.set("depth", String(depth));
      return request<NodeLookup>(
        "GET",
        `/v1/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`,
      );
    },

    async getNode({ node_id, depth }) {
      const lookup = await client.getFileNodes({ node_ids: [node_id], depth });
      const wrapper = lookup.nodes[node_id];
      if (!wrapper) {
        throw new Error(
          `get_node: node '${node_id}' not found in pinned file '${fileKey}'`,
        );
      }
      return wrapper;
    },

    async getImages({ node_ids, format = "png", scale }) {
      if (node_ids.length === 0) {
        throw new Error("get_images requires at least one node id");
      }
      const query = new URLSearchParams({
        ids: encodeNodeIds(node_ids),
        format,
      });
      if (scale !== undefined) query.set("scale", String(scale));
      type ImagesResponse = { err: string | null; images: Record<string, string> };
      const res = await request<ImagesResponse>(
        "GET",
        `/v1/images/${encodeURIComponent(fileKey)}?${query.toString()}`,
      );
      if (res.err) {
        throw new FigmaApiError(
          `Figma get_images returned err: ${res.err}`,
          200,
          res,
        );
      }
      return res.images;
    },

    async getComments({ as_md = true, after } = {}) {
      const query = new URLSearchParams({ as_md: String(as_md) });
      if (after !== undefined) query.set("after", after);
      // Contract drift from github: Figma's comments endpoint does not
      // paginate by default — the public REST API returns all comments for
      // the file in a single response. The `after` cursor is exposed for
      // forward-compat with any future cursor support and is exercised by
      // the smoke mock. If Figma's API does not return a `cursor` field
      // (i.e. it returns everything in one shot), the `next` field on the
      // response is undefined and the caller knows there is nothing more.
      const res = await request<{
        comments: Comment[];
        cursor?: string;
      }>(
        "GET",
        `/v1/files/${encodeURIComponent(fileKey)}/comments?${query.toString()}`,
      );
      return { comments: res.comments, next: res.cursor };
    },

    async postComment({ message, client_meta }) {
      if (!message || message.trim().length === 0) {
        throw new Error("post_comment requires a non-empty message");
      }
      const body: Record<string, unknown> = { message };
      if (client_meta) body.client_meta = client_meta;
      return request<Comment>(
        "POST",
        `/v1/files/${encodeURIComponent(fileKey)}/comments`,
        body,
      );
    },
  };

  return { client, fileKey, teamId };
}
