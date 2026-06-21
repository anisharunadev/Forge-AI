/**
 * @fora/tenancy-lint — public types
 */

export type FindingSeverity = 'error' | 'warning';

export interface Finding {
  readonly severity: FindingSeverity;
  readonly rule: string;
  /** Repo-relative path with forward slashes. */
  readonly file: string;
  /** 1-indexed line number. */
  readonly line: number;
  readonly message: string;
}

export interface LintContext {
  /** Repo-relative path with forward slashes. */
  readonly file: string;
}

export interface LintSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly findings: readonly Finding[];
}
