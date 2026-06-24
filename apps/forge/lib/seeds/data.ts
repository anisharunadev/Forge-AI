/**
 * Seeds — async data seam (Plan F — frontend API client).
 *
 * Thin server fetchers for the 8 `/api/v1/seeds/*` endpoints exposed
 * by the Plan C backend (`backend/app/api/v1/seeds.py`). Each function
 * delegates to the shared `forgeFetch` from `lib/forge-api.ts` so
 * `x-forge-tenant-id` propagation, JSON parsing, and `ForgeApiError`
 * surface identically to the other domain seams
 * (`lib/connectors/data.ts`, `lib/settings/data.ts`).
 *
 * The TanStack Query wrappers in `lib/hooks/useSeeds.ts` are the
 * primary call site for client components. Server components can
 * import the fetchers here directly.
 */

import { forgeFetch } from '@/lib/forge-api';

import type {
  SeedApplyRequest,
  SeedDiffRead,
  SeedManifestRead,
  SeedManifestSummary,
  SeedResetRequest,
  SeedRunRead,
  SeedStatusRead,
} from './types';

const SEEDS_PATH = '/api/v1/seeds';

/** `GET /api/v1/seeds` — manifest summaries for the picker / list view. */
export async function listSeeds(): Promise<SeedManifestSummary[]> {
  return forgeFetch<SeedManifestSummary[]>(SEEDS_PATH);
}

/** `GET /api/v1/seeds/{name}` — full manifest with data files + counts. */
export async function getSeed(name: string): Promise<SeedManifestRead> {
  return forgeFetch<SeedManifestRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}`,
  );
}

/** `GET /api/v1/seeds/{name}/status` — applied? checksum? drift? */
export async function getSeedStatus(name: string): Promise<SeedStatusRead> {
  return forgeFetch<SeedStatusRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/status`,
  );
}

/** `GET /api/v1/seeds/{name}/diff` — live-vs-manifest delta. */
export async function getSeedDiff(name: string): Promise<SeedDiffRead> {
  return forgeFetch<SeedDiffRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/diff`,
  );
}

/** `GET /api/v1/seeds/{name}/runs` — recent apply/reset/rollback history. */
export async function getSeedRuns(name: string): Promise<SeedRunRead[]> {
  return forgeFetch<SeedRunRead[]>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/runs`,
  );
}

/** `POST /api/v1/seeds/{name}/apply` — idempotent re-apply. */
export async function applySeed(
  name: string,
  body: SeedApplyRequest = {},
): Promise<SeedRunRead> {
  return forgeFetch<SeedRunRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/** `POST /api/v1/seeds/{name}/reset` — `scope` controls how aggressive. */
export async function resetSeed(
  name: string,
  body: SeedResetRequest,
): Promise<SeedRunRead> {
  return forgeFetch<SeedRunRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/reset`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/** `POST /api/v1/seeds/{name}/rollback` — undo the most recent apply. */
export async function rollbackSeed(name: string): Promise<SeedRunRead> {
  return forgeFetch<SeedRunRead>(
    `${SEEDS_PATH}/${encodeURIComponent(name)}/rollback`,
    {
      method: 'POST',
    },
  );
}
