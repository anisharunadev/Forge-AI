'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight, Loader2, SkipForward } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface WizardNavProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  onFinish?: () => void;
  /** Disables the primary CTA. Defaults to enabled. */
  canNext?: boolean;
  isLastStep?: boolean;
  /** When true, swap the primary button label to "Confirm & provision" + spinner. */
  confirming?: boolean;
}

/**
 * Wizard footer — Back ghost button on the left, primary Next /
 * Finish (or Confirm & provision) on the right.
 *
 * The Back button is disabled on step 1; the Next button is disabled
 * until `canNext` is true. On the last step the label switches to
 * "Confirm & provision" and a spinner replaces the arrow when
 * `confirming` is true.
 */
export function WizardNav({
  currentStep,
  totalSteps: _totalSteps,
  onBack,
  onNext,
  onSkip,
  onFinish,
  canNext = true,
  isLastStep = false,
  confirming = false,
}: WizardNavProps) {
  return (
    <div
      className="mt-6 flex items-center justify-between gap-2 pt-4"
      style={{ borderTop: '1px solid var(--border-subtle)' }}
      data-testid="wizard-nav"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        disabled={currentStep === 1}
        data-testid="wizard-back"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
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
            <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
            Skip
          </Button>
        ) : null}
        {isLastStep ? (
          <Button
            size="sm"
            onClick={onFinish}
            disabled={!canNext || confirming}
            data-testid={confirming ? 'wizard-confirming' : 'wizard-finish'}
          >
            {confirming ? (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
                Provisioning…
              </>
            ) : (
              'Confirm & provision'
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onNext}
            disabled={!canNext}
            data-testid="wizard-next"
          >
            Next
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}