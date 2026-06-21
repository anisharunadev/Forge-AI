/**
 * Project Onboarding Wizard data layer (M2 — FORA-593 / F-021).
 *
 * Backs the 6-step wizard: tenant, repos, stack detection, agent
 * assignment, first intel, review. Mirrors the typed artifacts
 * defined in the F-021 spec.
 *
 * `getOnboardingCatalog()` fetches the four arrays (regions,
 * timezones, repos, stacks, agents) from the orchestrator in one
 * round-trip. `createProject(formData)` posts the wizard's final
 * submission to `POST /v1/projects`.
 *
 * UI-only constants (`WIZARD_STEPS`, `TENANT_DEFAULTS`) remain
 * synchronous — they are presentation metadata, not remote data.
 */

export interface TenantForm {
  tenantName: string;
  region: string;
  defaultTimezone: string;
  costCeilingUsd: string;
  enableSandbox: boolean;
  enableQuarantine: boolean;
}

export interface SampleRepo {
  id: string;
  url: string;
  defaultBranch: string;
  language: string;
  size: string;
  lastCommitAt: string;
}

export type StackConfidence = 'high' | 'medium' | 'low';

export interface DetectedStack {
  id: string;
  repoId: string;
  language: string;
  framework?: string;
  buildTool?: string;
  testFramework?: string;
  confidence: StackConfidence;
}

export interface AssignableAgent {
  id: string;
  name: string;
  type: string;
  defaultProvider: string;
  description: string;
}

export interface OnboardingCatalog {
  regions: ReadonlyArray<string>;
  timezones: ReadonlyArray<string>;
  repos: ReadonlyArray<SampleRepo>;
  stacks: ReadonlyArray<DetectedStack>;
  agents: ReadonlyArray<AssignableAgent>;
}

/** Sensible UI defaults seeded into the wizard on first load. */
export const TENANT_DEFAULTS: TenantForm = {
  tenantName: 'acme-corp',
  region: 'us-east-1',
  defaultTimezone: 'America/New_York',
  costCeilingUsd: '500',
  enableSandbox: true,
  enableQuarantine: true,
};

/** UI-only wizard step metadata — does not change per tenant. */
export const WIZARD_STEPS: ReadonlyArray<{ id: number; title: string; description: string }> = [
  { id: 1, title: 'Tenant setup', description: 'Name, region, and tenant-level policies.' },
  { id: 2, title: 'Connect repos', description: 'Add source repositories to onboard.' },
  { id: 3, title: 'Detect stack', description: 'Confirm detected languages and frameworks.' },
  { id: 4, title: 'Configure agents', description: 'Pick which agents run on this project.' },
  { id: 5, title: 'Run first intel', description: 'Kick off the first project-intelligence pass.' },
  { id: 6, title: 'Review & confirm', description: 'Final summary and confirmation.' },
];

/**
 * Sync fallback region/timezone lists used while the catalog fetch is
 * in flight. The orchestrator's `/v1/onboarding/catalog` is the
 * source of truth — these exist so step 1 has options to render on
 * first paint before the catalog resolves.
 */
export const REGIONS: ReadonlyArray<string> = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'ap-southeast-1',
];

export const TIMEZONES: ReadonlyArray<string> = [
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
];

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch the wizard catalog — regions, timezones, repos, stacks,
 * and agents — from `/v1/onboarding/catalog`. The orchestrator
 * returns one object with all five arrays.
 */
export async function getOnboardingCatalog(): Promise<OnboardingCatalog> {
  const res = await fetch(`${SERVER_BASE}/v1/onboarding/catalog`, {
    cache: 'no-store',
  });
  const body = await safeJson<OnboardingCatalog>(res);
  return body ?? { regions: [], timezones: [], repos: [], stacks: [], agents: [] };
}

/**
 * Submit the wizard's final tenant form to create a new project.
 * Returns the created project descriptor or `null` if the
 * orchestrator rejected the request.
 */
export interface ProjectRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  status: string;
  createdAt: string;
  name: string;
  region: string;
}

export async function createProject(
  formData: TenantForm,
): Promise<ProjectRecord | null> {
  const res = await fetch(`${SERVER_BASE}/v1/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: formData.tenantName,
      region: formData.region,
      defaultTimezone: formData.defaultTimezone,
      costCeilingUsd: formData.costCeilingUsd,
      enableSandbox: formData.enableSandbox,
      enableQuarantine: formData.enableQuarantine,
    }),
    cache: 'no-store',
  });
  return safeJson<ProjectRecord>(res);
}
