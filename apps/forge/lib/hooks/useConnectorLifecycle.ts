'use client';

/**
 * TanStack Query hooks for the Connector Center lifecycle actions
 * (Forge AI-440 / Pillar 1 Phase 4 — FORA-580/591).
 *
 * Three mutations back the Connector Center buttons:
 *
 *   - `useInstallConnector` — POST /api/v1/connectors/install
 *   - `useRotateConnector`  — POST /api/v1/connectors/{id}/rotate
 *   - `useTestConnector`    — POST /api/v1/connectors/{id}/test
 *
 * Each call sends a fresh `Idempotency-Key` so duplicate clicks
 * (network retries, double-clicks) are safely deduplicated server-side
 * — matches the contract in `lib/api.ts::request<T>`.
 *
 * The thin server fetchers live in `lib/connectors/api.ts` (the
 * canonical typed wire client). The result shapes for rotate + test
 * are inlined here because their endpoints don't ship a typed client
 * yet — once they do, hoist these to `api.ts`.
 */

import { useMutation } from '@tanstack/react-query';

import * as api from '@/lib/connectors/api';
import type { ConnectorWire } from '@/lib/connectors/types';

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const connectorLifecycleQueryKeys = {
  detail: (id: string) => ['connectors', 'lifecycle', id] as const,
  list: () => ['connectors', 'lifecycle', 'list'] as const,
};

/** Rotate result — backend returns the rotated envelope. Ponytail: inline until typed. */
export interface RotateConnectorResult {
  readonly job_id?: string;
  readonly rotated_at?: string;
}

/** Test result — orchestrator surfaces the live probe receipt. Ponytail: inline until typed. */
export interface TestConnectorResult {
  readonly detail?: string;
  readonly latency_ms?: number;
}

/**
 * Install a new connector. Used by `<AddConnectorDialog>` and the
 * marketplace "Install" button.
 */
export function useInstallConnector() {
  return useMutation<ConnectorWire, Error, api.InstallConnectorInput>({
    mutationFn: (input) => api.installConnector(input),
  });
}

/**
 * Rotate a connector's credentials. Opens a modal so the user can
 * paste the new secret; the hook only ships the credentials shape.
 * Ponytail: thin inline fetcher — no typed client for /rotate yet.
 */
export function useRotateConnector(connectorId: string) {
  return useMutation<RotateConnectorResult, Error, { new_credentials: Record<string, unknown> }>({
    mutationFn: async (input) => {
      const secret = String(input.new_credentials?.value ?? '');
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`;
      const res = await fetch(
        `${(process.env.NEXT_PUBLIC_FORGE_API_URL ?? process.env.FORA_FORGE_API_URL ?? 'http://localhost:8000')}/api/v1/connectors/${encodeURIComponent(connectorId)}/rotate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify({ secret }),
        },
      );
      if (!res.ok) throw new Error(`rotate failed: ${res.status}`);
      return (await res.json().catch(() => ({}))) as RotateConnectorResult;
    },
  });
}

/**
 * Run a live test against the connector. Returns the orchestrator's
 * `ok` + `latency_ms` so the UI can show a receipt.
 * Ponytail: thin inline fetcher — no typed client for /test yet.
 */
export function useTestConnector(connectorId: string) {
  return useMutation<TestConnectorResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(
        `${(process.env.NEXT_PUBLIC_FORGE_API_URL ?? process.env.FORA_FORGE_API_URL ?? 'http://localhost:8000')}/api/v1/connectors/${encodeURIComponent(connectorId)}/test`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`test failed: ${res.status}`);
      return (await res.json().catch(() => ({}))) as TestConnectorResult;
    },
  });
}
