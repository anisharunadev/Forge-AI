'use client';

import * as React from 'react';
import { Plus, ArrowRight, ArrowLeft, Check } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface IngestionInput {
  repoUrl: string;
  branch: string;
  includeGlobs: string;
}

const STEPS = ['Repository', 'Options', 'Review'] as const;

export interface IngestionWizardProps {
  onSubmit?: (input: IngestionInput) => void;
}

export function IngestionWizard({ onSubmit }: IngestionWizardProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [url, setUrl] = React.useState('');
  const [branch, setBranch] = React.useState('main');
  const [globs, setGlobs] = React.useState('**/*.{ts,tsx,py,sql,md}');

  const reset = () => {
    setStep(0);
    setUrl('');
    setBranch('main');
    setGlobs('**/*.{ts,tsx,py,sql,md}');
  };

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance = (step === 0 && url.trim().length > 0) || step > 0;

  const handleSubmit = () => {
    onSubmit?.({ repoUrl: url, branch, includeGlobs: globs });
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v: boolean) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="ingestion-wizard-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Ingest a repo
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="ingestion-wizard">
        <DialogHeader>
          <DialogTitle>Ingest repository — Step {step + 1} of {STEPS.length}</DialogTitle>
          <DialogDescription>{STEPS[step]}</DialogDescription>
        </DialogHeader>

        {step === 0 ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ing-url">Repository URL</Label>
              <Input
                id="ing-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ing-branch">Branch</Label>
              <Input
                id="ing-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ing-globs">Include globs</Label>
              <Input
                id="ing-globs"
                value={globs}
                onChange={(e) => setGlobs(e.target.value)}
                placeholder="**/*.{ts,tsx,py,sql,md}"
              />
              <p className="text-[10px] text-forge-300">
                Comma-separated list of glob patterns.
              </p>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-forge-300">URL:</span>{' '}
              <span className="font-mono">{url}</span>
            </p>
            <p>
              <span className="text-forge-300">Branch:</span>{' '}
              <span className="font-mono">{branch}</span>
            </p>
            <p>
              <span className="text-forge-300">Globs:</span>{' '}
              <span className="font-mono">{globs}</span>
            </p>
          </div>
        ) : null}

        <DialogFooter className="flex justify-between">
          <div>
            {step > 0 ? (
              <Button variant="outline" onClick={back} type="button">
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <Button
                onClick={next}
                disabled={!canAdvance}
                type="button"
                data-testid="ingestion-next"
              >
                Next
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} data-testid="ingestion-submit">
                <Check className="h-3 w-3" aria-hidden="true" />
                Start ingestion
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
