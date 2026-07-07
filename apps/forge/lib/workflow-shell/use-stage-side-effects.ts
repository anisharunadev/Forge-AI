/**
 * `useStageSideEffects` — wires the cross-cutting concerns every
 * workflow stage page must do:
 *
 *   1. **Audit** — record a `workflow.stage.mounted` audit event so
 *      the immutable audit log captures the user's journey.
 *   2. **Analytics** — fire a typed analytics event so the team can
 *      measure time-per-stage and drop-off.
 *   3. **RBAC** — return whether the active user is permitted to
 *      view this stage. Pages render a "Permission required" panel
 *      when false.
 *
 * All three side-effects are no-ops in environments where the
 * matching endpoint is not configured (e.g. local dev with no
 * observability). The hook is intentionally tolerant — its job is to
 * keep the workflow shell honest about state, not to enforce hard
 * failures during development.
 */

'use client';

import { useEffect } from 'react';

import { useAuth } from '@/lib/api/auth';

import type { WorkflowStageId } from './types';

export interface UseStageSideEffectsArgs {
  readonly stage: WorkflowStageId;
  readonly projectId?: string;
}

export interface UseStageSideEffectsResult {
  /** True if the user is allowed to view this stage. */
  readonly canView: boolean;
  /** True if the user is allowed to take actions on this stage. */
  readonly canAct: boolean;
  /** Human-readable reason when `canView` is false. */
  readonly deniedReason?: string;
}

/**
 * Coarse RBAC for the workflow. The full per-action permissions are
 * enforced by the backend; the frontend only needs to know if the
 * user is a viewer / editor / admin / owner of the active project.
 *
 * Rule 3 (per-phase human approval gates) ensures viewers can
 * browse but cannot start runs. Editors and admins can act.
 */
export function useStageSideEffects(
  args: UseStageSideEffectsArgs,
): UseStageSideEffectsResult {
  const { stage, projectId } = args;
  const user = useAuth((s) => s.user);
  const tenant = useAuth((s) => s.tenant);
  const token = useAuth((s) => s.token);

  // RBAC — coarse check.
  const role = user?.role ?? 'viewer';
  const canAct = role === 'owner' || role === 'admin' || role === 'editor';
  const canView = Boolean(token && (tenant || role === 'owner'));

  // Audit + analytics. Both no-op when the endpoints are unavailable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!canView) return;

    // Audit — best-effort POST to /v1/audit/events. Failures are
    // swallowed because audit is observable, not authoritative (the
    // server-side middleware also records the same event).
    try {
      const tenantId = tenant?.id;
      if (tenantId) {
        const payload = JSON.stringify({
          action: 'workflow.stage.mounted',
          stage,
          project_id: projectId ?? null,
          ts: new Date().toISOString(),
        });
        // Fire-and-forget; intentionally not awaited.
        void fetch('/v1/audit/events', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
    } catch {
      // Audit is observable — never let an audit failure crash the
      // page render.
    }

    // Analytics — fire a typed event on `window.dataLayer` (GTM-
    // compatible). Sites without GTM installed will simply ignore.
    try {
      const w = window as unknown as { dataLayer?: Array<Record<string, unknown>> };
      w.dataLayer = w.dataLayer ?? [];
      w.dataLayer.push({
        event: 'workflow_stage_mounted',
        workflow_stage: stage,
        project_id: projectId ?? null,
        tenant_id: tenant?.id ?? null,
        user_role: role,
      });
    } catch {
      // Same as audit: never crash on analytics.
    }
  }, [stage, projectId, canView, tenant?.id, token, role]);

  if (!canView) {
    return {
      canView: false,
      canAct: false,
      deniedReason: 'You do not have an active session for this workspace.',
    };
  }
  return { canView, canAct };
}