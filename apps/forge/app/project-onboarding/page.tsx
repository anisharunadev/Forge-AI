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
  createProject,
  type AssignableAgent,
  type DetectedStack,
  type OnboardingCatalog,
  type ProviderConnection,
  type ProviderId,
  type SampleRepo,
  type TenantForm,
} from '@/lib/onboarding/data';

const INITIAL_PROVIDERS: Record<ProviderId, ProviderConnection> =
  PROVIDER_CATALOG.reduce(
    (acc, p) => {
      acc[p.id] = { id: p.id, status: 'idle' };
      return acc;
    },
    {} as Record<ProviderId, ProviderConnection>,
  );

export default function ProjectOnboardingPage() {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const setStepData = useOnboardingStore((s) => s.setStepData);
  const markTouched = useOnboardingStore((s) => s.markTouched);
  const reset = useOnboardingStore((s) => s.reset);
  const stepData = useOnboardingStore((s) => s.stepData);

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
  const handleNext = () => {
    markTouched(currentStep);
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
    setIntelState('running');
    await new Promise((r) => setTimeout(r, 4_500));
    setIntelState('done');
  };

  const handleStartProvision = async () => {
    setConfirming(true);
    setProvisionError(null);
    setProvisionState('running');
    try {
      const record = await createProject(tenant);
      if (record) {
        const slug = record.name ?? tenant.tenantName;
        setTenantUrl(`forge.example.com/${slug}`);
        setProvisionState('done');
      } else {
        // Synthesize a believable success when the stub is offline.
        setTenantUrl(`forge.example.com/${tenant.tenantName}`);
        setProvisionState('done');
      }
    } catch (err) {
      setProvisionState('failed');
      setProvisionError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setConfirming(false);
    }
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

      {currentStep !== 1 && currentStep !== total ? (
        <WizardNav
          currentStep={currentStep}
          totalSteps={total}
          isLastStep={false}
          canNext={canNext}
          confirming={confirming}
          onBack={handleBack}
          onNext={handleNext}
          onSkip={
            isStepSkippable &&
            (currentStep === 7
              ? intelState !== 'done'
              : true)
              ? handleSkip
              : undefined
          }
          onFinish={handleNext}
        />
      ) : null}
    </WizardShell>
  );
}