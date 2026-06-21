import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Single catch-all proxy to the orchestrator dev stub. Replaces the
 * need for one Next.js route file per backend endpoint.
 *
 * GET  /api/proxy/v1/governance/policies           →  http://localhost:4000/v1/governance/policies
 * POST /api/proxy/v1/governance/approvals/{id}/accept → http://localhost:4000/...
 *
 * The dev stub may bind to any free port (4000 → 4002 → ...). It
 * writes its bound port to `apps/forge/.stub-port` at startup. We
 * read that here so the UI keeps working without exporting
 * FORA_FORGE_API_URL every shell session.
 *
 * Why a single catch-all instead of N route files?
 *   - 1 file vs ~45 route files for the 13 domains
 *   - the orchestrator URL surface is the source of truth
 *   - tenant_id / x-fora-tenant-id header is injected here once
 *
 * Set `FORA_FORGE_API_URL` to override; otherwise the file
 * `.stub-port` next to package.json drives resolution.
 */

export const dynamic = 'force-dynamic';

function resolveBaseUrl(): string {
  const env = process.env.FORA_FORGE_API_URL;
  if (env && env.length > 0) return env.replace(/\/$/, '');
  try {
    // Use dynamic import — works in both Node and edge runtimes.
    // Falls back to :4000 when the stub hasn't been started or when
    // the file isn't accessible (e.g. in serverless deployments).
    const fs = (globalThis as { fs?: typeof import('node:fs') }).fs ?? require('node:fs');
    const nodePath = (globalThis as { nodePath?: typeof import('node:path') }).nodePath ?? require('node:path');
    const portFile = nodePath.join(process.cwd(), '.stub-port');
    if (fs.existsSync(portFile)) {
      const port = fs.readFileSync(portFile, 'utf8').trim();
      if (port && /^\d+$/.test(port)) return `http://localhost:${port}`;
    }
  } catch {
    /* fs unavailable in edge runtime; fall through to default */
  }
  return 'http://localhost:4000';
}

const DEV_TENANT_UUID = '00000000-0000-4000-8000-000000000ace';

async function proxy(req: NextRequest, _paramsPromise?: Promise<{ path?: string[] }>) {
  // Derive the path from the request URL directly. This is more
  // robust than depending on the dynamic-params shape, which has
  // shifted across Next.js 13/14/15. The catch-all `[...path]`
  // segment of this route is everything after `/api/proxy/`.
  const url = new URL(req.url);
  const prefix = '/api/proxy/';
  const idx = url.pathname.indexOf(prefix);
  const path =
    idx >= 0
      ? url.pathname.slice(idx + prefix.length).replace(/\/+$/, '')
      : url.pathname.replace(/^\/+/, '');
  const search = url.search ?? '';
  const target = `${resolveBaseUrl()}/${path}`;

  // Forward request headers; inject the single-tenant header (Rule 2).
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (['host', 'content-length'].includes(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  if (!headers.has('x-fora-tenant-id')) {
    headers.set('x-fora-tenant-id', DEV_TENANT_UUID);
  }

  // Pass-through persona cookie so backend can pattern-match RBAC.
  const cookieStore = await cookies();
  const persona = cookieStore.get('forge.persona')?.value;
  if (persona && !headers.has('cookie')) {
    headers.set('cookie', `forge.persona=${persona}`);
  }

  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) body = buf;
  }

  let res: Response;
  try {
    res = await fetch(`${target}${search}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'orchestrator_unreachable', message: msg },
      { status: 502 },
    );
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    statusText: res.statusText,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'x-orchestrator-proxy': '1',
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;