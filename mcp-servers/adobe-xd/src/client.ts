/**
 * Typed Adobe XD API client, scoped to a single file + project.
 *
 * IMPORTANT: Adobe XD's public API surface is evolving and at the time of
 * this scaffold is not a stable, broadly documented REST API. The routes
 * below are scaffolded against Adobe's CC Asset / Creative SDK patterns
 * (REST + OAuth2 bearer) and the publicly stated direction of the XD
 * platform. They should be re-validated against Adobe's current docs
 * before shipping production traffic. See `docs/README.md` for the
 * review-triggering assumptions called out at scaffold time.
 *
 * Endpoints assumed (flagged for review):
 *   GET  /v1/files/{fileId}                       — file metadata + asset list
 *   GET  /v1/files/{fileId}/assets/{assetId}     — single asset (design art)
 *   GET  /v1/files/{fileId}/components            — components in the file
 *   GET  /v1/files/{fileId}/spec?format=…        — design spec export
 *   GET  /v1/files/{fileId}/tokens                — extracted design tokens
 *
 * Auth: `Authorization: Bearer <ADOBE_XD_ACCESS_TOKEN>` (OAuth2).
 *
 * The model can pass asset IDs, but the fileId is pinned at startup and
 * embedded in every URL by this client. The project scope is asserted at
 * startup in `index.ts` (single liveness call to the file endpoint).
 */

import type { Config } from "./config.js";

export class AdobeXdApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "AdobeXdApiError";
  }
}

/** A single XD file's metadata + asset inventory (slim view). */
export interface Asset {
  id: string;
  name: string;
  type: "artboard" | "component" | "shape" | "symbol" | "group" | string;
  thumbnailUrl?: string;
  [extra: string]: unknown;
}

export interface FileDocument {
  id: string;
  name: string;
  projectId: string;
  lastModified: string;
  assets: Asset[];
  components: Component[];
}

export interface Component {
  id: string;
  name: string;
  description?: string;
  /** Reference to the underlying asset for render/export. */
  assetId: string;
  [extra: string]: unknown;
}

/** Extracted design tokens — colors, typography, spacing. */
export interface DesignTokens {
  colors: Array<{ name: string; value: string; scope?: string }>;
  typography: Array<{
    name: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight?: number;
  }>;
  spacing: Array<{ name: string; value: number }>;
}

/** A design spec export payload. */
export interface DesignSpec {
  fileId: string;
  format: SpecFormat;
  generatedAt: string;
  /** Spec entries keyed by asset id; shape depends on `format`. */
  entries: Record<string, SpecEntry>;
}

export type SpecFormat = "json" | "css" | "scss";

export interface SpecEntry {
  assetId: string;
  name: string;
  width: number;
  height: number;
  fills?: Array<{ type: string; value: string }>;
  strokes?: Array<{ type: string; value: string }>;
  effects?: Array<{ type: string; value: string }>;
  text?: {
    characters: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
  };
}

export interface Client {
  getAsset(args: { asset_id: string }): Promise<Asset>;
  listComponents(args: { file_id?: string }): Promise<{ components: Component[] }>;
  exportSpec(args: { file_id?: string; format: SpecFormat }): Promise<DesignSpec>;
  getDesignTokens(args: { file_id?: string }): Promise<DesignTokens>;
  /** Internal: used by index.ts for startup liveness / project-scope assertion. */
  getFile(args?: { file_id?: string }): Promise<FileDocument>;
}

const ADOBE_XD_API_DEFAULT_BASE = "https://xd.adobe.io";
const MAX_COMPONENTS_PER_CALL = 100;

export function createClient(config: Config): {
  client: Client;
  fileId: string;
  projectId: string;
} {
  const baseUrl = (config.apiBaseUrl ?? ADOBE_XD_API_DEFAULT_BASE).replace(/\/$/, "");
  const fileId = config.fileId;
  const projectId = config.projectId;

  const headers: Record<string, string> = {
    authorization: `Bearer ${config.accessToken}`,
    "user-agent": config.userAgent,
    accept: "application/json",
    // Adobe IMS tokens are scoped by client_id; x-api-key is the standard
    // header Adobe services expect alongside the bearer.
    "x-api-key": config.accessToken === "test" ? "forge-mcp-test" : config.accessToken,
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
      throw new AdobeXdApiError(
        `Adobe XD API error: ${method} ${path} → ${res.status} ${message}`,
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }

  function filePath(suffix: string): string {
    // fileId is always pinned at startup — never trust a caller-supplied
    // fileId over the server-pinned one, even if the tool signature accepts
    // it (it does, for forward-compat, but the client always uses `fileId`).
    return `/v1/files/${encodeURIComponent(fileId)}${suffix}`;
  }

  const client: Client = {
    async getAsset({ asset_id }) {
      if (!asset_id || asset_id.trim().length === 0) {
        throw new Error("get_asset requires a non-empty asset_id");
      }
      return request<Asset>(
        "GET",
        filePath(`/assets/${encodeURIComponent(asset_id)}`),
      );
    },

    async listComponents(_args) {
      const query = new URLSearchParams({
        projectId,
        limit: String(MAX_COMPONENTS_PER_CALL),
      });
      return request<{ components: Component[] }>(
        "GET",
        `${filePath("/components")}?${query.toString()}`,
      );
    },

    async exportSpec({ format }) {
      if (!["json", "css", "scss"].includes(format)) {
        throw new Error(
          `export_spec: unsupported format '${format}'. Use 'json', 'css', or 'scss'.`,
        );
      }
      const query = new URLSearchParams({ format, projectId });
      return request<DesignSpec>(
        "GET",
        `${filePath("/spec")}?${query.toString()}`,
      );
    },

    async getDesignTokens(_args) {
      const query = new URLSearchParams({ projectId });
      return request<DesignTokens>(
        "GET",
        `${filePath("/tokens")}?${query.toString()}`,
      );
    },

    async getFile(_args) {
      const query = new URLSearchParams({ projectId });
      return request<FileDocument>(
        "GET",
        `${filePath("")}?${query.toString()}`,
      );
    },
  };

  return { client, fileId, projectId };
}
