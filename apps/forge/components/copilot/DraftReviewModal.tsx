'use client';

/**
 * F-800 — Draft review modal.
 *
 * Opens when the user clicks a `draft`-type suggested action. Shows
 * the draft title, body (rendered as plain text for V1 — markdown
 * render lands when artifact registry surfaces the saved draft),
 * and the source citation list ("based on"). Two actions:
 *   - "Save as draft" — posts to the artifact registry (Plan 1
 *     endpoints; for V1, the modal just closes after a toast).
 *   - "Discard" — closes the modal.
 */

import * as React from 'react';
import { FileEdit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { CopilotSuggestedAction } from '@/lib/api/copilot';
import { cn } from '@/lib/utils';

export interface DraftReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The suggested action whose `payload` carries the draft shape. */
  action: CopilotSuggestedAction | null;
}

interface DraftPayload {
  title?: string;
  content?: string;
  based_on?: string[];
  artifact_type?: string;
}

function readPayload(action: CopilotSuggestedAction | null): DraftPayload {
  if (!action) return {};
  const payload = action.payload as DraftPayload;
  return {
    title: typeof payload.title === 'string' ? payload.title : action.label,
    content: typeof payload.content === 'string' ? payload.content : '',
    based_on: Array.isArray(payload.based_on)
      ? (payload.based_on as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
    artifact_type:
      typeof payload.artifact_type === 'string'
        ? payload.artifact_type
        : 'artifact',
  };
}

/**
 * Modal that lets the user review a Co-pilot-generated draft before
 * saving. The actual artifact-registry POST lives in Plan 5; for
 * Plan 3 the save button is a placeholder that emits a toast and
 * closes the modal.
 */
export function DraftReviewModal({
  open,
  onOpenChange,
  action,
}: DraftReviewModalProps) {
  const { toast } = useToast();
  const draft = React.useMemo(() => readPayload(action), [action]);

  const handleSave = React.useCallback(() => {
    // The actual `POST /artifacts` call lands in Plan 5 — for now we
    // surface a clear toast so the UI flow is testable end-to-end.
    toast({
      title: 'Draft saved',
      description: `${draft.title ?? 'Untitled draft'} is in your drafts.`,
      variant: 'default',
    });
    onOpenChange(false);
  }, [toast, draft.title, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="copilot-draft-review-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileEdit className="h-4 w-4" aria-hidden="true" />
            Review Co-pilot draft
          </DialogTitle>
          <DialogDescription>
            Co-pilot drafted this from your request. Save it as a draft
            (status <code className="font-mono text-xs">DRAFT</code>) or
            discard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Title
            </p>
            <p className="text-sm font-semibold">{draft.title ?? 'Untitled draft'}</p>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Type
            </p>
            <p className="font-mono text-xs">{draft.artifact_type ?? 'artifact'}</p>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Body
            </p>
            <pre
              className={cn(
                'max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-xs',
              )}
              data-testid="copilot-draft-body"
            >
              {draft.content || '(empty)'}
            </pre>
          </div>
          {draft.based_on && draft.based_on.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Based on
              </p>
              <ul role="list" className="list-disc pl-5 text-xs">
                {draft.based_on.map((src, i) => (
                  <li key={`${src}-${i}`}>{src}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="copilot-draft-discard"
          >
            Discard
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            data-testid="copilot-draft-save"
          >
            Save as draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}