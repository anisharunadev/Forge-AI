'use client';

import * as React from 'react';

import {
  OrchestratorStubBanner,
  WizardShell,
} from '@/components/onboarding/WizardShell';
import { WizardNav } from '@/components/onboarding/WizardNav';
import { StepWelcome } from '@/components/onboarding/StepWelcome';
import { StepTenantSetup } from '@/components/onboarding/StepTenantSetup';
import { StepConnectProviders } from '@/components/onboarding/StepConnectProviders';
import { StepConnectRepos } from '@/components/onboarding/StepConnectRepos';
import { StepDetectStack } from '@/components/onboarding/StepDetectStack';
import { StepConfigureAgents } from '@/components/onboarding/StepConfigureAgents';
import {
  StepRunFirstIntel,
  type IntelState,
} from '@/components/onboarding/StepRunFirstIntel';
import {
  GOVERNANCE_DEFAULTS,
  StepGovernance,
  type GovernanceSettings,
} from '@/components/onboarding/StepGovernance';
import { StepReview } from '@/components/onboarding/StepReview';
import {
  StepProvision,
  type ProvisionState,
} from '@/components/onboarding/StepProvision';
import { useApiData } from '@/hooks/use-api-data';
import {
  pushStepToUrl,
  syncStepFromUrl,
  useOnboardingStore,
} from '@/lib/store';
import {
  PROVIDER_CATALOG,
  TENANT_DEFAULTS,
  WIZARD_STEPS,
  type AssignableAgent,
  type DetectedStack,
  type OnboardingCatalog,
  type ProviderConnection,
  type ProviderId,
  type SampleRepo,
  type TenantForm,
} from '@/lib/onboarding/data';
import { api, ApiError } from '@/lib/api/client';
import { toast } from 'sonner';
import {
  useAdvanceWizard,
  useStartProvision,
  useStartWizard,
  useWizardSession,
} from '@/lib/api/onboarding-hooks';
import type { WizardStepId } from '@/lib/api/onboarding';

const INITIAL_PROVIDERS: Record<ProviderId, ProviderConnection> =
  PROVIDER_CATALOG.reduce(
    (acc, p) => {
      acc[p.id] = { id: p.id, status: 'idle' };
      return acc;
    },
    {} as Record<ProviderId, ProviderConnection>,
  );

// UI step (1..10) → backend wizard step id (snake_case, matches
// `STEP_ORDER` in backend/app/services/project_onboarding/wizard.py).
// Steps with `null` are pure-UI (no backend advance): the local
// state is collected and surfaced to the user, but the wizard service
// doesn't own it. Step 10 (Provision) is a separate `/onboarding/provision`
// job, not an advance call.
const UI_TO_BACKEND_STEP: Record<number, WizardStepId | null> = {
  1: null, // Welcome
  2: 'tenant_setup', // TenantSetup
  3: null, // ConnectProviders
  4: 'connect_repos', // ConnectRepos
  5: 'detect_stack', // DetectStack
  6: 'configure_agents', // ConfigureAgents
  7: 'run_first_intel', // RunFirstIntel
  8: null, // Governance
  9: 'review', // Review (final)
  // 10 = Provision — handled by handleStartProvision, not an advance
};

export default function ProjectOnboardingPage() {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const setStepData = useOnboardingStore((s) => s.setStepData);
  const markTouched = useOnboardingStore((s) => s.markTouched);
  const reset = useOnboardingStore((s) => s.reset);
  const stepData = useOnboardingStore((s) => s.stepData);
  const sessionId = useOnboardingStore((s) => s.sessionId);
  const setSessionId = useOnboardingStore((s) => s.setSessionId);

  // Backend session lifecycle (step-74). The page owns the wizard
  // session id (persisted via Zustand) and polls the backend every
  // 5s so a refresh mid-wizard restores the correct step.
  const startWizard = useStartWizard();
  const session = useWizardSession(sessionId, { refetchInterval: 5_000 });
  const advance = useAdvanceWizard(sessionId);
  const startProvision = useStartProvision();

  // On first mount (or after reset): if we don't have a session id,
  // create one. Persists across refresh via Zustand → localStorage.
  React.useEffect(() => {
    if (!sessionId && !startWizard.isPending && !startWizard.isSuccess) {
      startWizard.mutate(undefined, {
        onSuccess: (s) => setSessionId(s.id),
      });
    }
  }, [sessionId, startWizard, setSessionId]);

  // Resume: if the backend says we're past `currentStep` (e.g. the
  // user refreshed after advancing), jump forward. Don't jump
  // backward — that would surprise a user mid-flow.
  React.useEffect(() => {
    const backendStep = session.data?.current_step;
    if (!backendStep) return;
    const targetIdx = Number(
      Object.entries(UI_TO_BACKEND_STEP).find(
        ([, id]) => id === backendStep,
      )?.[0],
    );
    if (Number.isFinite(targetIdx) && targetIdx > currentStep) {
      setStep(targetIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data?.current_step]);

  // On first mount, pull `?step=` from the URL so deep links land on
  // the correct step. Done after hydration to avoid SSR mismatch.
  React.useEffect(() => {
    syncStepFromUrl();
  }, []);

  // Mirror current step into the URL so refresh preserves progress.
  React.useEffect(() => {
    pushStepToUrl(currentStep);
  }, [currentStep]);

  // Live status of the orchestrator stub — used to gate the warning
  // banner. The 4000ms stale-while-revalidate window keeps the banner
  // sticky across fast remounts.
  const catalogRes = useApiData<OnboardingCatalog>('/v1/onboarding/catalog');
  const catalog = catalogRes.data;
  const reposCatalog: ReadonlyArray<SampleRepo> = catalog?.repos ?? [];
  const stacksCatalog: ReadonlyArray<DetectedStack> = catalog?.stacks ?? [];
  const agentsCatalog: ReadonlyArray<AssignableAgent> = catalog?.agents ?? [];

  const stubReachable = !catalogRes.isLoading && !catalogRes.error;

  // Per-step local state, hydrated from the persisted Zustand store.
  const [tenant, setTenant] = React.useState<TenantForm>(
    () => (stepData[2] as TenantForm | undefined) ?? TENANT_DEFAULTS,
  );
  const [providers, setProviders] = React.useState<
    Record<ProviderId, ProviderConnection>
  >(() => (stepData[3] as Record<ProviderId, ProviderConnection> | undefined) ?? INITIAL_PROVIDERS);
  const [repos, setRepos] = React.useState<SampleRepo[]>(
    () => (stepData[4] as SampleRepo[] | undefined) ?? [],
  );
  const [acceptedStacks, setAcceptedStacks] = React.useState<string[]>(
    () => (stepData[5] as string[] | undefined) ?? [],
  );
  const [overrides, setOverrides] = React.useState<Record<string, string>>(
    () => (stepData[5.5] as Record<string, string> | undefined) ?? {},
  );
  const [selectedAgents, setSelectedAgents] = React.useState<string[]>(
    () =>
      (stepData[6] as string[] | undefined) ?? ['claude-code', 'forge-sdlc'],
  );
  const [intelState, setIntelState] = React.useState<IntelState>(
    () => (stepData[7] as IntelState | undefined) ?? 'idle',
  );
  const [governance, setGovernance] = React.useState<GovernanceSettings>(
    () => (stepData[8] as GovernanceSettings | undefined) ?? GOVERNANCE_DEFAULTS,
  );
  const [provisionState, setProvisionState] = React.useState<ProvisionState>(
    () => (stepData[10] as ProvisionState | undefined) ?? 'idle',
  );
  const [tenantUrl, setTenantUrl] = React.useState<string | undefined>(undefined);
  const [confirming, setConfirming] = React.useState(false);
  const [provisionError, setProvisionError] = React.useState<string | null>(null);

  // Seed catalog values into local state once the wizard catalog loads.
  React.useEffect(() => {
    if (
      stepData[4] == null &&
      repos.length === 0 &&
      reposCatalog.length > 0
    ) {
      setRepos(reposCatalog.slice(0, 2));
    }
  }, [reposCatalog, repos.length, stepData]);
  React.useEffect(() => {
    if (
      stepData[5] == null &&
      acceptedStacks.length === 0 &&
      stacksCatalog.length > 0
    ) {
      setAcceptedStacks(stacksCatalog.map((s) => s.id));
    }
  }, [stacksCatalog, acceptedStacks.length, stepData]);

  // Persist per-step data into the store as the user changes it.
  React.useEffect(() => {
    setStepData(2, tenant);
  }, [tenant, setStepData]);
  React.useEffect(() => {
    setStepData(3, providers);
  }, [providers, setStepData]);
  React.useEffect(() => {
    setStepData(4, repos);
  }, [repos, setStepData]);
  React.useEffect(() => {
    setStepData(5, acceptedStacks);
  }, [acceptedStacks, setStepData]);
  React.useEffect(() => {
    setStepData(5.5, overrides);
  }, [overrides, setStepData]);
  React.useEffect(() => {
    setStepData(6, selectedAgents);
  }, [selectedAgents, setStepData]);
  React.useEffect(() => {
    setStepData(7, intelState);
  }, [intelState, setStepData]);
  React.useEffect(() => {
    setStepData(8, governance);
  }, [governance, setStepData]);
  React.useEffect(() => {
    setStepData(10, provisionState);
  }, [provisionState, setStepData]);

  const total = WIZARD_STEPS.length;

  const connectedProviders = Object.values(providers).filter(
    (p) => p.status === 'connected',
  ).length;

  const canNext = (() => {
    if (currentStep === 1) return true; // welcome → always passable
    if (currentStep === 2)
      return (
        tenant.tenantName.trim().length > 0 &&
        /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i.test(
          tenant.tenantName.trim(),
        ) &&
        tenant.costCeilingUsd.trim().length > 0 &&
        Number.isFinite(Number.parseFloat(tenant.costCeilingUsd)) &&
        Number.parseFloat(tenant.costCeilingUsd) > 0
      );
    if (currentStep === 3) return connectedProviders >= 1; // at least 1 provider
    if (currentStep === 4) return repos.length > 0;
    if (currentStep === 5) return acceptedStacks.length > 0;
    if (currentStep === 6) return selectedAgents.length > 0;
    if (currentStep === 7) return intelState === 'done' || intelState === 'skipped';
    if (currentStep === 8) return true; // governance has defaults — skippable
    if (currentStep === 9) return true;
    return true;
  })();

  const isStepSkippable = (() => {
    const meta = WIZARD_STEPS.find((s) => s.id === currentStep);
    return Boolean(meta?.skippable);
  })();

  const handleBack = () => setStep(Math.max(1, currentStep - 1));
  const handleNext = async () => {
    markTouched(currentStep);
    // Advance the backend wizard when leaving a mapped step. Pure-UI
    // steps (Welcome / ConnectProviders / Governance) just navigate.
    const stepId = UI_TO_BACKEND_STEP[currentStep];
    if (stepId && sessionId) {
      try {
        await advance.mutateAsync({
          step: stepId,
          step_input:
            (stepData[currentStep] as Record<string, unknown> | undefined) ??
            {},
          mark_complete: true,
        });
      } catch (err) {
        // Advance failed (WizardError → 409, network → 0). Keep the
        // user on this step so they can retry; surface the message.
        const message =
          err instanceof Error ? err.message : 'advance failed';
        toast.error(message);
        return;
      }
    }
    setStep(Math.min(total, currentStep + 1));
  };
  const handleSkip = () => {
    if (currentStep === 7) {
      setIntelState('skipped');
    }
    setStep(Math.min(total, currentStep + 1));
  };

  const handleGetStarted = () => setStep(2);
  const handleUseSample = () => {
    if (reposCatalog.length > 0) setRepos(reposCatalog.slice(0, 2));
    if (stacksCatalog.length > 0) {
      setAcceptedStacks(stacksCatalog.map((s) => s.id));
    }
    setStep(2);
  };
  const handleSkipSetup = () => setStep(total);

  const handleReset = () => {
    reset();
    setTenant(TENANT_DEFAULTS);
    setProviders(INITIAL_PROVIDERS);
    setRepos(reposCatalog.slice(0, 2));
    setAcceptedStacks(stacksCatalog.map((s) => s.id));
    setOverrides({});
    setSelectedAgents(['claude-code', 'forge-sdlc']);
    setIntelState('idle');
    setGovernance(GOVERNANCE_DEFAULTS);
    setProvisionState('idle');
    setTenantUrl(undefined);
    setProvisionError(null);
    setConfirming(false);
  };

  const handleRunIntel = async () => {
    if (!sessionId) return;
    setIntelState('running');
    try {
      // Real side-effect: persist the collected intel inputs to the
      // backend `run_first_intel` step. The radial-bar animation in
      // StepRunFirstIntel stays as visual feedback; this call is the
      // source of truth.
      await advance.mutateAsync({
        step: 'run_first_intel',
        step_input:
          (stepData[7] as Record<string, unknown> | undefined) ?? {},
        // mark_complete=false — the user can re-run; the wizard
        // service treats !mark_complete as completion (see wizard.py
        // `will_complete` branch) so we don't want to finalise here.
        mark_complete: false,
      });
      setIntelState('done');
    } catch {
      setIntelState('failed');
    }
  };

  const handleStartProvision = async () => {
    setConfirming(true);
    setProvisionError(null);
    setProvisionState('running');
    try {
      // First, advance the backend `review` step with everything we
      // collected across the wizard. mark_complete=true ends the
      // session lifecycle in the backend (`wizard.py` `will_complete`
      // branch).
      if (sessionId) {
        await advance.mutateAsync({
          step: 'review',
          step_input: collectAllStepData(),
          mark_complete: true,
        });
      }
      // Then kick off the provision job. StepProvision polls the
      // status endpoint and drives terminal-state transitions.
      await startProvision.mutateAsync();
      setTenantUrl(`forge.example.com/${tenant.tenantName}`);
      setStep(10);
    } catch (err) {
      setProvisionState('failed');
      const message =
        err instanceof ApiError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      setProvisionError(message);
    } finally {
      setConfirming(false);
    }
  };

  // Helper: flatten the Zustand `stepData` map into a single payload
  // for the final `review` advance. Each UI step's typed data is
  // nested under its numeric key so the backend can read it back via
  // `wizard.state`.
  const collectAllStepData = (): Record<string, unknown> => {
    const all: Record<string, unknown> = {};
    for (let i = 1; i <= total; i += 1) {
      const v = stepData[i];
      if (v !== undefined && v !== null) all[i] = v;
    }
    return all;
  };

  const headerActions = (
    <>
      <button
        type="button"
        onClick={handleUseSample}
        className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        style={{ color: 'var(--fg-secondary)' }}
        data-testid="wizard-use-sample"
      >
        Use sample data
      </button>
      <button
        type="button"
        onClick={handleSkipSetup}
        className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        style={{ color: 'var(--fg-secondary)' }}
        data-testid="wizard-skip-setup"
      >
        Skip setup
      </button>
    </>
  );

  return (
    <WizardShell
      banner={
        stubReachable
          ? null
          : <OrchestratorStubBanner
              status={
                catalogRes.error
                  ? {
                      error: catalogRes.error.message,
                      httpStatus: catalogRes.error.status,
                    }
                  : null
              }
            />
      }
      headerActions={headerActions}
      footer={
        currentStep !== 1 ? (
          <WizardNav
            currentStep={currentStep}
            totalSteps={total}
            isLastStep={currentStep === total}
            canNext={canNext}
            confirming={confirming}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={
              isStepSkippable &&
              (currentStep === 7 ? intelState !== 'done' : true)
                ? handleSkip
                : undefined
            }
            onFinish={handleNext}
          />
        ) : null
      }
    >
      {currentStep === 1 ? (
        <StepWelcome
          onGetStarted={handleGetStarted}
          onUseSample={handleUseSample}
          onSkipSetup={handleSkipSetup}
        />
      ) : currentStep === 2 ? (
        <StepTenantSetup
          value={tenant}
          onChange={setTenant}
          onBlur={() => markTouched(2)}
        />
      ) : currentStep === 3 ? (
        <StepConnectProviders
          connections={providers}
          onChange={setProviders}
        />
      ) : currentStep === 4 ? (
        <StepConnectRepos
          selected={repos}
          onChange={setRepos}
          catalog={reposCatalog}
        />
      ) : currentStep === 5 ? (
        <StepDetectStack
          stacks={stacksCatalog}
          repos={repos}
          accepted={acceptedStacks}
          onAccept={setAcceptedStacks}
          overrides={overrides}
          onOverride={(id, language) =>
            setOverrides((prev) => ({ ...prev, [id]: language }))
          }
        />
      ) : currentStep === 6 ? (
        <StepConfigureAgents
          agents={agentsCatalog}
          selected={selectedAgents}
          onChange={setSelectedAgents}
        />
      ) : currentStep === 7 ? (
        <StepRunFirstIntel state={intelState} onRun={handleRunIntel} />
      ) : currentStep === 8 ? (
        <StepGovernance value={governance} onChange={setGovernance} />
      ) : currentStep === 9 ? (
        <StepReview
          tenant={tenant}
          repos={repos}
          acceptedStacks={acceptedStacks}
          stacks={stacksCatalog}
          selectedAgents={selectedAgents}
          agents={agentsCatalog}
          intelState={intelState}
        />
      ) : (
        <StepProvision
          state={provisionState}
          onProvision={handleStartProvision}
          onReset={handleReset}
          tenantUrl={tenantUrl}
          onStateChange={setProvisionState}
        />
      )}

      {provisionError ? (
        <p
          role="alert"
          className="mt-4"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--accent-rose)',
          }}
        >
          {provisionError}
        </p>
      ) : null}
    </WizardShell>
  );
}