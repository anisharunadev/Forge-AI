'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Loader2, Wand2 } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTriggerRefactorAnalysis } from '@/lib/hooks/useMigrationPlans';

/**
 * Three-step wizard that kicks off a new migration analysis. Reuses
 * the dialog primitives already shipped in `components/ui`, but
 * renders inline (not in a modal) so the operator can see the breadcrumb
 * + the plan it creates once the analysis completes.
 */
type Step = 'project' | 'source' | 'review';

const STEP_ORDER: ReadonlyArray<Step> = ['project', 'source', 'review'];
const STEP_LABEL: Record<Step, string> = {
  project: 'Pick a project',
  source: 'Describe the migration',
  review: 'Review & run',
};

export default function NewRefactorAnalysisPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>('project');
  const [projectId, setProjectId] = React.useState('project-forge-demo');
  const [source, setSource] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const mutation = useTriggerRefactorAnalysis();

  const stepIdx = STEP_ORDER.indexOf(step);

  const canAdvance =
    (step === 'project' && projectId.trim().length > 0) ||
    (step === 'source' && source.trim().length > 0) ||
    step === 'review';

  const goNext = () => {
    if (!canAdvance) return;
    const idx = STEP_ORDER.indexOf(step);
    const next = STEP_ORDER[idx + 1];
    if (next) setStep(next);
  };

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    const prev = STEP_ORDER[idx - 1];
    if (prev) setStep(prev);
  };

  const handleSubmit = async () => {
    try {
      const result = await mutation.mutateAsync({
        projectId: projectId.trim(),
        source: source.trim(),
        target: target.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      router.push(`/refactor/${result.planId}`);
    } catch {
      // surfaced inline below — keep the wizard mounted so the user can retry
    }
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="refactor-new">
        <nav className="text-xs text-forge-300" aria-label="Breadcrumb">
          <Link
            href="/refactor"
            className="inline-flex items-center gap-1 hover:text-forge-100"
            data-testid="refactor-new-back"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Refactor Center
          </Link>
        </nav>

        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Wand2 className="h-5 w-5" aria-hidden="true" />
            New refactor analysis
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick a project, point at the source you want to migrate, and let
            the orchestrator generate a phased plan + risk register.
          </p>
        </header>

        <ol
          aria-label="Wizard steps"
          className="flex flex-wrap items-center gap-2 text-xs text-forge-300"
          data-testid="refactor-new-steps"
          data-active-step={step}
        >
          {STEP_ORDER.map((s, idx) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={
                  idx <= stepIdx
                    ? 'inline-flex h-6 w-6 items-center justify-center rounded-full border border-brand-500/50 bg-brand-500/10 font-mono text-[10px] text-brand-200'
                    : 'inline-flex h-6 w-6 items-center justify-center rounded-full border border-forge-700 bg-forge-800 font-mono text-[10px] text-forge-300'
                }
                data-testid={`refactor-new-step-${s}`}
              >
                {idx + 1}
              </span>
              <span className={idx === stepIdx ? 'text-forge-50' : undefined}>
                {STEP_LABEL[s]}
              </span>
              {idx < STEP_ORDER.length - 1 ? (
                <ArrowRight className="h-3 w-3 text-forge-500" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>

        <section className="card flex flex-col gap-4" data-testid="refactor-new-step-panel">
          {step === 'project' ? (
            <div className="space-y-2">
              <Label htmlFor="refactor-new-project">Project ID</Label>
              <Input
                id="refactor-new-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="project-forge-demo"
                data-testid="refactor-new-project-input"
                required
              />
              <p className="text-xs text-forge-300">
                The plan will be scoped to this project. Demo uses
                <span className="ml-1 font-mono">project-forge-demo</span>.
              </p>
            </div>
          ) : null}

          {step === 'source' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="refactor-new-source">Source</Label>
                <Input
                  id="refactor-new-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="e.g. postgres-14"
                  data-testid="refactor-new-source-input"
                  required
                />
                <p className="text-xs text-forge-300">
                  What are you migrating from? A library, runtime, or service
                  version.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="refactor-new-target">Target (optional)</Label>
                <Input
                  id="refactor-new-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. postgres-17"
                  data-testid="refactor-new-target-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="refactor-new-notes">Notes (optional)</Label>
                <Input
                  id="refactor-new-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the orchestrator should know"
                  data-testid="refactor-new-notes-input"
                />
              </div>
            </div>
          ) : null}

          {step === 'review' ? (
            <div className="space-y-2 text-sm text-forge-200" data-testid="refactor-new-review">
              <p>
                <span className="text-forge-400">Project:</span>{' '}
                <span className="font-mono">{projectId || '—'}</span>
              </p>
              <p>
                <span className="text-forge-400">Source:</span>{' '}
                <span className="font-mono">{source || '—'}</span>
              </p>
              <p>
                <span className="text-forge-400">Target:</span>{' '}
                <span className="font-mono">{target || '—'}</span>
              </p>
              {notes ? (
                <p>
                  <span className="text-forge-400">Notes:</span> {notes}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {mutation.isError ? (
          <p
            role="alert"
            data-testid="refactor-new-error"
            className="text-sm text-rose-300"
          >
            {mutation.error?.message ?? 'Analysis failed to start.'}
          </p>
        ) : null}

        <footer className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={stepIdx === 0}
            data-testid="refactor-new-back-button"
          >
            Back
          </Button>
          {step === 'review' ? (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={mutation.isPending}
              data-testid="refactor-new-submit"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden="true" />
              )}
              {mutation.isPending ? 'Starting analysis…' : 'Run analysis'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              data-testid="refactor-new-next"
            >
              Next
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </footer>
      </div>
    </AdminShell>
  );
}