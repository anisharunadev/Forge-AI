'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, SkipForward } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface WizardNavProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  onFinish?: () => void;
  canNext?: boolean;
  isLastStep?: boolean;
}

export function WizardNav({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  onFinish,
  canNext = true,
  isLastStep = false,
}: WizardNavProps) {
  return (
    <div
      className="flex items-center justify-between gap-2 border-t border-forge-800 pt-4"
      data-testid="wizard-nav"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        disabled={currentStep === 1}
        data-testid="wizard-back"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
        Back
      </Button>

      <div className="flex items-center gap-2">
        {onSkip ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onSkip}
            data-testid="wizard-skip"
          >
            <SkipForward className="h-3 w-3" aria-hidden="true" />
            Skip
          </Button>
        ) : null}
        {isLastStep ? (
          <Button
            size="sm"
            onClick={onFinish}
            disabled={!canNext}
            data-testid="wizard-finish"
          >
            Finish
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onNext}
            disabled={!canNext}
            data-testid="wizard-next"
          >
            Next
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
