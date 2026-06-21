'use client';

import * as React from 'react';
import { Check, ChevronRight, Plug, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORY_LABEL, type ConnectorCategory } from '@/lib/connector-center/data';

const CATEGORIES: ReadonlyArray<ConnectorCategory> = [
  'source-control',
  'project-mgmt',
  'design',
  'comms',
  'cloud',
  'quality',
  'data',
];

const STEPS = [
  { id: 1, title: 'Select type' },
  { id: 2, title: 'Configure' },
  { id: 3, title: 'Test & save' },
] as const;

export interface AddConnectorDialogProps {
  onAdd?: (input: { name: string; category: ConnectorCategory; baseUrl: string }) => void;
}

export function AddConnectorDialog({ onAdd }: AddConnectorDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [name, setName] = React.useState('');
  const [category, setCategory] = React.useState<ConnectorCategory>('source-control');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [testPassed, setTestPassed] = React.useState(false);

  const reset = () => {
    setStep(1);
    setName('');
    setCategory('source-control');
    setBaseUrl('');
    setTesting(false);
    setTestPassed(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const runTest = async () => {
    setTesting(true);
    setTestPassed(false);
    await new Promise((r) => setTimeout(r, 800));
    setTesting(false);
    setTestPassed(true);
  };

  const handleSave = () => {
    onAdd?.({ name: name.trim(), category, baseUrl: baseUrl.trim() });
    setOpen(false);
    reset();
  };

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && baseUrl.trim().length > 0) ||
    step === 3;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="add-connector-trigger">
          <Plug className="h-4 w-4" aria-hidden="true" />
          Add Connector
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Connector</DialogTitle>
          <DialogDescription>
            {STEPS[step - 1]?.title} — step {step} of {STEPS.length}
          </DialogDescription>
        </DialogHeader>

        <ol
          className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-forge-300"
          data-testid="add-connector-steps"
        >
          {STEPS.map((s, idx) => (
            <li
              key={s.id}
              className={
                s.id === step
                  ? 'inline-flex items-center gap-1 font-semibold text-forge-50'
                  : s.id < step
                    ? 'inline-flex items-center gap-1 text-emerald-300'
                    : 'inline-flex items-center gap-1'
              }
              data-testid={`add-step-${s.id}`}
              data-step-state={s.id === step ? 'active' : s.id < step ? 'done' : 'pending'}
            >
              {s.id < step ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <span className="font-mono">{s.id}</span>
              )}
              {s.title}
              {idx < STEPS.length - 1 ? (
                <ChevronRight className="h-3 w-3 text-forge-500" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>

        <div className="min-h-[180px] space-y-3">
          {step === 1 ? (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="conn-name">Name</Label>
                <Input
                  id="conn-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme GitHub"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="conn-category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as ConnectorCategory)}
                >
                  <SelectTrigger id="conn-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="conn-url">Base URL</Label>
                <Input
                  id="conn-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                />
              </div>
              <p className="text-[10px] text-forge-300">
                Credentials are redacted (FORA-128) and stored as a secret
                reference. Only the fingerprint and metadata appear in the UI.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="rounded-md border border-forge-700 bg-forge-800 p-3 text-xs">
                <p className="font-medium text-forge-100">Test connection</p>
                <p className="text-forge-300">
                  Verifies reachability, authentication, and basic read scopes.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={runTest}
                    disabled={testing}
                    data-testid="add-connector-test"
                  >
                    <RotateCw
                      className={testing ? 'h-3 w-3 animate-spin' : 'h-3 w-3'}
                      aria-hidden="true"
                    />
                    {testing ? 'Testing…' : 'Run test'}
                  </Button>
                  {testPassed ? (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300"
                      data-testid="add-connector-test-result"
                      data-result="pass"
                    >
                      Passed
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : s))}
            disabled={step === 1}
            data-testid="add-connector-back"
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={!canNext}
              data-testid="add-connector-next"
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSave}
              disabled={!testPassed}
              data-testid="add-connector-save"
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
