'use client';

import * as React from 'react';

import { WizardShell } from '@/components/onboarding/WizardShell';
import { StepTenantSetup } from '@/components/onboarding/StepTenantSetup';
import { StepConnectRepos } from '@/components/onboarding/StepConnectRepos';
import { StepDetectStack } from '@/components/onboarding/StepDetectStack';
import { StepConfigureAgents } from '@/components/onboarding/StepConfigureAgents';
import { StepRunFirstIntel, type IntelState } from '@/components/onboarding/StepRunFirstIntel';
import { StepReview } from '@/components/onboarding/StepReview';
import { BackendBanner } from '@/components/BackendBanner';
import { useOnboardingStore } from '@/lib/store';
import { useApiData } from '@/hooks/use-api-data';
import {
  TENANT_DEFAULTS,
  WIZARD_STEPS,
  createProject,
  type AssignableAgent,
  type DetectedStack,
  type OnboardingCatalog,
  type SampleRepo,
  type TenantForm,
} from '@/lib/onboarding/data';

const STEP_TIPS: Record<number, string> = {
  1: 'Tenant name appears in URL paths and audit logs. Region affects data residency.',
  2: 'Forge clones shallow copies first; the deep scan runs during the first intel pass.',
  3: 'Confidence is from the file-extension + manifest heuristic. Override anytime.',
  4: 'You can assign agents per task type on the Agent Center matrix later.',
  5: 'The first pass takes 2–5 minutes per repo. You can keep editing in other tabs.',
  6: 'Review the summary, then confirm to provision the project.',
};

export default function ProjectOnboardingPage() {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const setStepData = useOnboardingStore((s) => s.setStepData);
  const reset = useOnboardingStore((s) => s.reset);
  const stepData = useOnboardingStore((s) => s.stepData);

  const catalogRes = useApiData<OnboardingCatalog>('/v1/onboarding/catalog');
  const catalog = catalogRes.data;
  const repos_catalog: ReadonlyArray<SampleRepo> = catalog?.repos ?? [];
  const stacks_catalog: ReadonlyArray<DetectedStack> = catalog?.stacks ?? [];
  const agents_catalog: ReadonlyArray<AssignableAgent> = catalog?.agents ?? [];

  const [tenant, setTenant] = React.useState<TenantForm>(
    () => (stepData[1] as TenantForm | undefined) ?? TENANT_DEFAULTS,
  );
  const [repos, setRepos] = React.useState<SampleRepo[]>(
    () => (stepData[2] as SampleRepo[] | undefined) ?? [],
  );
  const [acceptedStacks, setAcceptedStacks] = React.useState<string[]>(
    () => (stepData[3] as string[] | undefined) ?? [],
  );
  const [selectedAgents, setSelectedAgents] = React.useState<string[]>(
    () =>
      (stepData[4] as string[] | undefined) ?? [
        'claude-code',
        'forge-sdlc',
      ],
  );

  // Seed catalog values into local state once the wizard catalog loads.
  React.useEffect(() => {
    if (stepData[2] == null && repos.length === 0 && repos_catalog.length > 0) {
      setRepos(repos_catalog.slice(0, 2));
    }
  }, [repos_catalog, repos.length, stepData]);
  React.useEffect(() => {
    if (
      stepData[3] == null &&
      acceptedStacks.length === 0 &&
      stacks_catalog.length > 0
    ) {
      setAcceptedStacks(stacks_catalog.map((s) => s.id));
    }
  }, [stacks_catalog, acceptedStacks.length, stepData]);
  const [intelState, setIntelState] = React.useState<IntelState>(
    () => (stepData[5] as IntelState | undefined) ?? 'idle',
  );
  const [confirmed, setConfirmed] = React.useState(false);

  // Persist per-step data into the store as the user changes it.
  React.useEffect(() => {
    setStepData(1, tenant);
  }, [tenant, setStepData]);
  React.useEffect(() => {
    setStepData(2, repos);
  }, [repos, setStepData]);
  React.useEffect(() => {
    setStepData(3, acceptedStacks);
  }, [acceptedStacks, setStepData]);
  React.useEffect(() => {
    setStepData(4, selectedAgents);
  }, [selectedAgents, setStepData]);
  React.useEffect(() => {
    setStepData(5, intelState);
  }, [intelState, setStepData]);

  const total = WIZARD_STEPS.length;

  const canNext = (() => {
    if (currentStep === 1) return tenant.tenantName.trim().length > 0;
    if (currentStep === 2) return repos.length > 0;
    if (currentStep === 3) return acceptedStacks.length > 0;
    if (currentStep === 4) return selectedAgents.length > 0;
    if (currentStep === 5) return intelState === 'done';
    return true;
  })();

  const handleBack = () => setStep(Math.max(1, currentStep - 1));
  const handleNext = () => setStep(Math.min(total, currentStep + 1));
  const handleSkip = () => {
    if (currentStep === 5) {
      setIntelState('skipped' as IntelState);
    }
    setStep(Math.min(total, currentStep + 1));
  };
  const handleFinish = async () => {
    setConfirmed(true);
    try {
      await createProject(tenant);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] createProject failed', err);
    }
    // eslint-disable-next-line no-console
    console.info('[onboarding] confirmed', { tenant, repos, acceptedStacks, selectedAgents, intelState });
  };

  const handleRunIntel = async () => {
    setIntelState('running');
    await new Promise((r) => setTimeout(r, 1200));
    setIntelState('done');
  };

  const handleReset = () => {
    reset();
    setTenant(TENANT_DEFAULTS);
    setRepos(repos_catalog.slice(0, 2));
    setAcceptedStacks(stacks_catalog.map((s) => s.id));
    setSelectedAgents(['claude-code', 'forge-sdlc']);
    setIntelState('idle');
    setConfirmed(false);
  };

  return (
    <WizardShell
      canNext={canNext}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={currentStep === 5 ? handleSkip : undefined}
      onFinish={handleFinish}
      tip={STEP_TIPS[currentStep]}
      banner={<BackendBanner kind="onboarding" />}
    >
      {confirmed ? (
        <section
          className="card space-y-2 text-sm"
          data-testid="onboarding-done"
        >
          <h2 className="text-lg font-semibold text-emerald-300">
            Project provisioned
          </h2>
          <p className="text-forge-200">
            The new project is live. You can revisit any step from the
            Project Settings page.
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-forge-300 underline-offset-2 hover:underline"
            data-testid="onboarding-restart"
          >
            Run the wizard again
          </button>
        </section>
      ) : currentStep === 1 ? (
        <StepTenantSetup value={tenant} onChange={setTenant} />
      ) : currentStep === 2 ? (
        <StepConnectRepos
          selected={repos}
          onChange={setRepos}
          catalog={repos_catalog}
        />
      ) : currentStep === 3 ? (
        <StepDetectStack
          stacks={stacks_catalog}
          repos={repos}
          accepted={acceptedStacks}
          onAccept={setAcceptedStacks}
        />
      ) : currentStep === 4 ? (
        <StepConfigureAgents
          agents={agents_catalog}
          selected={selectedAgents}
          onChange={setSelectedAgents}
        />
      ) : currentStep === 5 ? (
        <StepRunFirstIntel state={intelState} onRun={handleRunIntel} />
      ) : (
        <StepReview
          tenant={tenant}
          repos={repos}
          acceptedStacks={acceptedStacks}
          stacks={stacks_catalog}
          selectedAgents={selectedAgents}
          agents={agents_catalog}
          intelState={intelState}
        />
      )}
    </WizardShell>
  );
}
