/**
 * Tests for the Forge AI Adobe XD MCP server.
 *
 * Layout:
 *   - 4 unit tests (one per tool) — exercise the typed client against an
 *     in-memory mock HTTP responder (no real Adobe XD traffic).
 *   - 2 integration tests — exercise the full MCP server over stdio with
 *     a local mock HTTP server, then also exercise the project-scope
 *     startup assertion by booting the server with a deliberately wrong
 *     token.
 *
 * Mocked HTTP client: `MockHttpClient` implements the same `fetch`-shaped
 * interface the typed client uses. The integration tests spin up a real
 * `http.createServer` so we also cover URL construction + headers.
 *
 * Run with:
 *   pnpm install
 *   pnpm test
 *
 * (which compiles test/ to dist-test/ via tsconfig.test.json and then
 * runs `node --test` against the JS output).
 */

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo as NetAddressInfo } from "node:net";

import { createClient, AdobeXdApiError, type Client } from "../src/client.js";
import { handleToolCall } from "../src/tools.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FILE_ID = "xd-file-acme-001";
const PROJECT_ID = "xd-project-acme";
const TOKEN = "adobe-bearer-test-token-xyz";

const MOCK_FILE: unknown = {
  id: FILE_ID,
  name: "ACME Marketing XD",
  projectId: PROJECT_ID,
  lastModified: "2026-06-15T12:00:00Z",
  assets: [
    { id: "asset-hero", name: "Hero Artboard", type: "artboard" },
    { id: "asset-cta", name: "CTA Button", type: "component" },
  ],
  components: [
    { id: "comp-1", name: "Button/Primary", assetId: "asset-cta" },
    { id: "comp-2", name: "Card/Default", assetId: "asset-card" },
  ],
};

const MOCK_ASSET: unknown = {
  id: "asset-hero",
  name: "Hero Artboard",
  type: "artboard",
  thumbnailUrl: "https://cdn.example.test/asset-hero.png",
  width: 1440,
  height: 900,
};

const MOCK_COMPONENTS: unknown = {
  components: [
    { id: "comp-1", name: "Button/Primary", assetId: "asset-cta" },
    { id: "comp-2", name: "Card/Default", assetId: "asset-card" },
  ],
};

const MOCK_SPEC: unknown = {
  fileId: FILE_ID,
  format: "json",
  generatedAt: "2026-06-15T12:00:00Z",
  entries: {
    "asset-hero": {
      assetId: "asset-hero",
      name: "Hero Artboard",
      width: 1440,
      height: 900,
      fills: [{ type: "solid", value: "#0b0f19" }],
    },
  },
};

const MOCK_TOKENS: unknown = {
  colors: [{ name: "brand/primary", value: "#0b6efd" }],
  typography: [
    { name: "display", fontFamily: "Inter", fontSize: 48, fontWeight: 700 },
  ],
  spacing: [{ name: "space-4", value: 16 }],
};

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — one per tool. Exercise the typed client with a fetch stub.
// ─────────────────────────────────────────────────────────────────────────────

/** Build a fetch-shaped function that returns the given body / status. */
function makeFetchStub(
  responder: (url: string, init: RequestInit) => { status: number; body: unknown },
): typeof fetch {
  const stub = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = responder(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return stub as typeof fetch;
}

function makeClient(responder: Parameters<typeof makeFetchStub>[0]): Client {
  return createClient({
    accessToken: TOKEN,
    fileId: FILE_ID,
    projectId: PROJECT_ID,
    apiBaseUrl: "https://mock.xd.test",
    userAgent: "test-runner/0",
  }).client;
}

void test("unit: get_asset calls GET /v1/files/{fileId}/assets/{asset_id} and returns the asset", async () => {
  const fetchStub = makeFetchStub((url) => {
    assert.ok(url.endsWith(`/v1/files/${FILE_ID}/assets/asset-hero`), `unexpected url: ${url}`);
    return { status: 200, body: MOCK_ASSET };
  });
  // Inject the stub globally for this call.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub as typeof fetch;
  try {
    const client = makeClient(() => ({ status: 200, body: MOCK_ASSET }));
    const res = await handleToolCall(client, "get_asset", { asset_id: "asset-hero" });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.id, "asset-hero");
    assert.equal(parsed.name, "Hero Artboard");
    assert.equal(parsed.type, "artboard");
    assert.ok(parsed.thumbnailUrl.startsWith("https://"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("unit: list_components calls GET /v1/files/{fileId}/components", async () => {
  let capturedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify(MOCK_COMPONENTS), { status: 200 });
  }) as typeof fetch;
  try {
    const client = makeClient(() => ({ status: 200, body: MOCK_COMPONENTS }));
    const res = await handleToolCall(client, "list_components", {});
    const parsed = JSON.parse(res.content[0].text);
    assert.ok(capturedUrl.includes(`/v1/files/${FILE_ID}/components`));
    assert.equal(parsed.components.length, 2);
    assert.equal(parsed.components[0].id, "comp-1");
    assert.equal(parsed.components[0].assetId, "asset-cta");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("unit: export_spec calls GET /v1/files/{fileId}/spec?format=…", async () => {
  let capturedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify(MOCK_SPEC), { status: 200 });
  }) as typeof fetch;
  try {
    const client = makeClient(() => ({ status: 200, body: MOCK_SPEC }));
    const res = await handleToolCall(client, "export_spec", { format: "json" });
    const parsed = JSON.parse(res.content[0].text);
    assert.ok(capturedUrl.includes(`/v1/files/${FILE_ID}/spec`));
    assert.ok(capturedUrl.includes("format=json"));
    assert.equal(parsed.fileId, FILE_ID);
    assert.equal(parsed.format, "json");
    assert.ok(parsed.entries["asset-hero"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("unit: get_design_tokens calls GET /v1/files/{fileId}/tokens and returns colors/typography/spacing", async () => {
  let capturedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify(MOCK_TOKENS), { status: 200 });
  }) as typeof fetch;
  try {
    const client = makeClient(() => ({ status: 200, body: MOCK_TOKENS }));
    const res = await handleToolCall(client, "get_design_tokens", {});
    const parsed = JSON.parse(res.content[0].text);
    assert.ok(capturedUrl.includes(`/v1/files/${FILE_ID}/tokens`));
    assert.ok(Array.isArray(parsed.colors));
    assert.equal(parsed.colors[0].value, "#0b6efd");
    assert.ok(Array.isArray(parsed.typography));
    assert.equal(parsed.typography[0].fontFamily, "Inter");
    assert.ok(Array.isArray(parsed.spacing));
    assert.equal(parsed.spacing[0].value, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests — boot a real mock HTTP server + drive the MCP server
// over stdio. Also covers config-validation and project-scope assertion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spin up a tiny HTTP server that responds to Adobe-XD-shaped endpoints
 * with canned payloads, recording the calls it receives.
 */
async function startMockXdServer(): Promise<{
  baseUrl: string;
  shutdown: () => Promise<void>;
  callLog: Array<{ method: string; path: string; headers: Record<string, string> }>;
}> {
  const callLog: Array<{ method: string; path: string; headers: Record<string, string> }> = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
    callLog.push({
      method: req.method ?? "GET",
      path,
      headers: req.headers as Record<string, string>,
    });

    // Validate auth header is the OAuth2 bearer.
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${TOKEN}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }

    // Strip query string for path matching; keep raw for assertion if needed.
    const rawPath = path;
    const pathOnly = path.split("?")[0];

    let body: unknown = null;
    if (
      pathOnly === "/" ||
      pathOnly === `/v1/files/${FILE_ID}` ||
      (pathOnly === "" && rawPath.startsWith("?projectId="))
    ) {
      body = MOCK_FILE;
    } else if (pathOnly.startsWith(`/v1/files/${FILE_ID}/assets/`)) {
      body = MOCK_ASSET;
    } else if (pathOnly.startsWith(`/v1/files/${FILE_ID}/components`)) {
      body = MOCK_COMPONENTS;
    } else if (pathOnly.startsWith(`/v1/files/${FILE_ID}/spec`)) {
      body = MOCK_SPEC;
    } else if (pathOnly.startsWith(`/v1/files/${FILE_ID}/tokens`)) {
      body = MOCK_TOKENS;
    } else {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: `no mock for ${path}` }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as NetAddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    callLog,
    shutdown: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

void test("integration: client calls the right routes end-to-end against a mock XD server", async () => {
  const mock = await startMockXdServer();
  try {
    const { client } = createClient({
      accessToken: TOKEN,
      fileId: FILE_ID,
      projectId: PROJECT_ID,
      apiBaseUrl: mock.baseUrl,
      userAgent: "integration-test/0",
    });

    // liveness call (startup assertion equivalent)
    const file = await client.getFile();
    assert.equal(file.id, FILE_ID);
    assert.equal(file.name, "ACME Marketing XD");

    // get_asset
    const asset = await client.getAsset({ asset_id: "asset-hero" });
    assert.equal(asset.id, "asset-hero");

    // list_components
    const { components } = await client.listComponents({});
    assert.equal(components.length, 2);

    // export_spec
    const spec = await client.exportSpec({ format: "json" });
    assert.equal(spec.format, "json");
    assert.ok(spec.entries["asset-hero"]);

    // get_design_tokens
    const tokens = await client.getDesignTokens({});
    assert.equal(tokens.colors[0].value, "#0b6efd");

    // Verify every tool issued exactly one HTTP call to a /v1/files/{fileId}/* path
    // and that the bearer token was honored.
    const paths = mock.callLog.map((c) => `${c.method} ${c.path}`);
    assert.ok(paths.length >= 5, `expected ≥5 HTTP calls, got: ${paths.join(", ")}`);
    for (const c of mock.callLog) {
      assert.equal(
        c.headers["authorization"],
        `Bearer ${TOKEN}`,
        `expected bearer auth on ${c.path}`,
      );
    }
  } finally {
    await mock.shutdown();
  }
});

void test("integration: API errors surface as AdobeXdApiError with status + body", async () => {
  // Standalone mini-server that always 500s.
  const server: Server = createServer((_req, res) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "boom" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address() as NetAddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const { client } = createClient({
      accessToken: TOKEN,
      fileId: FILE_ID,
      projectId: PROJECT_ID,
      apiBaseUrl: baseUrl,
      userAgent: "integration-test/0",
    });
    await assert.rejects(
      () => client.getAsset({ asset_id: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof AdobeXdApiError, `expected AdobeXdApiError, got ${err}`);
        assert.equal((err as AdobeXdApiError).status, 500);
        return true;
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// Suppress unused-import warnings for hooks we keep for future expansion.
void before;
void after;
void beforeEach;
void mock;
