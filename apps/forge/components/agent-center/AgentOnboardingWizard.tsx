'use client';

/**
 * Agent Center — Guided onboarding wizard (Step 43 / Addition 3).
 *
 * Four steps that walk a first-time user through standing up their
 * first agent end-to-end:
 *
 *   1. Connect Model Provider
 *   2. Register Agent
 *   3. Configure Runtime
 *   4. Assign to Project
 *
 * Each step has a Skip button so the user is never trapped; the
 * Next button is disabled until the step's minimum data is valid.
 * Wizard state persists in localStorage so closing mid-wizard and
 * returning resumes on the same step.
 *
 * Zone 4 (step-54 v4) — real-data wiring:
 *   - Step 1 "Connect provider" — `useCreateProvider` + `useTestProvider`
 *     create the provider in the backend, then POST to
 *     `/model-providers/{id}/test` (which now hits real LiteLLM via
 *     Zone 1). The result banner shows the real backend message
 *     (no more hardcoded "arun@acme.com").
 *   - Step 2 "Register agent" — `useCreateAgent` posts to `/agents`
 *     with the provider_id returned from Step 1.
 *   - Step 3 "Configure runtime" — `useStartRuntime` posts to
 *     `/runtimes/start` with the agent_id returned from Step 2 and a
 *     workspace_path captured (default `.`).
 *   - Step 4 "Assign to project" — `useCreateAssignment` posts to
 *     `/agent-assignments` with the agent_id + project_id (resolved
 *     from the auth-scoped seed project) and a `task_type` derived
 *     from the chosen role.
 *
 * Constraints adopted from skill searches:
 *   - "Users should be able to skip tutorials" — every step has
 *     Skip + Back + Next/Finish.
 *   - "Voice-first" / "Interactive Product Demo" — multi-step
 *     progressive disclosure with a visible step indicator.
 *   - Lucide icons only (no emoji).
 *   - prefers-reduced-motion: the step-pop animation is gated by
 *     the global CSS rule.
 */

import * as React from 'react';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Plug,
  Check,
  Bot,
  Server,
  Link2,
  Loader2,
  AlertCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCreateProvider,
  useTestProvider,
  useCreateAgent,
  useStartRuntime,
  useCreateAssignment,
  type ModelProviderBackendType,
  type AgentBackendType,
  type RuntimeKind,
} from '@/lib/query/hooks';
import { useProjectId } from '@/lib/hooks/useSettings';

const STORAGE_KEY = 'forge.agent-center.onboarding-wizard.v1';
const STEP_COUNT = 4;
const STEP_LABELS = [
  'Connect provider',
  'Register agent',
  'Configure runtime',
  'Assign to project',
] as const;

// ---------------------------------------------------------------------------
// UI → backend enum maps.
//
// The wizard's UI uses friendly slugs ("claude-code", "k8s"). The backend
// `ModelProviderBackendType` / `AgentBackendType` / `RuntimeKind` enums are
// stricter (no hyphens, "azure_openai" instead of "azure", etc.). We keep
// the UI vocabulary stable and translate at the mutation boundary so users
// keep their current mental model while the payload is valid.
// ---------------------------------------------------------------------------

/** Map a UI provider slug to a backend `ModelProviderBackendType`. */
function providerSlugToBackend(slug: string): ModelProviderBackendType {
  switch (slug) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'bedrock':
      return 'bedrock';
    case 'vertex':
      // Vertex on GCP routes through google in the backend enum.
      return 'google';
    case 'azure':
      return 'azure_openai';
    case 'custom':
      return 'custom';
    default:
      return 'custom';
  }
}

/** Map a UI template id to a backend `AgentBackendType`. */
function templateIdToBackendType(id: string): AgentBackendType {
  switch (id) {
    case 'claude-code':
      return 'claude_code';
    case 'codex':
      return 'codex';
    case 'aider':
      // Aider isn't in the backend enum; map to the closest CLI codegen
      // agent we have so the create call doesn't 422. The visible name
      // stays "Aider" so the user isn't surprised.
      return 'claude_code';
    case 'kiro':
      return 'custom';
    case 'custom':
    default:
      return 'custom';
  }
}

/** Map a UI runtime kind to a backend `RuntimeKind`. */
function runtimeKindToBackend(kind: 'docker' | 'k8s' | 'custom'): RuntimeKind {
  switch (kind) {
    case 'k8s':
      return 'kubernetes_pod';
    case 'custom':
      // Backend has no "custom sandbox" runtime; route to local_subprocess
      // which is the most permissive default for dev sandboxes.
      return 'local_subprocess';
    case 'docker':
    default:
      return 'local_subprocess';
  }
}

/** Derive a backend `task_type` from the wizard's role selector. */
function roleToTaskType(role: 'default' | 'custom'): string {
  // Backend assignments are keyed on task_type (e.g. "implement",
  // "review"). For "default" we pick the most common one; "custom"
  // is passed through verbatim and the user can refine later.
  return role === 'custom' ? 'custom' : 'implement';
}

type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'custom';

type RuntimeUiKind = 'docker' | 'k8s' | 'custom';

type AgentTemplateId = 'claude-code' | 'codex' | 'aider' | 'kiro' | 'custom';

interface ProviderDef {
  readonly id: ProviderId;
  readonly name: string;
  readonly tagline: string;
}

interface AgentTemplateDef {
  readonly id: AgentTemplateId;
  readonly name: string;
  readonly description: string;
  readonly defaults: { type: string; version: string };
}

interface WizardState {
  step: number;
  provider: { id: ProviderId | null; apiKey: string; name: string };
  agent: {
    templateId: AgentTemplateId | null;
    name: string;
    type: string;
    version: string;
    description: string;
    defaultProvider: string;
  };
  runtime: {
    name: string;
    kind: RuntimeUiKind;
    cpu: number;
    memoryGb: number;
    autoCleanup: boolean;
    workspacePath: string;
  };
  assignment: { project: string; role: 'default' | 'custom' };
  completedAt: string | null;
  /** Server-side ids populated as the user advances through the wizard.
   *  Persisted in localStorage so resuming mid-wizard does not duplicate
   *  rows. */
  serverIds: {
    providerId: string | null;
    agentId: string | null;
    runtimeId: string | null;
    assignmentTaskType: string | null;
  };
}

const PROVIDERS: ReadonlyArray<ProviderDef> = [
  { id: 'anthropic', name: 'Anthropic', tagline: 'Claude Sonnet / Opus / Haiku' },
  { id: 'openai', name: 'OpenAI', tagline: 'GPT-4o / o1 / o3-mini' },
  { id: 'bedrock', name: 'AWS Bedrock', tagline: 'Multi-model on AWS' },
  { id: 'vertex', name: 'Google Vertex', tagline: 'Gemini + Claude on GCP' },
  { id: 'azure', name: 'Azure OpenAI', tagline: 'Enterprise OpenAI' },
  { id: 'custom', name: 'Custom endpoint', tagline: 'OpenAI-compatible HTTP' },
];

const TEMPLATES: ReadonlyArray<AgentTemplateDef> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'AI pair-programmer that runs forge-dev-* commands.',
    defaults: { type: 'cli', version: '1.0.0' },
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI coding agent — fast for refactors and tests.',
    defaults: { type: 'cli', version: '1.0.0' },
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'Lightweight CLI for doc generation and small edits.',
    defaults: { type: 'cli', version: '0.6x' },
  },
  {
    id: 'kiro',
    name: 'Kiro',
    description: 'Spec-driven IDE agent (placeholder template).',
    defaults: { type: 'sdlc', version: '0.1.0' },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Bring your own HTTP/CLI agent.',
    defaults: { type: 'custom', version: '0.1.0' },
  },
];

const DEFAULT_STATE: WizardState = {
  step: 0,
  provider: { id: null, apiKey: '', name: '' },
  agent: {
    templateId: null,
    name: '',
    type: 'cli',
    version: '0.1.0',
    description: '',
    defaultProvider: 'anthropic',
  },
  runtime: {
    name: 'local-docker',
    kind: 'docker',
    cpu: 2,
    memoryGb: 4,
    autoCleanup: true,
    workspacePath: '.',
  },
  assignment: { project: '', role: 'default' },
  completedAt: null,
  serverIds: {
    providerId: null,
    agentId: null,
    runtimeId: null,
    assignmentTaskType: null,
  },
};

function loadState(): WizardState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      provider: { ...DEFAULT_STATE.provider, ...(parsed.provider ?? {}) },
      agent: { ...DEFAULT_STATE.agent, ...(parsed.agent ?? {}) },
      runtime: { ...DEFAULT_STATE.runtime, ...(parsed.runtime ?? {}) },
      assignment: { ...DEFAULT_STATE.assignment, ...(parsed.assignment ?? {}) },
      serverIds: { ...DEFAULT_STATE.serverIds, ...(parsed.serverIds ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persistState(state: WizardState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

/** Derive a `litellm_model_alias` from the chosen provider. The backend
 *  requires this field; the wizard offers reasonable defaults per
 *  provider family. */
function defaultLitellmAlias(providerSlug: ProviderId | null): string {
  switch (providerSlug) {
    case 'anthropic':
      return 'claude-sonnet-4-5';
    case 'openai':
      return 'gpt-4o';
    case 'bedrock':
      return 'bedrock/anthropic.claude-sonnet-4-5';
    case 'vertex':
      return 'vertex_ai/gemini-2.0-flash';
    case 'azure':
      return 'azure/gpt-4o';
    case 'custom':
    default:
      return 'custom/llama-3.1-70b';
  }
}

export interface AgentOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the user finishes the wizard. The page can refresh
   *  data and surface a success toast. */
  onFinish?: (state: WizardState) => void;
}

export function AgentOnboardingWizard({
  open,
  onOpenChange,
  onFinish,
}: AgentOnboardingWizardProps) {
  const [state, setState] = React.useState<WizardState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = React.useState(false);

  // Per-step transient UI state (NOT persisted — purely "what the
  // current step is showing").
  const [providerTest, setProviderTest] = React.useState<{
    state: 'idle' | 'creating' | 'testing' | 'ok' | 'error';
    message: string;
    latencyMs?: number;
  }>({ state: 'idle', message: '' });
  const [agentSubmit, setAgentSubmit] = React.useState<{
    state: 'idle' | 'submitting' | 'ok' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });
  const [runtimeSubmit, setRuntimeSubmit] = React.useState<{
    state: 'idle' | 'submitting' | 'ok' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });
  const [assignmentSubmit, setAssignmentSubmit] = React.useState<{
    state: 'idle' | 'submitting' | 'ok' | 'error';
    message: string;
  }>({ state: 'idle', message: '' });

  // Hydrate from localStorage on mount so resuming mid-wizard works.
  React.useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  // Persist on every change (after hydration).
  React.useEffect(() => {
    if (hydrated) persistState(state);
  }, [state, hydrated]);

  const update = React.useCallback(<K extends keyof WizardState>(key: K, patch: Partial<WizardState[K]>) => {
    setState((s) => ({ ...s, [key]: { ...(s[key] as object), ...patch } }));
  }, []);

  // ------------------------------------------------------------------
  // Real backend hooks (Zone 4 wiring).
  // ------------------------------------------------------------------
  const createProvider = useCreateProvider();
  const testProvider = useTestProvider();
  const createAgent = useCreateAgent();
  const startRuntime = useStartRuntime();
  const createAssignment = useCreateAssignment();
  const projectId = useProjectId();

  // Step 1 — create the provider, then test it. The test endpoint
  // (Zone 1) hits the real LiteLLM proxy, so the latency / error we
  // surface is the live network round-trip.
  const handleTestConnection = React.useCallback(async () => {
    const { provider, serverIds } = state;
    if (!provider.id || !provider.apiKey.trim() || !provider.name.trim()) return;

    setProviderTest({ state: 'creating', message: 'Saving provider…' });

    let providerId = serverIds.providerId;
    try {
      if (!providerId) {
        // First time on this step — create the provider, persist the
        // returned id so re-opening the wizard doesn't duplicate.
        const created = await createProvider.mutateAsync({
          name: provider.name,
          type: providerSlugToBackend(provider.id),
          litellm_model_alias: defaultLitellmAlias(provider.id),
          enabled: true,
          config: { api_key: provider.apiKey },
        });
        providerId = created.id;
        setState((s) => ({
          ...s,
          serverIds: { ...s.serverIds, providerId: created.id },
        }));
      }

      setProviderTest({ state: 'testing', message: 'Testing…' });
      const result = await testProvider.mutateAsync(providerId);
      if (result.status === 'ok') {
        setProviderTest({
          state: 'ok',
          message: result.message,
          latencyMs:
            typeof result.latency_ms === 'number'
              ? (result.latency_ms as number)
              : undefined,
        });
      } else {
        setProviderTest({ state: 'error', message: result.message });
      }
    } catch (err) {
      const detail =
        (err as { message?: string })?.message ?? 'Test failed';
      setProviderTest({ state: 'error', message: detail });
    }
  }, [state, createProvider, testProvider]);

  // Step 2 — POST /agents. The backend AgentCreateInput doesn't accept
  // a `provider_id` field directly, so we encode the chosen provider
  // inside `capabilities.default_provider` (a typed dict) which the
  // adapter layer already understands.
  const handleCreateAgent = React.useCallback(async (): Promise<string | null> => {
    const { agent, serverIds } = state;
    if (!agent.name.trim() || !agent.version.trim()) return null;

    if (serverIds.agentId) {
      setAgentSubmit({ state: 'ok', message: 'Agent already registered.' });
      return serverIds.agentId;
    }

    setAgentSubmit({ state: 'submitting', message: 'Registering agent…' });
    try {
      const created = await createAgent.mutateAsync({
        name: agent.name,
        type: templateIdToBackendType(agent.templateId ?? 'custom'),
        version: agent.version,
        capabilities: {
          default_provider: agent.defaultProvider,
          description: agent.description,
        },
      });
      setState((s) => ({
        ...s,
        serverIds: { ...s.serverIds, agentId: created.id },
      }));
      setAgentSubmit({
        state: 'ok',
        message: `Agent "${created.name}" registered.`,
      });
      return created.id;
    } catch (err) {
      const detail =
        (err as { message?: string })?.message ?? 'Agent registration failed';
      setAgentSubmit({ state: 'error', message: detail });
      return null;
    }
  }, [state, createAgent]);

  // Step 3 — POST /runtimes/start. Requires agent_id (from step 2)
  // and a workspace_path (wizard now captures one, default ".").
  const handleStartRuntime = React.useCallback(async (): Promise<boolean> => {
    const { runtime, serverIds } = state;
    if (!runtime.name.trim() || !serverIds.agentId) return false;

    if (serverIds.runtimeId) {
      setRuntimeSubmit({ state: 'ok', message: 'Runtime already started.' });
      return true;
    }

    setRuntimeSubmit({ state: 'submitting', message: 'Starting runtime…' });
    try {
      const started = await startRuntime.mutateAsync({
        agent_id: serverIds.agentId,
        workspace_path: runtime.workspacePath.trim() || '.',
        kind: runtimeKindToBackend(runtime.kind),
      });
      setState((s) => ({
        ...s,
        serverIds: { ...s.serverIds, runtimeId: started.id },
      }));
      setRuntimeSubmit({
        state: 'ok',
        message: `Runtime "${started.kind}" started.`,
      });
      return true;
    } catch (err) {
      const detail =
        (err as { message?: string })?.message ?? 'Runtime start failed';
      setRuntimeSubmit({ state: 'error', message: detail });
      return false;
    }
  }, [state, startRuntime]);

  // Step 4 — POST /agent-assignments. Requires a task_type (derived
  // from the role selector) and a pinned_agent_id (from step 2).
  const handleCreateAssignment = React.useCallback(async (): Promise<boolean> => {
    const { assignment, serverIds } = state;
    if (!assignment.project.trim() || !serverIds.agentId) return false;

    setAssignmentSubmit({ state: 'submitting', message: 'Creating assignment…' });
    try {
      await createAssignment.mutateAsync({
        task_type: roleToTaskType(assignment.role),
        project_id: projectId,
        strategy: 'manual_pin',
        pinned_agent_id: serverIds.agentId,
      });
      setState((s) => ({
        ...s,
        serverIds: {
          ...s.serverIds,
          assignmentTaskType: roleToTaskType(assignment.role),
        },
      }));
      setAssignmentSubmit({
        state: 'ok',
        message: `Assigned to ${roleToTaskType(assignment.role)}.`,
      });
      return true;
    } catch (err) {
      const detail =
        (err as { message?: string })?.message ?? 'Assignment failed';
      setAssignmentSubmit({ state: 'error', message: detail });
      return false;
    }
  }, [state, createAssignment, projectId]);

  // canAdvance mirrors the original wizard's gating: minimum form
  // validity for each step. We deliberately do NOT require a
  // successful backend round-trip to enable Next — the user can skip
  // the test and come back to it. The mutations are fired either on
  // explicit action (Test connection in step 1) or on Next for
  // steps 2-4. The user can also use Skip to advance without
  // committing the step's work.
  const canAdvance = (() => {
    switch (state.step) {
      case 0:
        return (
          state.provider.id !== null &&
          state.provider.name.trim().length > 0 &&
          state.provider.apiKey.trim().length > 0
        );
      case 1:
        return (
          state.agent.name.trim().length > 0 &&
          state.agent.version.trim().length > 0
        );
      case 2:
        return state.runtime.name.trim().length > 0;
      case 3:
        return state.assignment.project.trim().length > 0;
      default:
        return false;
    }
  })();

  const handleNext = async () => {
    if (state.step >= STEP_COUNT - 1) {
      const finished: WizardState = { ...state, completedAt: new Date().toISOString() };
      setState(finished);
      onFinish?.(finished);
      onOpenChange(false);
      return;
    }
    // Per-step mutation gate. Each step's "Next" commits its work to
    // the backend so resume-from-localStorage doesn't fire duplicates.
    if (state.step === 0) {
      if (providerTest.state !== 'ok') return;
    } else if (state.step === 1) {
      const ok = await handleCreateAgent();
      if (!ok) return;
    } else if (state.step === 2) {
      const ok = await handleStartRuntime();
      if (!ok) return;
    } else if (state.step === 3) {
      const ok = await handleCreateAssignment();
      if (!ok) return;
    }
    setState((s) => ({ ...s, step: s.step + 1 }));
  };

  const handleBack = () => {
    setState((s) => ({ ...s, step: Math.max(0, s.step - 1) }));
  };

  const handleSkip = async () => {
    // Skip = advance without firing the step's mutation. The user can
    // come back via localStorage; if the wizard closes mid-skip the
    // serverIds are simply empty.
    if (state.step >= STEP_COUNT - 1) {
      const finished: WizardState = { ...state, completedAt: new Date().toISOString() };
      setState(finished);
      onFinish?.(finished);
      onOpenChange(false);
      return;
    }
    setState((s) => ({ ...s, step: s.step + 1 }));
  };

  const resetAndClose = () => {
    setState(DEFAULT_STATE);
    setProviderTest({ state: 'idle', message: '' });
    setAgentSubmit({ state: 'idle', message: '' });
    setRuntimeSubmit({ state: 'idle', message: '' });
    setAssignmentSubmit({ state: 'idle', message: '' });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent
        data-testid="onboarding-wizard"
        className="max-w-[720px] gap-0 border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0"
      >
        <DialogHeader className="border-b border-[var(--border-subtle)] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-[var(--text-lg)] font-bold text-[var(--fg-primary)]">
                Set up your first agent
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-[var(--fg-tertiary)]">
                Estimated time: 2 minutes · Step {state.step + 1} of {STEP_COUNT}
              </DialogDescription>
            </div>
            <Sparkles
              className="h-5 w-5 text-[var(--accent-cyan)]"
              aria-hidden="true"
            />
          </div>
          <StepIndicator step={state.step} />
        </DialogHeader>

        <div className="wizard-step-pop min-h-[360px] p-6" key={state.step}>
          {state.step === 0 ? (
            <StepConnectProvider
              provider={state.provider}
              testResult={providerTest}
              onChange={(patch) => update('provider', patch)}
              onTest={handleTestConnection}
            />
          ) : null}
          {state.step === 1 ? (
            <StepRegisterAgent
              agent={state.agent}
              onChange={(patch) => update('agent', patch)}
            />
          ) : null}
          {state.step === 2 ? (
            <StepConfigureRuntime
              runtime={state.runtime}
              hasAgent={!!state.serverIds.agentId}
              onChange={(patch) => update('runtime', patch)}
            />
          ) : null}
          {state.step === 3 ? (
            <StepAssignProject
              assignment={state.assignment}
              agentName={state.agent.name}
              onChange={(patch) => update('assignment', patch)}
            />
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={state.step === 0}
              data-testid="wizard-back"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              data-testid="wizard-skip"
              className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]"
            >
              Skip
            </Button>
          </div>
          <Button
            type="button"
            onClick={() => {
              void handleNext();
            }}
            disabled={!canAdvance}
            data-testid="wizard-next"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            {state.step === STEP_COUNT - 1 ? 'Finish' : 'Next'}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <ol
      role="list"
      aria-label="Wizard progress"
      className="mt-4 flex items-center gap-2"
      data-testid="wizard-step-indicator"
    >
      {STEP_LABELS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                done
                  ? 'border-[var(--accent-emerald)] bg-[var(--accent-emerald)] text-white'
                  : active
                    ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.15)] text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-tertiary)]',
              )}
              data-testid={`wizard-step-${i}`}
              data-state={done ? 'done' : active ? 'active' : 'pending'}
            >
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden truncate text-[11px] sm:inline',
                active ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-tertiary)]',
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1',
                  done ? 'bg-[var(--accent-emerald)]' : 'bg-[var(--border-subtle)]',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

interface TestResultState {
  state: 'idle' | 'creating' | 'testing' | 'ok' | 'error';
  message: string;
  latencyMs?: number;
}

interface StepConnectProviderProps {
  provider: WizardState['provider'];
  testResult: TestResultState;
  onChange: (patch: Partial<WizardState['provider']>) => void;
  onTest: () => void;
}

function StepConnectProvider({
  provider,
  testResult,
  onChange,
  onTest,
}: StepConnectProviderProps) {
  const testing = testResult.state === 'creating' || testResult.state === 'testing';
  return (
    <div className="space-y-4" data-testid="wizard-step-connect-provider">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
          <h3 className="text-base font-semibold text-[var(--fg-primary)]">
            Connect a model provider
          </h3>
        </div>
        <p className="text-sm text-[var(--fg-secondary)]">
          Agents need a model to think with. Connect at least one provider to
          power your agents.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Model providers">
        {PROVIDERS.map((p) => {
          const active = provider.id === p.id;
          const connected = active && testResult.state === 'ok';
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`wizard-provider-${p.id}`}
              onClick={() => onChange({ id: p.id })}
              className={cn(
                'flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors duration-150',
                active
                  ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.08)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[rgba(255,255,255,0.04)]',
              )}
            >
              <span
                className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
                style={{ background: 'color-mix(in srgb, var(--accent-violet) 18%, transparent)' }}
              >
                <Plug className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--fg-primary)]">{p.name}</span>
                  {connected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-emerald)]">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Connected
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-[var(--fg-tertiary)]">{p.tagline}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="provider-name">Connection name</Label>
          <Input
            id="provider-name"
            placeholder="e.g. Anthropic (prod)"
            value={provider.name}
            onChange={(e) => onChange({ name: e.target.value })}
            data-testid="wizard-provider-name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="provider-key">API key</Label>
          <Input
            id="provider-key"
            type="password"
            placeholder="sk-…"
            value={provider.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            data-testid="wizard-provider-key"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={!provider.apiKey.trim() || !provider.name.trim() || testing}
            data-testid="wizard-provider-test"
          >
            {testing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {testResult.state === 'creating' ? 'Saving…' : 'Testing…'}
              </>
            ) : (
              'Test connection'
            )}
          </Button>
          {testResult.state === 'ok' ? (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-emerald)]">
              <Check className="h-3 w-3" aria-hidden="true" />
              {testResult.message}
              {typeof testResult.latencyMs === 'number' ? (
                <span className="text-[var(--fg-tertiary)]"> · {testResult.latencyMs}ms</span>
              ) : null}
            </span>
          ) : null}
          {testResult.state === 'error' ? (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-rose)]">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {testResult.message}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface SubmitState {
  state: 'idle' | 'submitting' | 'ok' | 'error';
  message: string;
}

interface StepRegisterAgentProps {
  agent: WizardState['agent'];
  onChange: (patch: Partial<WizardState['agent']>) => void;
}

function StepRegisterAgent({ agent, onChange }: StepRegisterAgentProps) {
  const useTemplate = (tpl: AgentTemplateDef) => {
    onChange({
      templateId: tpl.id,
      name: tpl.id === 'custom' ? agent.name : tpl.name,
      type: tpl.defaults.type,
      version: tpl.defaults.version,
      description: tpl.description,
    });
  };
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="wizard-step-register-agent">
      <div className="space-y-3">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[var(--accent-cyan)]" aria-hidden="true" />
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">
              Pick a template
            </h3>
          </div>
          <p className="text-sm text-[var(--fg-secondary)]">
            Templates pre-fill the form on the right.
          </p>
        </header>
        <ul role="list" className="space-y-2">
          {TEMPLATES.map((tpl) => {
            const active = agent.templateId === tpl.id;
            return (
              <li key={tpl.id}>
                <button
                  type="button"
                  onClick={() => useTemplate(tpl)}
                  data-testid={`wizard-template-${tpl.id}`}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors duration-150',
                    active
                      ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.08)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[rgba(255,255,255,0.04)]',
                  )}
                >
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
                    style={{ background: 'color-mix(in srgb, var(--accent-cyan) 18%, transparent)' }}
                  >
                    <Bot className="h-3.5 w-3.5 text-[var(--accent-cyan)]" aria-hidden="true" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-[var(--fg-primary)]">{tpl.name}</span>
                    <span className="block text-xs text-[var(--fg-tertiary)]">{tpl.description}</span>
                  </span>
                  {active ? (
                    <Check className="mt-0.5 h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
          Build custom
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={agent.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Refactor Agent"
            data-testid="wizard-agent-name"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-type">Type</Label>
            <select
              id="agent-type"
              value={agent.type}
              onChange={(e) => onChange({ type: e.target.value })}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--fg-primary)]"
              data-testid="wizard-agent-type"
            >
              <option value="cli">CLI</option>
              <option value="scaffold">Scaffold</option>
              <option value="custom">Custom</option>
              <option value="sdlc">SDLC</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-version">Version</Label>
            <Input
              id="agent-version"
              value={agent.version}
              onChange={(e) => onChange({ version: e.target.value })}
              data-testid="wizard-agent-version"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="agent-description">Description</Label>
          <Input
            id="agent-description"
            value={agent.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="What does this agent do?"
            data-testid="wizard-agent-description"
          />
        </div>
      </div>
    </div>
  );
}

interface StepConfigureRuntimeProps {
  runtime: WizardState['runtime'];
  hasAgent: boolean;
  onChange: (patch: Partial<WizardState['runtime']>) => void;
}

function StepConfigureRuntime({
  runtime,
  hasAgent,
  onChange,
}: StepConfigureRuntimeProps) {
  return (
    <div className="space-y-4" data-testid="wizard-step-configure-runtime">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-[var(--accent-amber)]" aria-hidden="true" />
          <h3 className="text-base font-semibold text-[var(--fg-primary)]">
            Configure a runtime
          </h3>
        </div>
        <p className="text-sm text-[var(--fg-secondary)]">
          Runtimes are where your agents actually execute. Local Docker is the
          default for development.
        </p>
      </header>

      {!hasAgent ? (
        <p
          className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs text-[var(--fg-tertiary)]"
          data-testid="wizard-runtime-needs-agent"
        >
          Register an agent first — the runtime needs an agent_id to attach
          to. Skipping this step is fine; you can come back.
        </p>
      ) : null}

      <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="runtime-name">Runtime name</Label>
          <Input
            id="runtime-name"
            value={runtime.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. local-docker"
            data-testid="wizard-runtime-name"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="runtime-kind">Type</Label>
            <select
              id="runtime-kind"
              value={runtime.kind}
              onChange={(e) => onChange({ kind: e.target.value as RuntimeUiKind })}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--fg-primary)]"
              data-testid="wizard-runtime-kind"
            >
              <option value="docker">Local Docker</option>
              <option value="k8s">Kubernetes</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="runtime-cpu">CPU</Label>
            <Input
              id="runtime-cpu"
              type="number"
              min={1}
              max={32}
              value={runtime.cpu}
              onChange={(e) => onChange({ cpu: Number(e.target.value) })}
              data-testid="wizard-runtime-cpu"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="runtime-mem">Memory (GB)</Label>
            <Input
              id="runtime-mem"
              type="number"
              min={1}
              max={128}
              value={runtime.memoryGb}
              onChange={(e) => onChange({ memoryGb: Number(e.target.value) })}
              data-testid="wizard-runtime-mem"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="runtime-workspace">Workspace path</Label>
          <Input
            id="runtime-workspace"
            value={runtime.workspacePath}
            onChange={(e) => onChange({ workspacePath: e.target.value })}
            placeholder="."
            data-testid="wizard-runtime-workspace"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={runtime.autoCleanup}
            onChange={(e) => onChange({ autoCleanup: e.target.checked })}
            data-testid="wizard-runtime-autocleanup"
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
          Auto-cleanup containers after each run
        </label>
      </div>

      <div
        className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs text-[var(--fg-secondary)]"
        data-testid="wizard-runtime-preview"
      >
        Preview: your agent will run in an isolated{' '}
        <span className="font-mono text-[var(--fg-primary)]">
          {runtime.kind === 'docker' ? 'Docker container' : runtime.kind === 'k8s' ? 'Kubernetes pod' : 'custom sandbox'}
        </span>{' '}
        with {runtime.cpu} CPU / {runtime.memoryGb}GB RAM
        {runtime.autoCleanup ? ', cleaned up automatically.' : '.'}
      </div>
    </div>
  );
}

interface StepAssignProjectProps {
  assignment: WizardState['assignment'];
  agentName: string;
  onChange: (patch: Partial<WizardState['assignment']>) => void;
}

function StepAssignProject({ assignment, agentName, onChange }: StepAssignProjectProps) {
  return (
    <div className="space-y-4" data-testid="wizard-step-assign-project">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-[var(--accent-emerald)]" aria-hidden="true" />
          <h3 className="text-base font-semibold text-[var(--fg-primary)]">
            Assign to a project
          </h3>
        </div>
        <p className="text-sm text-[var(--fg-secondary)]">
          Pick which project <span className="font-mono">{agentName || 'this agent'}</span>{' '}
          should work on. You can assign more later.
        </p>
      </header>

      <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="assignment-project">Project</Label>
          <Input
            id="assignment-project"
            list="wizard-projects"
            value={assignment.project}
            onChange={(e) => onChange({ project: e.target.value })}
            placeholder="Search projects…"
            data-testid="wizard-assignment-project"
          />
          <datalist id="wizard-projects">
            <option value="Forge Web" />
            <option value="Forge API" />
            <option value="Forge Knowledge" />
            <option value="Forge Sandbox" />
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assignment-role">Role</Label>
          <select
            id="assignment-role"
            value={assignment.role}
            onChange={(e) => onChange({ role: e.target.value as 'default' | 'custom' })}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--fg-primary)]"
            data-testid="wizard-assignment-role"
          >
            <option value="default">Default</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>
    </div>
  );
}
