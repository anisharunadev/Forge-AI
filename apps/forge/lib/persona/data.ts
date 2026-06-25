/**
 * Persona memory + ideation ingest data layer (Pillar 1 Phase 3).
 *
 * Mirrors the canonical shape established by `lib/ideation/data.ts` —
 * a thin fetch wrapper around the orchestrator endpoints so the React
 * hooks (`usePersonaMemory`, `useIdeationIngestStatus`) stay TanStack
 * Query wrappers, not fetch sites.
 *
 * Endpoints:
 *   GET  /v1/persona/memory/{key}        → { body, recent_entries[] }
 *   POST /v1/persona/memory/{key}        → { ok: true } (append)
 *   GET  /v1/ideation/ingest/status      → { last_run_at, ideas_created_today, status }
 *
 * The server-side `X-Forge-Persona` header is set by
 * `apps/forge/middleware.ts` so the backend knows which persona's
 * memory file to read/write (persona is also overridden by the
 * `forge.persona` cookie directly on the request).
 */

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

/** A single entry in the persona memory append log. */
export interface PersonaMemoryEntry {
  readonly written_at: string;
  readonly entry_md: string;
}

/** GET /v1/persona/memory/{key} response shape. */
export interface PersonaMemory {
  readonly body: string;
  readonly recent_entries: ReadonlyArray<PersonaMemoryEntry>;
}

/** POST /v1/persona/memory/{key} response shape. */
export interface PersonaMemoryAppendResult {
  readonly ok: true;
}

/**
 * Lifecycle status of the most recent daily ideation ingest run.
 *
 * Mirrors the backend `IdeationIngestStatus` enum at
 * `backend/app/db/models/ideation_signal.py` (added in
 * `0006_ideation_ingest_runs.py`):
 *   - 'success'  — last run completed without errors and at least one
 *                  idea was created from the source signals.
 *   - 'partial'  — last run completed but the synthesizer fell back to
 *                  heuristic clustering (e.g. budget exhaustion).
 *   - 'failed'   — last run threw and was caught; no ideas created.
 *   - 'running'  — a run is currently in flight.
 *   - 'never'    — no run has ever been recorded for this tenant.
 */
export type IdeationIngestStatus =
  | 'success'
  | 'partial'
  | 'failed'
  | 'running'
  | 'never';

/** GET /v1/ideation/ingest/status response shape. */
export interface IdeationIngestStatusPayload {
  readonly last_run_at: string | null;
  readonly ideas_created_today: number;
  readonly status: IdeationIngestStatus;
}

/**
 * Extract a server `OrchestratorError`-style message from a non-OK
 * response body so callers can surface a useful toast without having
 * to parse the body themselves.
 */
async function readServerMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const errBody = (await res.json()) as { message?: unknown };
    if (typeof errBody?.message === 'string') return errBody.message;
  } catch {
    /* non-JSON body — fall through to the status-only fallback */
  }
  return fallback;
}

/**
 * GET /v1/persona/memory/{key} — read the persona-keyed Markdown
 * memory file plus the last 24h of append entries.
 *
 * The endpoint is tenant-scoped: the orchestrator resolves the
 * persona from the `X-Forge-Persona` request header (set by
 * `apps/forge/middleware.ts` from the `forge.persona` cookie).
 */
export async function readPersonaMemory(key: string): Promise<PersonaMemory> {
  const res = await fetch(
    `${SERVER_BASE}/v1/persona/memory/${encodeURIComponent(key)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(
      await readServerMessage(res, `read persona memory failed: ${res.status}`),
    );
  }
  const raw = (await res.json()) as {
    body?: unknown;
    recent_entries?: unknown;
  };
  const body = typeof raw.body === 'string' ? raw.body : '';
  const recentEntries = Array.isArray(raw.recent_entries)
    ? (raw.recent_entries as ReadonlyArray<PersonaMemoryEntry>)
    : [];
  return { body, recent_entries: recentEntries };
}

/**
 * POST /v1/persona/memory/{key} — append a Markdown entry to the
 * persona-keyed memory log. The server returns `{ ok: true }`; the
 * caller is expected to refetch the memory so the UI sees the
 * refreshed body.
 *
 * The `Idempotency-Key` header is set to a fresh UUID per call so a
 * retried click does not double-write the entry (the append-only
 * `persona_memory_history` table would record both).
 */
export async function appendPersonaMemory(
  key: string,
  entryMd: string,
): Promise<PersonaMemoryAppendResult> {
  const idemKey = crypto.randomUUID();
  const res = await fetch(
    `${SERVER_BASE}/v1/persona/memory/${encodeURIComponent(key)}`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({ entry_md: entryMd }),
    },
  );
  if (!res.ok) {
    throw new Error(
      await readServerMessage(
        res,
        `append persona memory failed: ${res.status}`,
      ),
    );
  }
  return { ok: true };
}

/**
 * GET /v1/ideation/ingest/status — read the most-recent daily ingest
 * run for the tenant. Used by `<IngestIndicator>` on the Ideation page
 * header to surface "Last daily ingest: N new ideas".
 */
export async function getIngestStatus(): Promise<IdeationIngestStatusPayload> {
  const res = await fetch(
    `${SERVER_BASE}/v1/ideation/ingest/status`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(
      await readServerMessage(res, `ingest status failed: ${res.status}`),
    );
  }
  const raw = (await res.json()) as {
    last_run_at?: unknown;
    ideas_created_today?: unknown;
    status?: unknown;
  };
  const status = ((): IdeationIngestStatus => {
    switch (raw.status) {
      case 'success':
      case 'partial':
      case 'failed':
      case 'running':
      case 'never':
        return raw.status;
      default:
        return 'never';
    }
  })();
  return {
    last_run_at: typeof raw.last_run_at === 'string' ? raw.last_run_at : null,
    ideas_created_today:
      typeof raw.ideas_created_today === 'number'
        ? raw.ideas_created_today
        : 0,
    status,
  };
}