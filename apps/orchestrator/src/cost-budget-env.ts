/**
 * EnvCostBudget — v0.1 fallback adapter for the `CostBudget` port
 * (FORA-528 / FORA-110 0.1.b).
 *
 * Reads the per-tenant ceiling from `FORA_DEFAULT_COST_CEILING_USD`
 * and reports `spentUsd = 0`. This is the SEAM adapter — it exists
 * so the wiring (`gate_wiring.ts`) can enforce an active
 * cost-ceiling check end-to-end before the Cost agent v0.2 lands
 * (FORA-149 / FORA-150). With `spentUsd = 0`, the policy is
 * permissive: every tenant is reported as under budget. The wiring
 * still calls `currentSpendUsd` on every `routeGate`, so the seam
 * is exercised in tests and in production.
 *
 * v0.2 replaces this adapter with `cost-budget-agent.ts` (a
 * thin wrapper over the Cost agent MCP server) so the policy is
 * enforced against the real per-tenant spend.
 *
 * `FORA_DEFAULT_COST_CEILING_USD` is documented in `config.ts` as
 * a v0.1 fallback only; v0.2 enforces per-tenant overrides from the
 * Cost agent.
 */

import type { CostBudget } from './ports.js';
import type { TenantId } from './types.js';

/** Default ceiling when the env var is unset (matches config.ts). */
const FALLBACK_CEILING_USD = '100.00';

/**
 * Parse a USD string to a non-negative number. Throws on malformed
 * input — fail loud rather than silently coerce to zero. Negative
 * or NaN values are also rejected because the boundary assumes
 * `ceilingUsd >= 0` for any sensible per-tenant policy.
 */
function parseUsd(raw: string, fieldName: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(`EnvCostBudget: ${fieldName} is empty`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`EnvCostBudget: ${fieldName}=${raw} is not a finite number`);
  }
  if (n < 0) {
    throw new Error(`EnvCostBudget: ${fieldName}=${raw} is negative`);
  }
  return n;
}

/**
 * Factory: bind an EnvCostBudget to a snapshot of env (or process.env
 * by default). The factory pattern keeps the adapter testable —
 * tests can pass `{ FORA_DEFAULT_COST_CEILING_USD: '0.00' }` to
 * force the over-budget path without touching the real environment.
 */
export function createEnvCostBudget(
  env: NodeJS.ProcessEnv = process.env,
): CostBudget {
  const ceilingRaw = env['FORA_DEFAULT_COST_CEILING_USD'] ?? FALLBACK_CEILING_USD;
  const ceilingUsd = parseUsd(ceilingRaw, 'FORA_DEFAULT_COST_CEILING_USD');

  return {
    async currentSpendUsd(_args: { tenantId: TenantId }): Promise<{
      spentUsd: number;
      ceilingUsd: number;
    }> {
      // v0.1 seam: report zero spend. v0.2 (cost-budget-agent.ts)
      // calls the live Cost agent MCP server here.
      return { spentUsd: 0, ceilingUsd };
    },
  };
}
