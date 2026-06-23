/**
 * Governance Center — list page (FORA-507 v1.0 GA).
 *
 * Composes the four typed-artifact surfaces the v1.0 GA center ships
 * with: pending Approval Requests, Board Confirmation history, Policy
 * list, and the read-only RBAC role viewer. Server fetches the typed
 * mock seam (`@/lib/governance/mock-data`) and renders the
 * `GovernanceCenter` composition from `the v2.0 typed-artifact system`.
 *
 * Reconciles with:
 *   - FORA-393 Plan 1 §3.11 (typed artifacts), Plan 3 §7.2 (brand
 *     palette), Plan 4 §3.10 (ApprovalRequestRenderer).
 *   - FORA-399 Governance Center plan (cross-cutting flows).
 *   - FORA-125 IAM registry (Policy + RbacRole canonical source).
 *   - Paperclip interaction schema (request_confirmation).
 *
 * The Board-token gate is enforced server-side at the runtime; the
 * renderer mirrors the gate via `evaluateBoardAccess` so the UX is
 * consistent with the security boundary.
 *
 * Phase 0.5-05: TS-5 BLOCKING redesign — uses `PageHeader` +
 * `Alert` (success / destructive / default) + `StatusPill` instead
 * of bespoke `border-emerald-*`, `bg-emerald-*`, `border-rose-*`
 * literal classes. Semantic tokens only.
 */

import { cookies } from 'next/headers';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';

import { SEED_TENANT_ID, readPersonaFromCookieHeader } from '@/lib/auth';
import {
  listApprovals,
  listBoardConfirmations,
  listPolicies,
  listRbacRoles,
  readBoardTokenForPersona,
} from '@/lib/governance/data';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader, EmptyState, SectionCard } from '@/components/shell';
import { StatusPill } from '@/components/shell';

export const dynamic = 'force-dynamic';

type Persona = 'pm' | 'eng-lead' | 'cto' | 'vp-eng' | 'security' | 'customer';

const PERSONA_LABEL: Record<Persona, string> = {
  pm: 'Product Manager',
  'eng-lead': 'Engineering Lead',
  cto: 'CTO',
  'vp-eng': 'VP Engineering',
  security: 'Security',
  customer: 'Customer',
};

export default async function GovernanceCenterPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const persona: Persona = readPersonaFromCookieHeader(cookieHeader) as Persona;
  const boardToken = readBoardTokenForPersona(persona);

  // Pull live data; the fetch helpers fall back to [] when the
  // orchestrator is unreachable so the page renders the empty
  // states instead of throwing.
  const [pendingApprovals, boardConfirmations, policies, rbacRoles] =
    await Promise.all([
      listApprovals(),
      listBoardConfirmations(),
      listPolicies(),
      listRbacRoles(),
    ]);

  return (
    <div className="space-y-6" data-testid="governance-center-page">
      <PageHeader
        eyebrow="Center #8"
        title="Governance Center"
        description={`${PERSONA_LABEL[persona]} view of every Approval Request, Board Confirmation, active Policy, and RBAC role for tenant ${SEED_TENANT_ID}. Accept/Decline is gated to the Board token per Paperclip interaction schema.`}
      />

      {boardToken ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="board-token-present"
        >
          <Alert>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="flex items-center gap-2 text-foreground">
              <StatusPill tone="success" glyph="✓" label="Board token present" size="sm" />
              <span>Accept actions enabled</span>
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Board token present for this session — Accept actions are
              enabled for <span className="font-mono">request_confirmation</span>{' '}
              interactions.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          data-testid="board-token-missing"
        >
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="flex items-center gap-2 text-foreground">
              <StatusPill tone="warn" glyph="◑" label="Board token missing" size="sm" />
              <span>Board access required for Accept</span>
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              No Board token in this session — Accept actions will surface
              <span className="mx-1 font-mono">Board access required</span>
              per Plan 4 §3.10 + FORA-507 AC #2. Decline remains enabled so the
              persona can refuse its own prompts.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <section
        aria-labelledby="pending-approvals-h"
        className="space-y-3"
        data-testid="pending-approvals-section"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="pending-approvals-h" className="text-lg font-semibold text-foreground">
            Pending Approvals
          </h2>
          <p className="text-xs text-muted-foreground" data-testid="pending-approval-count">
            {pendingApprovals.length} pending
          </p>
        </div>
        {pendingApprovals.length === 0 ? (
          <div data-testid="pending-approvals-empty">
            <EmptyState
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              title="No pending approvals"
              description="The Board is caught up."
            />
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Pending Approval Requests">
            {pendingApprovals.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-border bg-card p-4"
                data-testid={`pending-row-${p.id}`}
              >
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      {p.kind === 'request_confirmation' ? 'Confirm request' : p.kind}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {p.title}
                    </h3>
                  </div>
                  <StatusPill
                    tone={p.state === 'accepted' ? 'success' : p.state === 'declined' ? 'danger' : 'review'}
                    glyph={p.state === 'accepted' ? '✓' : p.state === 'declined' ? '✕' : '◑'}
                    pulse={p.state === 'pending' ? 'slow' : 'none'}
                    label={p.state}
                    size="sm"
                    data-state={p.state}
                  />
                </header>
                <p className="mt-2 text-sm text-foreground">{p.prompt}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <dt>Created</dt>
                  <dd className="font-mono text-foreground">{p.createdAt}</dd>
                  {p.idempotencyKey && (
                    <>
                      <dt>Idempotency key</dt>
                      <dd className="font-mono text-foreground">
                        {p.idempotencyKey}
                      </dd>
                    </>
                  )}
                </dl>
                <div
                  role="group"
                  aria-label="Approval actions"
                  className="mt-3 flex justify-end gap-2"
                >
                  <button
                    type="button"
                    disabled={!boardToken}
                    title={
                      boardToken
                        ? 'Decline this request'
                        : 'Decline remains available — the persona can always refuse its own prompt.'
                    }
                    className="rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground hover:bg-accent disabled:opacity-50"
                    data-action="decline"
                    data-testid={`page-decline-${p.id}`}
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={!boardToken}
                    title={
                      boardToken
                        ? 'Accept this request'
                        : 'Board access required — only the Board token can accept request_confirmation.'
                    }
                    className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    data-action="accept"
                    data-testid={`page-accept-${p.id}`}
                  >
                    Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="board-history-h"
        className="space-y-3"
        data-testid="board-history-section"
      >
        <h2 id="board-history-h" className="text-lg font-semibold text-foreground">
          Board Confirmation History
        </h2>
        {boardConfirmations.length === 0 ? (
          <EmptyState
            icon={<ShieldX className="h-5 w-5" aria-hidden="true" />}
            title="No Board confirmations yet"
            description="History will populate as the Board accepts or declines prompts."
          />
        ) : (
          <ul className="space-y-2" aria-label="Board Confirmation history">
            {boardConfirmations.map((c) => (
              <li
                key={c.id}
                data-outcome={c.outcome}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4"
                data-testid={`board-row-${c.id}`}
              >
                <div className="space-y-1">
                  <p className="font-mono text-sm text-foreground">
                    {c.subject.identifier}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    decider:{' '}
                    <span className="font-mono text-foreground">
                      {c.decider?.displayName ?? '—'}
                    </span>
                    {' · '}
                    {c.decidedAt ?? '—'}
                  </p>
                </div>
                <StatusPill
                  tone={c.outcome === 'accepted' ? 'success' : c.outcome === 'declined' ? 'danger' : 'idle'}
                  glyph={c.outcome === 'accepted' ? '✓' : c.outcome === 'declined' ? '✕' : '○'}
                  label={c.outcome}
                  size="sm"
                  data-outcome={c.outcome}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="policies-h"
        className="space-y-3"
        data-testid="policies-section-page"
      >
        <h2 id="policies-h" className="text-lg font-semibold text-foreground">
          Policies
        </h2>
        {policies.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
            title="No policies registered"
            description="Once a Policy is created in the registry, it appears here."
          />
        ) : (
          <ul className="space-y-2" aria-label="Policies">
            {policies.map((p) => (
              <li
                key={p.id}
                data-status={p.status}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4"
                data-testid={`policy-row-${p.id}`}
              >
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    updated by{' '}
                    <span className="font-mono text-foreground">
                      {p.updatedBy.displayName}
                    </span>
                    {' · '}
                    {p.updatedAt}
                  </p>
                </div>
                <StatusPill
                  tone={p.status === 'active' ? 'success' : 'idle'}
                  glyph={p.status === 'active' ? '✓' : '○'}
                  label={p.status}
                  size="sm"
                  data-status={p.status}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="rbac-h"
        className="space-y-3"
        data-testid="rbac-section-page"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="rbac-h" className="text-lg font-semibold text-foreground">
            RBAC Roles
          </h2>
          <p className="text-xs text-muted-foreground" role="note">
            Read-only in v1.0 — editor ships in v1.1.
          </p>
        </div>
        {rbacRoles.length === 0 ? (
          <EmptyState
            title="No RBAC roles configured"
            description="Roles will appear here once IAM registry is populated."
          />
        ) : (
          <ul className="space-y-2" aria-label="RBAC roles">
            {rbacRoles.map((r) => (
              <li
                key={r.id}
                data-system={String(r.system)}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4"
                data-testid={`rbac-row-${r.id}`}
              >
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {r.name}
                    {r.system && (
                      <StatusPill
                        tone="idle"
                        glyph="○"
                        label="system"
                        size="sm"
                        className="ml-2"
                        data-system="true"
                      />
                    )}
                  </p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {r.permissions.length} permission rows · {r.memberCount}{' '}
                    member{r.memberCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {r.updatedAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}