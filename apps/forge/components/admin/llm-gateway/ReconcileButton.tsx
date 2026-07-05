'use client';

/**
 * ReconcileButton — manual LiteLLM reconciliation trigger.
 *
 * F-829 Phase D. Calls `POST /api/v1/admin/llm-gateway/reconcile` and
 * invalidates the drift / reconcile query keys so the DriftTable
 * re-renders with the new state.
 *
 * Mirrors the existing pattern in `components/admin/SettingsTabs.tsx`
 * (mutation + invalidation via TanStack Query). The button is a plain
 * `<button>` so the host page controls layout / iconography.
 */

import { useState } from 'react';

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import { settingsQueryKeys } from '@/lib/hooks/useSettings';

export interface ReconcileButtonProps {
  /** Tenant id this button reconciles against. */
  readonly tenantId: string;
  /** Optional label override. */
  readonly label?: string;
  /** Optional className passthrough. */
  readonly className?: string;
}

export interface ReconcileResult {
  readonly tenant_id: string;
  readonly status: 'ok' | 'drifted' | 'failed';
  readonly delta_usd: number;
  readonly forge_usd: number;
  readonly litellm_usd: number;
  readonly checked_at: string;
}

async function postReconcile(tenantId: string): Promise<ReconcileResult> {
  return api.post<ReconcileResult>(`/api/v1/admin/llm-gateway/reconcile`, { tenant_id: tenantId }, {
    });
}

export function ReconcileButton(
  props: ReconcileButtonProps,
): React.ReactElement {
  const { tenantId, label = 'Reconcile now', className } = props;
  const qc = useQueryClient();
  const [lastError, setLastError] = useState<string | null>(null);

  const mutation: UseMutationResult<ReconcileResult, Error, void> =
    useMutation<ReconcileResult, Error, void>({
      mutationFn: () => postReconcile(tenantId),
      onSuccess: (data) => {
        setLastError(null);
        void qc.invalidateQueries({
          queryKey: settingsQueryKeys.reconcile(tenantId),
        });
        void qc.invalidateQueries({
          queryKey: settingsQueryKeys.drift(tenantId),
        });
        if (data.status === 'drifted') {
          // Surface a soft hint — the DriftTable component handles
          // the full visual presentation.
          // eslint-disable-next-line no-console
          console.warn('[litellm] drift detected on manual reconcile', data);
        }
      },
      onError: (err) => {
        setLastError(err.message);
      },
    });

  return (
    <span className={className ?? 'inline-flex items-center gap-2'}>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {mutation.isPending ? 'Reconciling…' : label}
      </button>
      {mutation.data && (
        <span
          role="status"
          aria-live="polite"
          className={
            mutation.data.status === 'drifted'
              ? 'text-xs font-medium text-amber-700'
              : 'text-xs font-medium text-emerald-700'
          }
        >
          {mutation.data.status === 'drifted'
            ? `Drift: Δ $${mutation.data.delta_usd.toFixed(4)}`
            : `OK · Δ $${mutation.data.delta_usd.toFixed(4)}`}
        </span>
      )}
      {lastError !== null && (
        <span role="alert" className="text-xs font-medium text-rose-700">
          {lastError}
        </span>
      )}
    </span>
  );
}

export default ReconcileButton;