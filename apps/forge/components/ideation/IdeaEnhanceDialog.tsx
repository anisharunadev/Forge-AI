'use client';

/**
 * Forge AI-440 / Pillar 1 Phase 2 — "Enhance" modal for the Ideation
 * Center.
 *
 * PMs can attach an editor note to a pending idea before approving it.
 * Submitting the form posts to
 * `POST /v1/ideation/ideas/{id}/enhance` and the server returns the
 * refreshed `IdeaAnalysisRead`. The dialog shows a small success card
 * with the new summary (and the editor note the PM just attached) so
 * the operator has a receipt without leaving the page.
 *
 * Reuses shadcn/ui `Sheet` (same primitive as
 * `<IdeaDetailPanel>`) and the canonical `<Textarea>` and `<Button>`
 * shadcn components. Mirrors the accessibility and test-id conventions
 * of `<PushIdeaToJiraButton>` so the dialog is easy to drive from
 * Vitest + RTL.
 */

import * as React from 'react';
import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIdeaEnhance } from '@/lib/hooks/useIdeaEnhance';
import type { Idea, IdeaAnalysis } from '@/lib/ideation/data';

export interface IdeaEnhanceDialogProps {
  idea: Idea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Empty-note minimum length. The endpoint accepts any string but the
 * UX rule is "no empty enhance" — an empty note is a no-op that
 * wastes an LLM call. Zero is rejected client-side.
 */
const MIN_NOTE_LENGTH = 1;

/**
 * Modal dialog for attaching an editor note to an idea and triggering
 * the re-analyze pipeline. Closes on success; stays open on error so
 * the PM can retry without retyping.
 */
export function IdeaEnhanceDialog({
  idea,
  open,
  onOpenChange,
}: IdeaEnhanceDialogProps) {
  const [editorNote, setEditorNote] = React.useState('');
  const [submittedNote, setSubmittedNote] = React.useState<string | null>(null);

  // The hook stays mounted across opens/closes (TanStack Query keeps
  // the mutation cache warm). Gating on `open` keeps `ideaId` empty
  // when the dialog is closed so the mutation can't fire in a
  // half-state.
  const ideaId = open && idea ? idea.id : '';
  const mutation = useIdeaEnhance(ideaId);

  // Reset local state every time the dialog opens so a closed-then-
  // reopened dialog starts clean.
  React.useEffect(() => {
    if (open) {
      setEditorNote('');
      setSubmittedNote(null);
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idea?.id]);

  const trimmed = editorNote.trim();
  const canSubmit = trimmed.length >= MIN_NOTE_LENGTH && !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !ideaId) return;
    setSubmittedNote(trimmed);
    mutation.mutate({ editorNote: trimmed });
  };

  const handleClose = () => {
    if (mutation.isPending) return;
    onOpenChange(false);
  };

  // Render the success card once the mutation has settled. The card
  // includes the editor note the PM attached so they can confirm what
  // was sent, plus the server's summary as a receipt.
  const showSuccess = mutation.isSuccess && mutation.data;
  const showError = mutation.isError;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl"
        data-testid="idea-enhance-dialog"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
            Enhance idea
          </SheetTitle>
          <SheetDescription>
            {idea ? (
              <>
                Attach an editor note and re-run the analysis pipeline
                for <span className="font-mono text-xs">{idea.id}</span>.
              </>
            ) : (
              'Attach an editor note to re-run the analysis.'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-4 overflow-y-auto pr-2">
          {idea ? (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Idea
              </h3>
              <p className="text-sm font-medium">{idea.title}</p>
              <p className="text-xs text-muted-foreground">{idea.summary}</p>
            </section>
          ) : null}

          {!showSuccess ? (
            <section className="flex flex-col gap-2">
              <label
                htmlFor="idea-enhance-textarea"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Editor note
              </label>
              <Textarea
                id="idea-enhance-textarea"
                data-testid="idea-enhance-textarea"
                aria-label="Editor note"
                placeholder="What should the re-analysis focus on?"
                value={editorNote}
                onChange={(e) => setEditorNote(e.target.value)}
                disabled={mutation.isPending}
                rows={6}
              />
              <p className="text-[11px] text-muted-foreground">
                {trimmed.length} / 2000 characters
              </p>
            </section>
          ) : (
            <EnhanceSuccessCard
              analysis={mutation.data!}
              submittedNote={submittedNote ?? ''}
            />
          )}

          {showError ? (
            <div
              role="alert"
              data-testid="idea-enhance-error"
              className="flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">
                {mutation.error?.message ?? 'Enhance failed.'}
              </span>
              <button
                type="button"
                onClick={handleSubmit}
                aria-label="Retry enhance"
                data-testid="idea-enhance-retry"
                className="rounded border border-rose-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:bg-rose-500/20"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            {!showSuccess ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={mutation.isPending}
                  aria-label="Cancel enhance"
                  data-testid="idea-enhance-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  aria-label="Submit enhance"
                  data-testid="idea-enhance-submit"
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  {mutation.isPending ? 'Enhancing…' : 'Enhance'}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={handleClose}
                aria-label="Close enhance dialog"
                data-testid="idea-enhance-close"
              >
                Close
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Success card — shown after the mutation settles. Includes the
 * editor note the PM sent and the server's refreshed summary so the
 * operator has a receipt before closing the dialog.
 */
interface EnhanceSuccessCardProps {
  analysis: IdeaAnalysis;
  submittedNote: string;
}

function EnhanceSuccessCard({ analysis, submittedNote }: EnhanceSuccessCardProps) {
  return (
    <div
      data-testid="idea-enhance-success"
      className="flex flex-col gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs"
    >
      <div className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wider">
          Enhancement complete
        </span>
      </div>
      <div>
        <p className="font-semibold uppercase tracking-wider text-emerald-300">
          Editor note
        </p>
        <p className="text-forge-100">{submittedNote}</p>
      </div>
      <div>
        <p className="font-semibold uppercase tracking-wider text-emerald-300">
          New summary
        </p>
        <p className="text-forge-100">
          {analysis.summary || '(no summary returned)'}
        </p>
      </div>
      {analysis.risks.length > 0 ? (
        <div>
          <p className="font-semibold uppercase tracking-wider text-emerald-300">
            Risks
          </p>
          <ul className="ml-4 list-disc text-forge-100">
            {analysis.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
