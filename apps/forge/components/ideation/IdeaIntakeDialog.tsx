'use client';

/**
 * IdeaIntakeDialog — Step 5 redesign.
 *
 * shadcn Dialog centered, --bg-elevated, --radius-xl, max-w 560px.
 * Auto-grow textarea for description. Submit triggers Sonner toast
 * with a 4s progress bar and emits the create event to the parent.
 */

import * as React from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

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
import { Textarea } from '@/components/ui/textarea';

export type IdeaCategory =
  | 'product'
  | 'engineering'
  | 'security'
  | 'operations'
  | 'research';

export interface IdeaIntakeInput {
  title: string;
  summary: string;
  category: IdeaCategory;
  owner: string;
}

export interface IdeaIntakeDialogProps {
  onCreate?: (input: IdeaIntakeInput) => void;
  defaultCategory?: IdeaCategory;
}

const CATEGORIES: ReadonlyArray<{ value: IdeaCategory; label: string }> = [
  { value: 'product', label: 'Product' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'security', label: 'Security' },
  { value: 'operations', label: 'Operations' },
  { value: 'research', label: 'Research' },
];

export function IdeaIntakeDialog({ onCreate, defaultCategory = 'product' }: IdeaIntakeDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [category, setCategory] = React.useState<IdeaCategory>(defaultCategory);
  const [owner, setOwner] = React.useState('');

  const summaryRef = React.useRef<HTMLTextAreaElement>(null);
  const handleSummaryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSummary(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  };

  const canSubmit = title.trim().length > 0 && summary.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const input: IdeaIntakeInput = { title, summary, category, owner };
    onCreate?.(input);
    // eslint-disable-next-line no-console
    console.info('[ideation:intake] submit', input);
    toast.success('Idea captured — AI will score it shortly', {
      description: title,
      duration: 4000,
      progressBar: true,
    });
    setTitle('');
    setSummary('');
    setOwner('');
    setCategory(defaultCategory);
    if (summaryRef.current) summaryRef.current.style.height = 'auto';
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          data-testid="idea-intake-trigger"
          className="bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Idea
        </Button>
      </DialogTrigger>
      <DialogContent
        data-testid="idea-intake-dialog"
        className="max-w-[560px] rounded-[var(--radius-xl)] border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--text-lg)]">
            <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            Submit a new idea
          </DialogTitle>
          <DialogDescription className="text-[var(--fg-secondary)]">
            Ideas enter the intake pipeline and are scored by AI before moving to discovery.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="idea-title" className="text-[var(--fg-secondary)]">
              Title
            </Label>
            <Input
              id="idea-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cost-aware agent routing"
              required
              data-testid="idea-intake-title"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="idea-summary" className="text-[var(--fg-secondary)]">
              Description
            </Label>
            <Textarea
              id="idea-summary"
              ref={summaryRef}
              value={summary}
              onChange={handleSummaryChange}
              placeholder="Describe the problem and your proposed approach"
              rows={3}
              required
              data-testid="idea-intake-summary"
              className="resize-none overflow-hidden"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="idea-category" className="text-[var(--fg-secondary)]">
                Category
              </Label>
              <select
                id="idea-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as IdeaCategory)}
                data-testid="idea-intake-category"
                className="block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-2 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="idea-owner" className="text-[var(--fg-secondary)]">
                Owner
              </Label>
              <Input
                id="idea-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. Priya Shah"
                data-testid="idea-intake-owner"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="idea-intake-submit"
              className="bg-[var(--accent-primary)] text-white hover:opacity-90"
            >
              Submit for scoring
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
