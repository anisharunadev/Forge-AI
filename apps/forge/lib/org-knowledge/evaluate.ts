/**
 * JSONLogic evaluator (minimal subset) for the policy editor.
 *
 * Implements enough of JSONLogic to demo live evaluation of the
 * mock policies: `==`, `!=`, `>`, `>=`, `<`, `<=`, `!`, `!!`, `var`,
 * `and`, `or`. Anything else is left as a no-op.
 *
 * This is intentionally tiny — production policies will use a
 * server-side evaluator shipped in a later PR.
 */

type Logic = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function getVar(data: unknown, path: string): unknown {
  if (typeof path !== 'string') return null;
  if (path === '') return data;
  const parts = path.split('.');
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur ?? null;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return Boolean(v);
}

export function evaluateLogic(logic: Logic, data: unknown): boolean {
  if (logic === null || logic === undefined) return true;
  if (typeof logic !== 'object' || Array.isArray(logic)) {
    return truthy(logic);
  }
  const entries = Object.entries(logic as Record<string, unknown>);
  if (entries.length === 0) return true;
  const [op, raw] = entries[0]!;
  const args = asArray(raw);

  switch (op) {
    case 'var':
      return truthy(getVar(data, String(args[0])));
    case '!':
      return !truthy(evaluateLogic(args[0] as Logic, data));
    case '!!':
      return truthy(evaluateLogic(args[0] as Logic, data));
    case '==':
      return evaluateLogic(args[0] as Logic, data) === evaluateLogic(args[1] as Logic, data);
    case '!=':
      return evaluateLogic(args[0] as Logic, data) !== evaluateLogic(args[1] as Logic, data);
    case '>':
      return Number(evaluateLogic(args[0] as Logic, data)) > Number(evaluateLogic(args[1] as Logic, data));
    case '>=':
      return Number(evaluateLogic(args[0] as Logic, data)) >= Number(evaluateLogic(args[1] as Logic, data));
    case '<':
      return Number(evaluateLogic(args[0] as Logic, data)) < Number(evaluateLogic(args[1] as Logic, data));
    case '<=':
      return Number(evaluateLogic(args[0] as Logic, data)) <= Number(evaluateLogic(args[1] as Logic, data));
    case 'and':
      return args.every((a) => truthy(evaluateLogic(a as Logic, data)));
    case 'or':
      return args.some((a) => truthy(evaluateLogic(a as Logic, data)));
    default:
      return false;
  }
}

/**
 * Build a sample input that matches the mock policy scopes well enough
 * to make the live evaluation meaningful. Custom JSON from the editor
 * overrides this.
 */
export function sampleInputFor(scope: string, overrideJson: string): unknown {
  if (overrideJson.trim().length > 0) {
    try {
      return JSON.parse(overrideJson);
    } catch {
      return {};
    }
  }
  if (scope.includes('production')) {
    return { deployment: { environment: 'production' } };
  }
  if (scope.includes('coverage_delta')) {
    return { pr: { coverage_delta: 0.72 } };
  }
  if (scope.includes('admin')) {
    return { actor: { role: 'admin', mfa: false } };
  }
  if (scope.includes('spend_usd_today')) {
    return { tenant: { spend_usd_today: 1100 } };
  }
  if (scope.includes('main')) {
    return { pr: { target_branch: 'main', method: 'direct_push' } };
  }
  return {};
}
