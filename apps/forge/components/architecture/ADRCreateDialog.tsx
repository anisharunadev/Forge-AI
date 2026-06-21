'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ADRStatus } from '@/lib/architecture/data';

export interface ADRCreateInput {
  title: string;
  owner: string;
  status: ADRStatus;
  context: string;
}

export interface ADRCreateDialogProps {
  onCreate?: (input: ADRCreateInput) => void;
}

const STEPS = ['Title & Owner', 'Context', 'Review'] as const;

export function ADRCreateDialog({ onCreate }: ADRCreateDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [title, setTitle] = React.useState('');
  const [owner, setOwner] = React.useState('');
  const [status, setStatus] = React.useState<ADRStatus>('draft');
  const [context, setContext] = React.useState('');

  const reset = () => {
    setStep(0);
    setTitle('');
    setOwner('');
    setStatus('draft');
    setContext('');
  };

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance =
    (step === 0 && title.trim().length > 0 && owner.trim().length > 0) ||
    step === 1 ||
    step === 2;

  const handleSubmit = () => {
    onCreate?.({ title, owner, status, context });
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
        <Button data-testid="adr-create-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New ADR
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="adr-create-dialog">
        <DialogHeader>
          <DialogTitle>Create ADR — Step {step + 1} of {STEPS.length}</DialogTitle>
          <DialogDescription>
            {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        {step === 0 ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="adr-title">Title</Label>
              <Input
                id="adr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Use Redis streams for fan-out"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-owner">Owner</Label>
              <Input
                id="adr-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. Sara Kim"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adr-status">Initial status</Label>
              <Select value={status} onValueChange={(v: string) => setStatus(v as ADRStatus)}>
                <SelectTrigger id="adr-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="proposed">Proposed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-1">
            <Label htmlFor="adr-context">Context</Label>
            <textarea
              id="adr-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Describe the forces at play, the options considered, and the trade-offs."
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-forge-300">Title:</span> {title}
            </p>
            <p>
              <span className="text-forge-300">Owner:</span> {owner}
            </p>
            <p>
              <span className="text-forge-300">Status:</span> {status}
            </p>
            <div>
              <p className="text-forge-300">Context:</p>
              <pre className="whitespace-pre-wrap rounded-md border border-forge-700/40 bg-forge-900/40 p-2 text-xs">
                {context || '—'}
              </pre>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex justify-between">
          <div>
            {step > 0 ? (
              <Button variant="outline" onClick={back} type="button">
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
                data-testid="adr-create-next"
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleSubmit} data-testid="adr-create-submit">
                Submit
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
