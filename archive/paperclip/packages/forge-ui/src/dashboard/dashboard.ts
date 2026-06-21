/**
 * Dashboard Center typed-artifact surface — FORA-393 Plan 1 §3.1.
 *
 * Per the parallel-center-shipping-recipe (FORA-507 memory entry), this
 * file is the per-center type surface, separated from the shared
 * `./types` so the Dashboard Center slice ships independently of the
 * Audit + Governance + Knowledge + Development slices that also touch
 * the shared `typed-artifacts` table.
 *
 * Reconciles with:
 *   - Plan 1 §3.1 (Dashboard — persona-aware landing)
 *   - Plan 1 §4 (cross-references — every Dashboard tile is a deep link
 *     into another center; Dashboard does not own any typed artifact)
 *   - Plan 3 §4.1 (per-persona default theme)
 *   - Plan 3 §5 (keyboard navigation, focus ring)
 *   - Plan 4 §3.4 (TaskRenderer), §3.9 (AuditEntryRenderer),
 *     §3.10 (ApprovalRequestRenderer)
 *
 * The Dashboard aggregates from every other center; it does not own a
 * typed artifact. Every tile carries a {@link DrillLink} whose href
 * points at the center that owns the data, plus the typed-artifact
 * pointer (per the parallel-center-shipping-recipe: parallel Center
 * ships do not pile into the shared `types.ts`).
 */

import type { Theme, ThemeMode } from "../tokens/types";
import type {
  ApprovalRequest,
  AuditEntry,
  Requirement,
  TaskArtifact,
} from "../typed-artifacts/types";

/**
 * The personas the Dashboard Center ships with in v1.0 GA. The shell
 * `PersonaSwitcher` also surfaces `vp-eng` and `customer` (Plan 3 §4.1),
 * but the Dashboard tiles are only defined for these five. A request
 * for an unknown persona returns the empty dashboard (the "fallback"
 * PersonaTile composition).
 */
export type DashboardPersona = "pm" | "eng-lead" | "cto" | "security" | "ciso";

/** Static label for the dashboard pill at the top of the page. */
export const DASHBOARD_PERSONA_LABEL: Readonly<Record<DashboardPersona, string>> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO / VP Eng",
  security: "Security",
  ciso: "Customer CISO",
};

/** Per-persona default theme — pin so the renderer can apply on switch (Plan 3 §4.1). */
export const DASHBOARD_PERSONA_THEME: Readonly<Record<DashboardPersona, ThemeMode>> = {
  pm: "light",
  "eng-lead": "dark",
  cto: "dark",
  security: "dark",
  ciso: "dark",
};

/** The persona tile kinds the composer renders. */
export type TileKind =
  | "open-epics"
  | "pending-approvals"
  | "open-questions"
  | "in-flight-runs"
  | "blocked-runs"
  | "budget-alerts"
  | "cost-by-goal"
  | "aggregate-risk"
  | "audit-tail"
  | "open-findings"
  | "secrets-inventory"
  | "approvals-awaiting-decision";

/** Human label per tile kind — used as the section heading on each tile. */
export const TILE_KIND_LABEL: Readonly<Record<TileKind, string>> = {
  "open-epics": "Open epics",
  "pending-approvals": "Pending approvals",
  "open-questions": "Open questions on stories you own",
  "in-flight-runs": "In-flight runs you own",
  "blocked-runs": "Blocked runs",
  "budget-alerts": "Budget alerts",
  "cost-by-goal": "Cost by goal",
  "aggregate-risk": "Aggregate risk",
  "audit-tail": "Recent audit events",
  "open-findings": "Open findings",
  "secrets-inventory": "Secrets inventory",
  "approvals-awaiting-decision": "Approvals awaiting your decision",
};

/**
 * The typed deep-link a tile carries. Plan 1 §4 requires every Dashboard
 * tile to point at the owning center. The href is rendered into the
 * tile as a "View in {centerLabel}" link.
 */
export interface DrillLink {
  readonly href: string;
  readonly centerId: string;
  readonly centerLabel: string;
  /** Optional pre-applied filter on the destination center. */
  readonly filter?: Readonly<Record<string, string>>;
}

/**
 * A `PersonaTile` is one "what needs my attention" card on the
 * Dashboard. The composer renders one per `kind` for the active persona;
 * a tile's `kind` is the contract with the typed-artifact payload
 * (`items` carries the typed-artifact rows).
 */
export interface PersonaTile {
  readonly kind: TileKind;
  readonly label: string;
  readonly count: number;
  /** Tone drives the leading color stripe (success/warn/danger/neutral/primary). */
  readonly tone: "neutral" | "primary" | "warn" | "danger" | "success";
  readonly drillLink: DrillLink;
  readonly items: ReadonlyArray<TileItem>;
}

/**
 * Discriminated union over the typed-artifact payload a tile can hold.
 * Each tile kind maps to one branch; the renderer's switch is exhaustive
 * over `kind`. The Dashboard never *owns* the artifact — it is a
 * read-only pointer for the persona to drill into the owning center.
 */
export type TileItem =
  | { readonly kind: "open-epics"; readonly epics: ReadonlyArray<Requirement> }
  | { readonly kind: "pending-approvals"; readonly approvals: ReadonlyArray<ApprovalRequest> }
  | { readonly kind: "open-questions"; readonly questions: ReadonlyArray<Requirement> }
  | { readonly kind: "in-flight-runs"; readonly runs: ReadonlyArray<TaskArtifact> }
  | { readonly kind: "blocked-runs"; readonly runs: ReadonlyArray<TaskArtifact> }
  | { readonly kind: "budget-alerts"; readonly signals: ReadonlyArray<BudgetSignal> }
  | { readonly kind: "cost-by-goal"; readonly signals: ReadonlyArray<BudgetSignal> }
  | { readonly kind: "aggregate-risk"; readonly findingsCount: number; readonly blockedCount: number; readonly staleCount: number }
  | { readonly kind: "audit-tail"; readonly entries: ReadonlyArray<AuditEntry> }
  | { readonly kind: "open-findings"; readonly entries: ReadonlyArray<AuditEntry> }
  | { readonly kind: "secrets-inventory"; readonly total: number; readonly rotatedRecently: number }
  | { readonly kind: "approvals-awaiting-decision"; readonly approvals: ReadonlyArray<ApprovalRequest> };

/**
 * `BudgetSignal` — computed view over `cost_records` (Plan 1 §3.1).
 * The Dashboard does not own CostRecord; it computes a derived signal
 * the persona can act on. The renderer mirrors a small shape so the
 * tile is testable without the Analytics Center.
 */
export interface BudgetSignal {
  readonly id: string;
  readonly goalId: string;
  readonly goalTitle: string;
  /** Spend in USD over the rolling window. */
  readonly spentUsd: number;
  /** Cap in USD over the same window. */
  readonly capUsd: number;
  /** Tone the tile renders when pct >= 95 (danger) / 80 (warn) / else primary. */
  readonly tone: "success" | "warn" | "danger";
  /** Window label (e.g. "this sprint", "this month"). */
  readonly window: string;
}

/**
 * The shape of the `DashboardQuery` — the persona's active filter on
 * the dashboard. Plan 1 §4 only requires one axis in v1.0 (persona),
 * but the composer accepts a free-form filter so the per-tenant
 * `forge.persona` cookie can be overridden at runtime.
 */
export interface DashboardQuery {
  readonly persona: DashboardPersona;
  /** Optional explicit theme override; default = DASHBOARD_PERSONA_THEME[persona]. */
  readonly themeOverride?: ThemeMode;
  /** Optional tenant filter (RBAC-derived; the composer still enforces). */
  readonly tenantId?: string;
}

/**
 * The full per-persona Dashboard bundle — what the renderer receives
 * and what the fetcher produces. `tiles` is persona-derived; `persona`
 * is the source of truth for the page header.
 */
export interface DashboardSnapshot {
  readonly persona: DashboardPersona;
  readonly theme: ThemeMode;
  readonly tiles: ReadonlyArray<PersonaTile>;
  /** Tenant identity — every tile is scoped to this tenant. */
  readonly tenantId: string;
  /** When the snapshot was last computed (for the freshness banner). */
  readonly computedAt: string;
}

/**
 * DashboardFetcher — the contract the runtime implements to produce a
 * DashboardSnapshot. The renderer is tenant-agnostic; the fetcher is
 * the security boundary. Mirrors the AuditCenter `AuditFetcher` shape
 * from FORA-505 — same principle, different domain.
 */
export interface DashboardFetcher {
  /**
   * Return the DashboardSnapshot for the given persona + tenant.
   * MUST throw if the tenant does not exist or the persona lacks RBAC
   * for this tenant. The composer surfaces the error via the
   * `errorBoundary` slot.
   */
  fetch(query: DashboardQuery): Promise<DashboardSnapshot>;
}

/**
 * RBAC gate — the Dashboard Center is open to all five personas the
 * composer renders. The shell nav hides the entry point for
 * `vp-eng` + `customer` (Plan 3 §4.1 maps those to a customer-facing
 * surface, not the typed-artifact Dashboard).
 */
export const DASHBOARD_ALLOWED_PERSONAS: ReadonlyArray<DashboardPersona> = [
  "pm",
  "eng-lead",
  "cto",
  "security",
  "ciso",
];

export function canAccessDashboard(persona: string): persona is DashboardPersona {
  return (DASHBOARD_ALLOWED_PERSONAS as ReadonlyArray<string>).includes(persona);
}

/**
 * Persona → tile kinds the composer renders, in render order. Plan 1 §3.1
 * pins the per-persona tile composition; this map is the source of truth.
 *
 * The keys match the issue description's "what needs my attention" bullets.
 */
export const PERSONA_TILES: Readonly<Record<DashboardPersona, ReadonlyArray<TileKind>>> = {
  pm: ["open-epics", "pending-approvals", "open-questions"],
  "eng-lead": ["in-flight-runs", "blocked-runs", "budget-alerts"],
  cto: ["cost-by-goal", "aggregate-risk", "audit-tail"],
  security: ["open-findings", "audit-tail", "secrets-inventory"],
  ciso: ["audit-tail", "approvals-awaiting-decision"],
};

/**
 * Apply the persona → tile kind mapping. Pure function so the composer
 * can memoize and tests can assert without rendering.
 */
export function applyPersonaFilter(
  tiles: ReadonlyArray<PersonaTile>,
  persona: DashboardPersona,
): ReadonlyArray<PersonaTile> {
  const allowed = new Set<TileKind>(PERSONA_TILES[persona]);
  return tiles.filter((t) => allowed.has(t.kind));
}

/**
 * Resolve the theme for the active persona. The shell's `ThemeProvider`
 * already keeps the cookie + ThemeContext in sync; this helper is the
 * pure fallback for SSR (where the cookie may not be present yet) and
 * for the `/dashboard` page header pill.
 */
export function resolvePersonaTheme(
  persona: DashboardPersona,
  override?: ThemeMode,
): ThemeMode {
  return override ?? DASHBOARD_PERSONA_THEME[persona];
}

/**
 * Compute a `BudgetSignal.tone` from spent / cap. Pure function — the
 * tile renderer + the page header pill both call it. Mirrors the
 * BudgetMeter tone thresholds (>=95 danger, >=80 warn, else success)
 * so the Dashboard tile never reads a different severity than the
 * top-bar BudgetMeter for the same numbers.
 */
export function computeBudgetTone(
  spentUsd: number,
  capUsd: number,
): BudgetSignal["tone"] {
  if (capUsd <= 0) return "success";
  const pct = (spentUsd / capUsd) * 100;
  if (pct >= 95) return "danger";
  if (pct >= 80) return "warn";
  return "success";
}

/**
 * The aggregate-risk tile is a derived count. Pure function — given
 * the raw counts, returns the rollup the composer renders.
 */
export interface AggregateRisk {
  readonly findings: number;
  readonly blocked: number;
  readonly stale: number;
  /** Composite tone (worst-of). */
  readonly tone: PersonaTile["tone"];
}

export function computeAggregateRisk(
  findings: number,
  blocked: number,
  stale: number,
): AggregateRisk {
  const tone: PersonaTile["tone"] =
    findings > 0 ? "danger" : blocked > 0 ? "warn" : stale > 0 ? "primary" : "neutral";
  return { findings, blocked, stale, tone };
}

/**
 * Static deep-link resolver — the href pattern for each tile kind.
 * The runtime substitutes the tenantId + applies any pre-filter from the
 * tile's `DrillLink.filter`. Centralising it here means the renderer
 * never has to know each center's route shape; a future center rename
 * only updates this one map.
 */
export const TILE_DRILL_LINK: Readonly<
  Record<TileKind, { readonly centerId: string; readonly centerLabel: string }>
> = {
  "open-epics": { centerId: "project-intelligence", centerLabel: "Project Intelligence" },
  "pending-approvals": { centerId: "governance", centerLabel: "Governance" },
  "open-questions": { centerId: "project-intelligence", centerLabel: "Project Intelligence" },
  "in-flight-runs": { centerId: "agent", centerLabel: "Agent Center" },
  "blocked-runs": { centerId: "agent", centerLabel: "Agent Center" },
  "budget-alerts": { centerId: "analytics", centerLabel: "Analytics" },
  "cost-by-goal": { centerId: "analytics", centerLabel: "Analytics" },
  "aggregate-risk": { centerId: "security", centerLabel: "Security" },
  "audit-tail": { centerId: "audit", centerLabel: "Audit Center" },
  "open-findings": { centerId: "security", centerLabel: "Security" },
  "secrets-inventory": { centerId: "security", centerLabel: "Security" },
  "approvals-awaiting-decision": { centerId: "governance", centerLabel: "Governance" },
};

/**
 * Build the canonical `DrillLink` for a tile kind, scoped to a tenant.
 * Pure — the only tenant-aware bit is the href template.
 */
export function buildDrillLink(
  kind: TileKind,
  tenantId: string,
  filter?: Readonly<Record<string, string>>,
): DrillLink {
  const base = TILE_DRILL_LINK[kind];
  const href =
    filter && Object.keys(filter).length > 0
      ? `/${base.centerId}?${new URLSearchParams({ ...filter, tenantId }).toString()}`
      : `/${base.centerId}?${new URLSearchParams({ tenantId }).toString()}`;
  return {
    href,
    centerId: base.centerId,
    centerLabel: base.centerLabel,
    ...(filter ? { filter } : {}),
  };
}

/**
 * Build the dashboard snapshot from raw fetcher inputs — pure helper
 * the runtime DashboardFetcher (or the in-process mock for tests) calls.
 * The composer never calls this directly; the fetcher wires tenantId +
 * fetches the typed-artifact rows + calls this to shape the persona
 * filter + theme. The function is exported so the runtime impl and the
 * test mock share the exact same composition path.
 */
export function buildDashboardSnapshot(input: {
  readonly persona: DashboardPersona;
  readonly tenantId: string;
  readonly tiles: ReadonlyArray<PersonaTile>;
  readonly themeOverride?: ThemeMode;
  readonly computedAt?: string;
}): DashboardSnapshot {
  const filtered = applyPersonaFilter(input.tiles, input.persona);
  return {
    persona: input.persona,
    theme: resolvePersonaTheme(input.persona, input.themeOverride),
    tiles: filtered,
    tenantId: input.tenantId,
    computedAt: input.computedAt ?? "1970-01-01T00:00:00Z",
  };
}

/**
 * Type guard for the dashboard persona — matches the tokens Persona
 * subset the composer actually renders.
 */
export function isDashboardPersona(value: unknown): value is DashboardPersona {
  return (
    typeof value === "string" &&
    (DASHBOARD_ALLOWED_PERSONAS as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Persona theme map — Plan 3 §4.1. Re-exported so the composer can
 * avoid importing the tokens module directly (keeps the subpath
 * bundle tight per FORA-505 / FORA-507 recipe).
 */
export const PERSONA_DEFAULT_THEME_MAP: Readonly<Record<DashboardPersona, Theme>> = {
  pm: "light",
  "eng-lead": "dark",
  cto: "dark",
  security: "dark",
  ciso: "dark",
};