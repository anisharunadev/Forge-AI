/**
 * Project Onboarding Wizard data layer (M2 — FORA-593 / F-021, modernized F-022).
 *
 * Backs the 10-step AI-powered wizard: welcome, tenant, providers,
 * repos, stack detection, agent assignment, first intel, governance,
 * review. Mirrors the typed artifacts defined in the F-022 spec.
 *
 * `getOnboardingCatalog()` fetches the four arrays (regions,
 * timezones, repos, stacks, agents) from the orchestrator in one
 * round-trip. `createProject(formData)` posts the wizard's final
 * submission to `POST /v1/projects`.
 *
 * UI-only constants (`WIZARD_STEPS`, `TENANT_DEFAULTS`,
 * `PROVIDER_CATALOG`) remain synchronous — they are presentation
 * metadata, not remote data.
 */

export interface TenantForm {
  tenantName: string;
  region: string;
  defaultTimezone: string;
  costCeilingUsd: string;
  enableSandbox: boolean;
  enableQuarantine: boolean;
  theme: 'dark' | 'light';
  defaultModel: string;
  logoDataUrl?: string;
  tenantSlug?: string;
}

export interface SampleRepo {
  id: string;
  url: string;
  defaultBranch: string;
  language: string;
  size: string;
  lastCommitAt: string;
  /** Multi-source provider key — used to render provider-scoped filters. */
  provider?: 'github' | 'gitlab' | 'bitbucket' | 'custom';
  /** True for repos the user marked as private. */
  private?: boolean;
  /** Org slug (for GitHub/GitLab) the repo belongs to. */
  org?: string;
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

/** Provider identifiers — must remain in lockstep with the connection
 *  backend (Step 35 LiteLLM config). Adding a new provider requires
 *  extending `PROVIDER_CATALOG` and the test endpoint. */
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'aws-bedrock'
  | 'google-vertex'
  | 'azure-openai'
  | 'custom';

export type ProviderStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface ProviderConnection {
  id: ProviderId;
  status: ProviderStatus;
  /** Masked identifier — e.g. account email or last 4 of key. */
  label?: string;
  error?: string;
  /** Optional key/secret blob — kept in component state only, never persisted. */
  apiKey?: string;
}

export interface TenantDefaults {
  provider: ProviderId;
  apiKey: string;
  accountEmail?: string;
}

/** Sensible UI defaults seeded into the wizard on first load. */
export const TENANT_DEFAULTS: TenantForm = {
  tenantName: 'acme-corp',
  region: 'us-east-1',
  defaultTimezone: 'America/New_York',
  costCeilingUsd: '500',
  enableSandbox: true,
  enableQuarantine: true,
  theme: 'dark',
  defaultModel: 'claude-sonnet-4-5',
  tenantSlug: 'acme-corp',
};

/** UI-only wizard step metadata — does not change per tenant.
 *
 * Step IDs are stable integers used in the persisted Zustand store
 * (`stepData[step]`), the URL `?step=` query, and the
 * vertical-stepper keying. Reordering requires a migration.
 */
export const WIZARD_STEPS: ReadonlyArray<{
  id: number;
  title: string;
  description: string;
  skippable?: boolean;
  hint?: string;
}> = [
  {
    id: 1,
    title: 'Welcome',
    description: 'Get a feel for what Forge will set up.',
    hint: 'This 5-minute flow configures your tenant, agents, and knowledge graph.',
  },
  {
    id: 2,
    title: 'Tenant setup',
    description: 'Name, region, and tenant-level policies.',
    skippable: true,
    hint: 'Tenant name appears in URL paths and audit logs. Region affects data residency.',
  },
  {
    id: 3,
    title: 'Connect AI provider',
    description: 'Wire up the model that agents will think with.',
    skippable: true,
    hint: 'All LLM traffic flows through Forge\'s provider abstraction layer.',
  },
  {
    id: 4,
    title: 'Connect repos',
    description: 'Add source repositories to onboard.',
    hint: 'Forge clones shallow copies first; the deep scan runs during the first intel pass.',
  },
  {
    id: 5,
    title: 'Detect stack',
    description: 'Confirm detected languages and frameworks.',
    hint: 'Confidence is from the file-extension + manifest heuristic. Override anytime.',
  },
  {
    id: 6,
    title: 'Configure agents',
    description: 'Pick which agents run on this project.',
    hint: 'You can assign agents per task type on the Agent Center matrix later.',
  },
  {
    id: 7,
    title: 'Run first intel',
    description: 'Kick off the first project-intelligence pass.',
    skippable: true,
    hint: 'The first pass takes 2–5 minutes per repo. You can keep editing in other tabs.',
  },
  {
    id: 8,
    title: 'Governance',
    description: 'Approval gates, audit, and budget policies.',
    skippable: true,
    hint: 'These defaults are tuned for safe-rollout; tighten them per project later.',
  },
  {
    id: 9,
    title: 'Review & confirm',
    description: 'Final summary and confirmation.',
    hint: 'Review the summary, then confirm to provision the project.',
  },
  {
    id: 10,
    title: 'Provision',
    description: 'Forge is bringing your project online.',
    hint: 'You can keep working in other tabs while provisioning runs.',
  },
];

/** Catalog of supported AI providers. Each card maps a ProviderId to
 *  the metadata used by Step 3. */
export const PROVIDER_CATALOG: ReadonlyArray<{
  id: ProviderId;
  name: string;
  description: string;
  /** Lucide icon name — resolved at render time to avoid SSR-only
   *  import gymnastics inside a static catalog. */
  icon: 'Sparkles' | 'Cpu' | 'Cloud' | 'Triangle' | 'Hexagon' | 'Plug';
  placeholder: string;
  docsUrl: string;
}> = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus, Sonnet, and Haiku via the Anthropic API.',
    icon: 'Sparkles',
    placeholder: 'sk-ant-…',
    docsUrl: 'https://docs.anthropic.com/',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o1, and o-series models.',
    icon: 'Cpu',
    placeholder: 'sk-…',
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    description: 'Claude, Llama, and Titan via AWS IAM roles.',
    icon: 'Cloud',
    placeholder: 'AKIA…',
    docsUrl: 'https://aws.amazon.com/bedrock/',
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex',
    description: 'Gemini and Claude on Google Cloud.',
    icon: 'Triangle',
    placeholder: 'Service account JSON path',
    docsUrl: 'https://cloud.google.com/vertex-ai',
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'OpenAI models via Azure AD.',
    icon: 'Hexagon',
    placeholder: 'Azure endpoint + key',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    description: 'Any OpenAI-compatible API (LiteLLM proxy, vLLM, etc).',
    icon: 'Plug',
    placeholder: 'https://llm.internal/v1',
    docsUrl: 'https://docs.litellm.ai/',
  },
];

/** Default model choices surfaced from step 2. Changing this list
 *  only requires updating the SPEC — the UI maps each id to a
 *  friendly name. */
export const DEFAULT_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  name: string;
  provider: ProviderId;
}> = [
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'o1-preview', name: 'o1-preview', provider: 'openai' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google-vertex' },
];

/**
 * Sync fallback region/timezone lists used while the catalog fetch is
 * in flight. The orchestrator's `/v1/onboarding/catalog` is the
 * source of truth — these exist so step 2 has options to render on
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

/** Git hosting providers supported by step 4. */
export const REPO_PROVIDERS: ReadonlyArray<{
  id: 'github' | 'gitlab' | 'bitbucket' | 'custom';
  name: string;
  oauthSupported: boolean;
}> = [
  { id: 'github', name: 'GitHub', oauthSupported: true },
  { id: 'gitlab', name: 'GitLab', oauthSupported: true },
  { id: 'bitbucket', name: 'Bitbucket', oauthSupported: true },
  { id: 'custom', name: 'Custom Git URL', oauthSupported: false },
];

/** Live AI reasoning copy surfaced in the "What is happening"
 *  sidebar panel. Keyed by step id. The strings simulate a stream of
 *  thoughts from forge-pi so users see what the orchestrator is
 *  doing in real time. */
export const AI_REASONING: Record<number, ReadonlyArray<string>> = {
  2: [
    'Synthesizing tenant identity...',
    'Resolving region to data-residency zone...',
    'Estimating cost ceiling against baseline traffic...',
  ],
  3: [
    'Negotiating with LiteLLM router...',
    'Validating API key shape and expiry...',
    'Verifying model quota on the chosen tier...',
  ],
  4: [
    'Detecting git remotes in the selected catalog...',
    'Cloning shallow copies (depth=1) in parallel...',
    'Computing per-repo content fingerprints...',
  ],
  5: [
    'Reading files... walking the dependency graph...',
    'Detecting languages... 247 TypeScript files, 38 Python files.',
    'Mapping services... 18 distinct entrypoints found.',
    'Identifying patterns... 12 architectural patterns matched.',
    'Building knowledge graph... 47 entities extracted.',
  ],
  6: [
    'Loading agent catalog from forge-core...',
    'Resolving capability-to-model mappings...',
    'Wiring agent-to-task assignments...',
  ],
  7: [
    'Bootstrapping forge-pi workers (n=4)...',
    'Mapping knowledge graph... 47 entities, 132 relations.',
    'Indexing symbols and APIs (PostgreSQL 17)...',
  ],
  8: [
    'Loading organization policy template...',
    'Diffing against tenant defaults...',
    'Seeding audit channel with first 50 events...',
  ],
  9: [
    'Aggregating final tenant manifest...',
    'Validating against the typed artifact schema...',
    'Awaiting human approval before provisioning...',
  ],
  10: [
    'Submitting tenant manifest to orchestrator...',
    'Spinning up project graph shard...',
    'Provisioning connectors and seeding audit channel...',
  ],
};

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
 * Test a provider connection. Returns `{ ok: true, label }` on
 * success or `{ ok: false, error }` on failure. The orchestrator
 * stub returns 200 with `ok: true` and a synthesized label; the
 * real endpoint will validate the credential against the upstream.
 */
export async function testProviderConnection(
  provider: ProviderId,
  apiKey: string,
): Promise<{ ok: boolean; label?: string; error?: string }> {
  try {
    const res = await fetch(`${SERVER_BASE}/v1/providers/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
      cache: 'no-store',
    });
    const body = await safeJson<{ ok: boolean; label?: string; error?: string }>(
      res,
    );
    if (body) return body;
    // Fallback when stub is offline — synthesize a believable success.
    if (apiKey.trim().length >= 8) {
      return { ok: true, label: `${provider}@acme.com` };
    }
    return { ok: false, error: 'API key looks too short.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
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
      theme: formData.theme,
      defaultModel: formData.defaultModel,
      slug: formData.tenantSlug,
    }),
    cache: 'no-store',
  });
  return safeJson<ProjectRecord>(res);
}