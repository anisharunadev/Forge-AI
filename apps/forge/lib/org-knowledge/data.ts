/**
 * Organization Knowledge data layer (M2 — FORA-592).
 *
 * Backs the Standards, Templates, and Policies tabs. The shape
 * mirrors the F-001 / F-002 / F-003 typed artifacts in Plan 4.
 *
 * `Policy.logic` is a JSONLogic expression; the PolicyEditor
 * evaluates it against a sample input to demonstrate "live eval".
 */

export type StandardCategory =
  | 'architecture'
  | 'security'
  | 'quality'
  | 'operations'
  | 'documentation';

export type StandardStatus = 'draft' | 'in-review' | 'approved' | 'deprecated';

export interface Standard {
  id: string;
  title: string;
  category: StandardCategory;
  status: StandardStatus;
  owner: string;
  body: string;
  updatedAt: string;
  version: string;
}

export type TemplateKind = 'prd' | 'adr' | 'contract' | 'task' | 'risk' | 'security';

export interface Template {
  id: string;
  title: string;
  kind: TemplateKind;
  description: string;
  updatedAt: string;
  preview: string;
  owner: string;
  uses: number;
}

export type PolicyEffect = 'allow' | 'deny' | 'require-approval' | 'notify';

/** JSONLogic-style expression (subset). */
export type PolicyLogic = Record<string, unknown>;

export interface Policy {
  id: string;
  title: string;
  effect: PolicyEffect;
  scope: string;
  logic: PolicyLogic;
  enabled: boolean;
  updatedAt: string;
  owner: string;
}

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeArray<T>(res: Response): Promise<ReadonlyArray<T>> {
  if (!res.ok) return [];
  try {
    const json = (await res.json()) as T[] | { items?: T[] };
    if (Array.isArray(json)) return json;
    if (json && Array.isArray((json as { items?: T[] }).items)) {
      return (json as { items: T[] }).items;
    }
    return [];
  } catch {
    return [];
  }
}

/** GET /v1/org-knowledge/standards */
export async function listStandards(): Promise<ReadonlyArray<Standard>> {
  const res = await fetch(`${SERVER_BASE}/v1/org-knowledge/standards`, {
    cache: 'no-store',
  });
  return safeArray<Standard>(res);
}

/** GET /v1/org-knowledge/templates */
export async function listTemplates(): Promise<ReadonlyArray<Template>> {
  const res = await fetch(`${SERVER_BASE}/v1/org-knowledge/templates`, {
    cache: 'no-store',
  });
  return safeArray<Template>(res);
}

/** GET /v1/org-knowledge/policies */
export async function listPolicies(): Promise<ReadonlyArray<Policy>> {
  const res = await fetch(`${SERVER_BASE}/v1/org-knowledge/policies`, {
    cache: 'no-store',
  });
  return safeArray<Policy>(res);
}

/** Local helpers — pure transforms, no I/O. */
export function getStandard(
  items: ReadonlyArray<Standard>,
  id: string,
): Standard | undefined {
  return items.find((s) => s.id === id);
}

export function getTemplate(
  items: ReadonlyArray<Template>,
  id: string,
): Template | undefined {
  return items.find((t) => t.id === id);
}

export function getPolicy(
  items: ReadonlyArray<Policy>,
  id: string,
): Policy | undefined {
  return items.find((p) => p.id === id);
}

export const CATEGORY_LABEL: Record<StandardCategory, string> = {
  architecture: 'Architecture',
  security: 'Security',
  quality: 'Quality',
  operations: 'Operations',
  documentation: 'Documentation',
};

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  prd: 'PRD',
  adr: 'ADR',
  contract: 'API Contract',
  task: 'Task Breakdown',
  risk: 'Risk Register',
  security: 'Security Report',
};

export const POLICY_EFFECT_LABEL: Record<PolicyEffect, string> = {
  allow: 'Allow',
  deny: 'Deny',
  'require-approval': 'Require approval',
  notify: 'Notify',
};
