'use client';

/**
 * SpecTemplateDialog — quick-start templates for new specs.
 *
 * Inline creator per step-34: title + brief description + quick-start
 * templates (API endpoint / Bug fix / Refactor / New feature / Custom)
 * + "Generate plan" button + Save as draft / Save and start workflow.
 *
 * Mock-only — the "Generate plan" button fabricates a plan skeleton
 * via setTimeout so the UI feels real.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  Sparkles,
  Save,
  Rocket,
  Loader2,
  Code2,
  Bug,
  RefreshCcw,
  Lightbulb,
  FileEdit,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SpecTemplate {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly title: string;
  readonly description: string;
  readonly goals: ReadonlyArray<string>;
}

export const SPEC_TEMPLATES: ReadonlyArray<SpecTemplate> = [
  {
    id: 'api-endpoint',
    label: 'API endpoint',
    icon: Code2,
    title: 'New API endpoint: <verb + resource>',
    description:
      'Describe the resource, the verb, the auth scope, and the rate-limit tier. Include the OpenAPI snippet.',
    goals: ['Document request/response schema', 'Implement handler with auth scope', 'Add integration tests'],
  },
  {
    id: 'bug-fix',
    label: 'Bug fix',
    icon: Bug,
    title: 'Fix: <one-line symptom>',
    description:
      'Describe the symptom, the steps to reproduce, the expected vs. actual behavior, and any logs/screenshots.',
    goals: ['Repro under 5 minutes', 'Pinpoint root cause via logs/traces', 'Add a regression test'],
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: RefreshCcw,
    title: 'Refactor: <module or pattern>',
    description:
      'Identify the smell, the desired shape, and the migration plan. Confirm zero behavior change.',
    goals: ['Behavior parity test', 'Public API unchanged', 'Internal complexity ↓'],
  },
  {
    id: 'new-feature',
    label: 'New feature',
    icon: Lightbulb,
    title: 'New feature: <short noun phrase>',
    description:
      'Describe the user outcome, the entry point, the success metric, and the rollout plan.',
    goals: ['User can complete the outcome', 'Metric moves by X%', 'Behind a flag at first'],
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: FileEdit,
    title: '',
    description: '',
    goals: [],
  },
];

export interface SpecTemplateDialogProps {
  open: boolean;
  onClose: () => void;
}

const INITIAL_TEMPLATE: SpecTemplate =
  SPEC_TEMPLATES[0] ??
  ({
    id: 'custom',
    label: 'Custom',
    icon: FileEdit,
    title: '',
    description: '',
    goals: [],
  } as const);

export function SpecTemplateDialog({ open, onClose }: SpecTemplateDialogProps) {
  const [selected, setSelected] = React.useState<SpecTemplate>(INITIAL_TEMPLATE);
  const [title, setTitle] = React.useState(INITIAL_TEMPLATE.title);
  const [description, setDescription] = React.useState(INITIAL_TEMPLATE.description);
  const [generating, setGenerating] = React.useState(false);
  const [generatedPlan, setGeneratedPlan] = React.useState<string | null>(null);

  const SPEC_TEMPLATES_SAFE: ReadonlyArray<SpecTemplate> =
    SPEC_TEMPLATES.length > 0 ? SPEC_TEMPLATES : [INITIAL_TEMPLATE];

  React.useEffect(() => {
    if (!open) return;
    setSelected(INITIAL_TEMPLATE);
    setTitle(INITIAL_TEMPLATE.title);
    setDescription(INITIAL_TEMPLATE.description);
    setGeneratedPlan(null);
  }, [open]);

  const applyTemplate = (t: SpecTemplate) => {
    setSelected(t);
    setTitle(t.title);
    setDescription(t.description);
    setGeneratedPlan(null);
  };

  const generatePlan = () => {
    setGenerating(true);
    setGeneratedPlan(null);
    setTimeout(() => {
      const lines = [
        `## Goals`,
        ...selected.goals.map((g) => `- ${g}`),
        ``,
        `## Plan`,
        `1. Discovery — capture problem space and link to existing ADRs`,
        `2. Planning — break into sub-tasks with acceptance criteria`,
        `3. Execution — implement via forge-execute-phase`,
        `4. Verification — automated + manual UAT`,
        `5. Deployment — behind a flag, monitor, then ramp`,
        ``,
        `## Open questions`,
        `- Confirm scope of "${title || selected.title}" with stakeholders`,
      ];
      setGeneratedPlan(lines.join('\n'));
      setGenerating(false);
    }, 800);
  };

  const saveDraft = () => {
    toast.success('Spec saved as draft', { description: title || selected.title });
    onClose();
  };

  const saveAndStart = () => {
    toast.success('Spec created + workflow queued', {
      description: title || selected.title,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-label="New spec"
            data-testid="fcc-spec-template-dialog"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-2xl)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
              <p className="flex items-center gap-2 text-md font-semibold text-[var(--fg-primary)]">
                <Sparkles className="h-4 w-4 text-[var(--accent-violet)]" aria-hidden />
                Start a spec
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className="h-8 w-8"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </header>

            <div className="space-y-4 p-4">
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                  Quick start templates
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SPEC_TEMPLATES.map((t) => {
                    const Icon = t.icon;
                    const isActive = t.id === selected.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        data-testid={`fcc-spec-template-${t.id}`}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                          isActive
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                        )}
                      >
                        <Icon className="h-3 w-3" aria-hidden />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="spec-title"
                    className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                  >
                    Title
                  </label>
                  <Input
                    id="spec-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short noun-phrase describing the work"
                    className="mt-1"
                    data-testid="fcc-spec-template-title"
                  />
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="spec-desc"
                    className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]"
                  >
                    Brief description (markdown)
                  </label>
                  <Textarea
                    id="spec-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="mt-1 resize-y"
                    data-testid="fcc-spec-template-desc"
                  />
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-tertiary)]">
                    AI-generated plan
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={generatePlan}
                    disabled={generating}
                    data-testid="fcc-spec-template-generate"
                    className="gap-1 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  >
                    {generating ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-3 w-3" aria-hidden />
                    )}
                    Generate plan
                  </Button>
                </div>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs leading-relaxed text-[var(--fg-secondary)]">
                  {generatedPlan ? (
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">
                      {generatedPlan}
                    </pre>
                  ) : (
                    <p className="italic text-[var(--fg-tertiary)]">
                      Click &ldquo;Generate plan&rdquo; to draft a skeleton from your title + description.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
              <Button
                variant="outline"
                size="sm"
                onClick={saveDraft}
                className="gap-1 border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                data-testid="fcc-spec-template-save-draft"
              >
                <Save className="h-3 w-3" aria-hidden />
                Save as draft
              </Button>
              <Button
                size="sm"
                onClick={saveAndStart}
                className="gap-1 bg-[var(--accent-primary)] text-white hover:opacity-90"
                data-testid="fcc-spec-template-start-workflow"
              >
                <Rocket className="h-3 w-3" aria-hidden />
                Save and start workflow
              </Button>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
