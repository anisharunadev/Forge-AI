/**
 * Cloud-side simulator — IAM policy evaluator.
 *
 * Faithfully reproduces AWS IAM policy evaluation semantics so the
 * FORA-174 verification harness can prove the cross-tenant denials
 * happen at the cloud boundary, not at our adapter.
 *
 * AWS IAM evaluation rules (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html):
 *
 *   1. Default: deny.
 *   2. An explicit DENY in any matching statement overrides any ALLOW.
 *   3. Otherwise, if any ALLOW statement matches, the request is allowed.
 *   4. A statement matches iff its Action, Resource, and Condition all
 *      match the request.
 *
 * Condition operators implemented:
 *
 *   - StringEquals, StringNotEquals
 *   - StringLike (glob, * matches any segment)
 *   - Bool (string "true"/"false")
 *
 * Action + Resource matching uses the same glob semantics (*, ?).
 *
 * The simulator is deliberately small. It does not need to be a full
 * IAM engine — only to faithfully evaluate the per-tenant policy in
 * iam-policy.json. Adding operators is straightforward; the test suite
 * catches gaps because the assertion is "match what real AWS would do"
 * and we have a frozen fixture for that.
 */

export type ConditionOp =
  | 'StringEquals'
  | 'StringNotEquals'
  | 'StringLike'
  | 'Bool';

export interface ConditionBlock {
  StringEquals?: Record<string, string>;
  StringNotEquals?: Record<string, string>;
  StringLike?: Record<string, string>;
  Bool?: Record<string, 'true' | 'false'>;
}

export interface IamStatement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition?: ConditionBlock;
}

export interface IamPolicy {
  Version: string;
  Statement: IamStatement[];
}

/** The cloud-side request we want to authorize. */
export interface AuthzRequest {
  action: string;
  resource: string;
  /** Session tags + condition-key values for the principal. */
  context: Record<string, string>;
}

/** AWS-style authz decision. */
export interface AuthzDecision {
  allowed: boolean;
  matchedSid?: string;
  reason:
    | 'explicit_allow'
    | 'explicit_deny'
    | 'no_matching_statement'
    | 'condition_unmet';
}

// ---- Glob matcher ---------------------------------------------------------

/**
 * Convert an IAM glob to a RegExp. IAM uses the same `*` and `?`
 * semantics as POSIX shell globbing (no character classes).
 */
export function globToRegex(glob: string): RegExp {
  let re = '^';
  for (const ch of glob) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (/[.+^${}()|[\]\\]/.test(ch)) re += '\\' + ch;
    else re += ch;
  }
  re += '$';
  return new RegExp(re);
}

export function matchGlob(glob: string, value: string): boolean {
  return globToRegex(glob).test(value);
}

// ---- Condition evaluator --------------------------------------------------

export function evaluateCondition(
  cond: ConditionBlock | undefined,
  context: Record<string, string>,
): boolean {
  if (!cond) return true;
  for (const [op, kv] of Object.entries(cond)) {
    if (!kv) continue;
    for (const [key, expected] of Object.entries(kv)) {
      const actual = context[key] ?? '';
      switch (op as ConditionOp) {
        case 'StringEquals':
          if (actual !== expected) return false;
          break;
        case 'StringNotEquals':
          if (actual === expected) return false;
          break;
        case 'StringLike':
          if (!matchGlob(expected as string, actual)) return false;
          break;
        case 'Bool': {
          // AWS coerces the context value to bool.
          const truthy = actual === 'true' || actual === '1';
          const want = expected === 'true';
          if (truthy !== want) return false;
          break;
        }
        default:
          // Unknown operator — fail closed.
          return false;
      }
    }
  }
  return true;
}

// ---- Statement matcher ----------------------------------------------------

export function statementMatches(stmt: IamStatement, req: AuthzRequest): boolean {
  // Action — array or scalar; OR semantics within a statement.
  const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
  const actionMatch = actions.some((a) => matchGlob(a, req.action));
  if (!actionMatch) return false;

  // Resource — same OR semantics.
  const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
  const resourceMatch = resources.some((r) => matchGlob(r, req.resource));
  if (!resourceMatch) return false;

  // Condition.
  if (!evaluateCondition(stmt.Condition, req.context)) return false;

  return true;
}

// ---- Top-level evaluator --------------------------------------------------

/**
 * Evaluate an IAM policy against a request. Returns the decision plus
 * the matching statement's Sid (useful for assertions on which clause
 * denied).
 *
 * Order: explicit Deny wins. Otherwise any matching Allow grants.
 * Otherwise deny.
 */
export function evaluate(policy: IamPolicy, req: AuthzRequest): AuthzDecision {
  // First pass — look for an explicit Deny.
  for (const stmt of policy.Statement) {
    if (stmt.Effect !== 'Deny') continue;
    if (statementMatches(stmt, req)) {
      return {
        allowed: false,
        matchedSid: stmt.Sid,
        reason: 'explicit_deny',
      };
    }
  }
  // Second pass — look for an Allow.
  for (const stmt of policy.Statement) {
    if (stmt.Effect !== 'Allow') continue;
    if (statementMatches(stmt, req)) {
      return {
        allowed: true,
        matchedSid: stmt.Sid,
        reason: 'explicit_allow',
      };
    }
  }
  return { allowed: false, reason: 'no_matching_statement' };
}
