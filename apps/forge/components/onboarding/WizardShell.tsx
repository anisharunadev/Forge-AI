'use client';

import * as React from 'react';
import { Compass, Lightbulb } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { WizardProgress, StepIndicator } from '@/components/onboarding/WizardProgress';
import { WizardNav } from '@/components/onboarding/WizardNav';
import { useOnboardingStore } from '@/lib/store';
import { WIZARD_STEPS } from '@/lib/onboarding/data';

export interface WizardShellProps {
  children: React.ReactNode;
  canNext?: boolean;
  onNext?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  onFinish?: () => void;
  tip?: string;
  /**
   * Optional banner rendered between the header and the step grid.
   * Used by the orchestrator-stub warning when no backend is running.
   */
  banner?: React.ReactNode;
}

export function WizardShell({
  children,
  canNext = true,
  onNext,
  onBack,
  onSkip,
  onFinish,
  tip,
  banner,
}: WizardShellProps) {
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const setStep = useOnboardingStore((s) => s.setStep);
  const total = WIZARD_STEPS.length;
  const step = WIZARD_STEPS.find((s) => s.id === currentStep) ?? WIZARD_STEPS[0]!;
  const isLast = currentStep === total;

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="project-onboarding"
      >
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Compass className="h-5 w-5" aria-hidden="true" />
            Project Onboarding
          </h1>
          <p className="text-sm text-muted-foreground">
            Step {step.id}: {step.title} — {step.description}
          </p>
        </header>

        {banner ? <div data-testid="wizard-banner">{banner}</div> : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <WizardProgress currentStep={currentStep} totalSteps={total} />
            <StepIndicator
              currentStep={currentStep}
              totalSteps={total}
              steps={WIZARD_STEPS}
              onJump={(s) => setStep(s)}
            />
            {children}
            <WizardNav
              currentStep={currentStep}
              totalSteps={total}
              isLastStep={isLast}
              canNext={canNext}
              onBack={onBack}
              onNext={onNext}
              onSkip={onSkip}
              onFinish={onFinish}
            />
          </div>
          <aside
            className="card h-fit space-y-2 border-forge-700/60 bg-forge-800/60 backdrop-blur-sm"
            data-testid="wizard-side-panel"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
              What is happening
            </h2>
            <p className="text-xs text-forge-200">{step.description}</p>
            {tip ? (
              <p className="text-xs text-forge-300" data-testid="wizard-tip">
                {tip}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1 text-[10px] uppercase tracking-wider text-forge-300">
              {WIZARD_STEPS.map((s) => (
                <li
                  key={s.id}
                  className={
                    s.id === currentStep
                      ? 'text-forge-50'
                      : s.id < currentStep
                        ? 'text-emerald-300'
                        : ''
                  }
                >
                  {s.id}. {s.title}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
