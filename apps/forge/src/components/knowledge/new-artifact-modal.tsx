'use client';

/**
 * New artifact modal (Zone 11) — 3-step flow:
 *   1. Pick type (Standard / Template / Policy / Runbook / Practice)
 *   2. For templates, optionally pick a starter template to clone
 *   3. Fill in title, description, scope, tags, owner
 *
 * On submit, returns the form values via `onCreate`.
 */

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookMarked,
  FileText,
  ShieldCheck,
  Play,
  BookOpen,
  X,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type ArtifactKind = 'standard' | 'template' | 'policy' | 'runbook' | 'practice';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    kind: ArtifactKind;
    title: string;
    description: string;
    scope: 'org' | 'project';
    tags: string[];
    owner: string;
    starterTemplateId?: string;
  }) => void;
}

const TYPES: ReadonlyArray<{
  id: ArtifactKind;
  label: string;
  code: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    id: 'standard',
    label: 'Standard',
    code: 'F-001',
    description: 'Org rules & project policies',
    icon: BookMarked,
    tone: 'var(--accent-primary)',
  },
  {
    id: 'template',
    label: 'Template',
    code: 'F-002',
    description: 'PRD, ADR, bug, runbook scaffolds',
    icon: FileText,
    tone: 'var(--accent-cyan)',
  },
  {
    id: 'policy',
    label: 'Policy',
    code: 'F-003',
    description: 'Governance & enforcement rules',
    icon: ShieldCheck,
    tone: 'var(--accent-violet)',
  },
  {
    id: 'runbook',
    label: 'Runbook',
    code: 'F-004',
    description: 'Operational procedures',
    icon: Play,
    tone: 'var(--accent-emerald)',
  },
  {
    id: 'practice',
    label: 'Best practice',
    code: 'F-005',
    description: 'Curated learnings',
    icon: BookOpen,
    tone: 'var(--accent-amber)',
  },
];

const STARTER_TEMPLATES: ReadonlyArray<{ id: string; title: string; kind: string }> = [
  { id: 'starter-prd', title: 'Blank PRD', kind: 'prd' },
  { id: 'starter-adr', title: 'Blank ADR', kind: 'adr' },
  { id: 'starter-bug', title: 'Bug report', kind: 'bug' },
  { id: 'starter-runbook', title: 'Operational runbook', kind: 'runbook' },
  { id: 'starter-rfc', title: 'RFC proposal', kind: 'rfc' },
  { id: 'starter-spec', title: 'Technical spec', kind: 'spec' },
];

export function NewArtifactModal({ open, onOpenChange, onCreate }: Props) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [kind, setKind] = React.useState<ArtifactKind | null>(null);
  const [starter, setStarter] = React.useState<string | undefined>();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [scope, setScope] = React.useState<'org' | 'project'>('org');
  const [tags, setTags] = React.useState('');
  const [owner, setOwner] = React.useState('You');

  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setKind(null);
      setStarter(undefined);
      setTitle('');
      setDescription('');
      setScope('org');
      setTags('');
      setOwner('You');
    }
  }, [open]);

  const handleSubmit = () => {
    if (!kind) return;
    onCreate({
      kind,
      title: title.trim() || 'Untitled',
      description: description.trim(),
      scope,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      owner,
      starterTemplateId: starter,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="ok-new-modal"
        aria-describedby="ok-new-modal-desc"
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
              New artifact
            </DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <DialogDescription id="ok-new-modal-desc">
            Step {step} of 3 —{' '}
            {step === 1 ? 'pick a type' : step === 2 ? 'pick a starter template' : 'fill in the basics'}
          </DialogDescription>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                aria-hidden="true"
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  s <= step ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)]',
                )}
              />
            ))}
          </div>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {TYPES.map((t) => {
                const Icon = t.icon;
                const isActive = kind === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setKind(t.id)}
                    aria-pressed={isActive}
                    data-testid={`ok-new-type-${t.id}`}
                    className={cn(
                      'flex items-start gap-3 rounded-[var(--radius-md)] border p-4 text-left transition-colors',
                      isActive
                        ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                    )}
                  >
                    <span
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]"
                      style={{ background: `${t.tone}20`, color: t.tone }}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[var(--fg-primary)]">
                        {t.label}{' '}
                        <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">{t.code}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{t.description}</p>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          ) : null}

          {step === 2 ? (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-2"
            >
              <p className="text-xs text-[var(--fg-secondary)]">
                Optional — clone a starter template or start blank.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {STARTER_TEMPLATES.map((s) => {
                  const isActive = starter === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStarter(s.id)}
                      aria-pressed={isActive}
                      data-testid={`ok-new-starter-${s.id}`}
                      className={cn(
                        'flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2 text-left text-xs transition-colors',
                        isActive
                          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--fg-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]',
                      )}
                    >
                      <span>{s.title}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">
                        {s.kind}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setStarter(undefined)}
                aria-pressed={starter === undefined}
                data-testid="ok-new-starter-blank"
                className={cn(
                  'mt-1 rounded-[var(--radius-md)] border border-dashed px-3 py-2 text-xs',
                  starter === undefined
                    ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.10)] text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                )}
              >
                Start blank
              </button>
            </motion.div>
          ) : null}

          {step === 3 ? (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ok-new-title">Title</Label>
                <Input
                  id="ok-new-title"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Production deploy checklist"
                  data-testid="ok-new-title"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ok-new-desc">Description</Label>
                <textarea
                  id="ok-new-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this artifact capture?"
                  data-testid="ok-new-desc"
                  className="thin-scrollbar w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-xs text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <div className="flex gap-1.5">
                  {(['org', 'project'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      aria-pressed={scope === s}
                      data-testid={`ok-new-scope-${s}`}
                      className={cn(
                        'flex-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs',
                        scope === s
                          ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.12)] text-[var(--accent-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-inset)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                      )}
                    >
                      {s === 'org' ? 'Org-wide' : 'Project'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ok-new-owner">Owner</Label>
                <Input
                  id="ok-new-owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  data-testid="ok-new-owner"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ok-new-tags">Tags (comma-separated)</Label>
                <Input
                  id="ok-new-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="ops, on-call, payments"
                  data-testid="ok-new-tags"
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <DialogFooter className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step === 1 ? onOpenChange(false) : setStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : s)))}
            data-testid="ok-new-back"
          >
            <ChevronLeft className="mr-1 h-3 w-3" aria-hidden="true" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button
              size="sm"
              disabled={step === 1 && !kind}
              onClick={() => setStep((s) => (s < 3 ? ((s + 1) as 2 | 3) : s))}
              data-testid="ok-new-next"
              className="bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50"
            >
              Next <ChevronRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSubmit}
                data-testid="ok-new-create-draft"
              >
                Create draft
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                data-testid="ok-new-create-edit"
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                Create & start editing
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}