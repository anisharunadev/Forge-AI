/**
 * Governance Center — list page (FORA-507 v1.0 GA).
 *
 * Composes the four typed-artifact surfaces the v1.0 GA center ships
 * with: pending Approval Requests, Board Confirmation history, Policy
 * list, and the read-only RBAC role viewer. Server fetches the typed
 * mock seam (`@/lib/governance/mock-data`) and renders the
 * `GovernanceCenter` composition from `@fora/forge-ui/typed-artifacts`.
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
 */

import { cookies } from "next/headers";
import { SEED_TENANT_ID, readPersonaFromCookieHeader } from "@/lib/auth";
import {
  BOARD_CONFIRMATIONS,
  PENDING_APPROVALS,
  POLICIES,
  RBAC_ROLES,
  readBoardTokenForPersona,
} from "@/lib/governance/mock-data";

export const dynamic = "force-dynamic";

type Persona = "pm" | "eng-lead" | "cto" | "vp-eng" | "security" | "customer";

const PERSONA_LABEL: Record<Persona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO",
  "vp-eng": "VP Engineering",
  security: "Security",
  customer: "Customer",
};

export default async function GovernanceCenterPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const persona: Persona = readPersonaFromCookieHeader(cookieHeader) as Persona;
  const boardToken = readBoardTokenForPersona(persona);

  return (
    <div className="space-y-6" data-testid="governance-center-page">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-forge-300">
          Center #8
        </p>
        <h1 className="text-2xl font-semibold">Governance Center</h1>
        <p className="text-sm text-forge-200">
          {PERSONA_LABEL[persona]} view of every Approval Request, Board
          Confirmation, active Policy, and RBAC role for tenant{" "}
          <span className="font-mono">{SEED_TENANT_ID}</span>. Accept/Decline
          is gated to the Board token per Paperclip interaction schema.
        </p>
      </header>

      {boardToken ? (
        <div
          role="status"
          aria-live="polite"
          className="card border-emerald-500/40 bg-emerald-500/5"
          data-testid="board-token-present"
        >
          <p className="text-sm text-emerald-200">
            Board token present for this session — Accept actions are
            enabled for <span className="font-mono">request_confirmation</span>{" "}
            interactions.
          </p>
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className="card border-amber-500/40 bg-amber-500/5"
          data-testid="board-token-missing"
        >
          <p className="text-sm text-amber-200">
            No Board token in this session — Accept actions will surface
            <span className="mx-1 font-mono">Board access required</span>
            per Plan 4 §3.10 + FORA-507 AC #2. Decline remains enabled so the
            persona can refuse its own prompts.
          </p>
        </div>
      )}

      <section
        aria-labelledby="pending-approvals-h"
        className="space-y-3"
        data-testid="pending-approvals-section"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="pending-approvals-h" className="text-lg font-semibold">
            Pending Approvals
          </h2>
          <p className="text-xs text-forge-300" data-testid="pending-approval-count">
            {PENDING_APPROVALS.length} pending
          </p>
        </div>
        {PENDING_APPROVALS.length === 0 ? (
          <div className="card" data-testid="pending-approvals-empty">
            <p className="text-sm text-forge-200">
              No pending approvals. The Board is caught up.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Pending Approval Requests">
            {PENDING_APPROVALS.map((p) => (
              <li key={p.id} className="card" data-testid={`pending-row-${p.id}`}>
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-forge-300">
                      {p.kind === "request_confirmation" ? "Confirm request" : p.kind}
                    </p>
                    <h3 className="text-base font-semibold text-forge-100">
                      {p.title}
                    </h3>
                  </div>
                  <span
                    data-state={p.state}
                    className="rounded-sm border border-forge-primary/40 bg-forge-primary/10 px-2 py-1 text-caption text-forge-primary"
                  >
                    {p.state}
                  </span>
                </header>
                <p className="mt-2 text-sm text-forge-200">{p.prompt}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-forge-300">
                  <dt>Created</dt>
                  <dd className="font-mono text-forge-200">{p.createdAt}</dd>
                  {p.idempotencyKey && (
                    <>
                      <dt>Idempotency key</dt>
                      <dd className="font-mono text-forge-200">
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
                        ? "Decline this request"
                        : "Decline remains available — the persona can always refuse its own prompt."
                    }
                    className="rounded-sm border border-forge-600 bg-transparent px-3 py-1 text-sm text-forge-100 hover:bg-forge-700 disabled:opacity-50"
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
                        ? "Accept this request"
                        : "Board access required — only the Board token can accept request_confirmation."
                    }
                    className="rounded-sm bg-forge-primary px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
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
        <h2 id="board-history-h" className="text-lg font-semibold">
          Board Confirmation History
        </h2>
        <ul className="space-y-2" aria-label="Board Confirmation history">
          {BOARD_CONFIRMATIONS.map((c) => (
            <li
              key={c.id}
              data-outcome={c.outcome}
              className="card flex items-start justify-between gap-3"
              data-testid={`board-row-${c.id}`}
            >
              <div className="space-y-1">
                <p className="font-mono text-sm text-forge-100">
                  {c.subject.identifier}
                </p>
                <p className="text-xs text-forge-300">{c.prompt}</p>
                <p className="text-xs text-forge-300">
                  decider:{" "}
                  <span className="font-mono text-forge-200">
                    {c.decider?.displayName ?? "—"}
                  </span>
                  {" · "}
                  {c.decidedAt ?? "—"}
                </p>
              </div>
              <span
                data-outcome={c.outcome}
                className={
                  c.outcome === "accepted"
                    ? "rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-caption text-emerald-200"
                    : c.outcome === "declined"
                      ? "rounded-sm border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-caption text-rose-200"
                      : "rounded-sm border border-forge-600 bg-forge-700 px-2 py-1 text-caption text-forge-200"
                }
              >
                {c.outcome}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="policies-h"
        className="space-y-3"
        data-testid="policies-section-page"
      >
        <h2 id="policies-h" className="text-lg font-semibold">
          Policies
        </h2>
        <ul className="space-y-2" aria-label="Policies">
          {POLICIES.map((p) => (
            <li
              key={p.id}
              data-status={p.status}
              className="card flex items-start justify-between gap-3"
              data-testid={`policy-row-${p.id}`}
            >
              <div className="space-y-1">
                <p className="font-medium text-forge-100">{p.title}</p>
                <p className="text-xs text-forge-300">{p.summary}</p>
                <p className="text-xs text-forge-300">
                  updated by{" "}
                  <span className="font-mono text-forge-200">
                    {p.updatedBy.displayName}
                  </span>
                  {" · "}
                  {p.updatedAt}
                </p>
              </div>
              <span
                data-status={p.status}
                className={
                  p.status === "active"
                    ? "rounded-sm border border-forge-primary/40 bg-forge-primary/10 px-2 py-1 text-caption text-forge-primary"
                    : "rounded-sm border border-forge-600 bg-forge-700 px-2 py-1 text-caption text-forge-200"
                }
              >
                {p.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="rbac-h"
        className="space-y-3"
        data-testid="rbac-section-page"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="rbac-h" className="text-lg font-semibold">
            RBAC Roles
          </h2>
          <p className="text-xs text-forge-300" role="note">
            Read-only in v1.0 — editor ships in v1.1.
          </p>
        </div>
        <ul className="space-y-2" aria-label="RBAC roles">
          {RBAC_ROLES.map((r) => (
            <li
              key={r.id}
              data-system={String(r.system)}
              className="card flex items-start justify-between gap-3"
              data-testid={`rbac-row-${r.id}`}
            >
              <div className="space-y-1">
                <p className="font-medium text-forge-100">
                  {r.name}
                  {r.system && (
                    <span
                      data-system="true"
                      className="ml-2 rounded-sm border border-forge-600 bg-forge-700 px-2 py-0.5 text-caption text-forge-200"
                    >
                      system
                    </span>
                  )}
                </p>
                {r.description && (
                  <p className="text-xs text-forge-300">{r.description}</p>
                )}
                <p className="text-xs text-forge-300">
                  {r.permissions.length} permission rows · {r.memberCount}{" "}
                  member{r.memberCount === 1 ? "" : "s"}
                </p>
              </div>
              <span className="font-mono text-xs text-forge-300">
                {r.updatedAt}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}