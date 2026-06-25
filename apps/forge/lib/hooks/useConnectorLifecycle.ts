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
 * The thin server fetchers live alongside the typed `McpConnector`
 * shapes in `lib/connectors/data.ts` so server-rendered surfaces and
 * client-rendered surfaces consume the same payload. The hooks in
 * this file are pure TanStack Query wrappers — same shape as
 * `usePushIdeaToJira` and `useApprovalDecide`.
 */

import { useMutation } from '@tanstack/react-query';

import {
  installConnector,
  rotateConnector,
  testConnector,
  type InstallConnectorInput,
  type InstallConnectorResult,
  type RotateConnectorResult,
  type TestConnectorResult,
} from '@/lib/connectors/data';

/** Stable query keys so the mutation cache survives HMR / route changes. */
export const connectorLifecycleQueryKeys = {
  detail: (id: string) => ['connectors', 'lifecycle', id] as const,
  list: () => ['connectors', 'lifecycle', 'list'] as const,
};

/**
 * Install a new connector. Used by `<AddConnectorDialog>` and the
 * marketplace "Install" button.
 */
export function useInstallConnector() {
  return useMutation<InstallConnectorResult, Error, InstallConnectorInput>({
    mutationFn: (input) => installConnector(input),
  });
}

/**
 * Rotate a connector's credentials. Opens a modal so the user can
 * paste the new secret; the hook only ships the credentials shape.
 */
export function useRotateConnector(connectorId: string) {
  return useMutation<RotateConnectorResult, Error, { new_credentials: Record<string, unknown> }>({
    mutationFn: (input) => rotateConnector(connectorId, input),
  });
}

/**
 * Run a live test against the connector. Returns the orchestrator's
 * `ok` + `latency_ms` so the UI can show a receipt.
 */
export function useTestConnector(connectorId: string) {
  return useMutation<TestConnectorResult, Error, void>({
    mutationFn: () => testConnector(connectorId),
  });
}
