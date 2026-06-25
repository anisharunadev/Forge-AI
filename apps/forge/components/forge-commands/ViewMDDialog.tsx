'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import type { ForgeCommand } from '@/lib/forge-commands';
import { useCommandArtifact } from '@/hooks/use-command-artifact';
import { MarkdownEditor } from '@/components/markdown';
import { MarkdownViewer } from '@/components/markdown/MarkdownViewer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ViewMDDialogProps {
  command: ForgeCommand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal that opens when a Command Card's "View" button is clicked.
 *
 * Fetches the SKILL.md body for the command from
 * `GET /api/v1/commands/{name}/artifact`, renders it with MarkdownViewer,
 * and toggles to a MarkdownEditor for inline editing. Saves call
 * `PUT /api/v1/commands/{name}/artifact`.
 *
 * Editing is enabled by default per product spec ("users can edit it by
 * default") — the user can flip to the rendered Preview at any time.
 */
export function ViewMDDialog({
  command,
  open,
  onOpenChange,
}: ViewMDDialogProps) {
  const { artifact, loading, error, save, saving } = useCommandArtifact(
    command.name,
    open,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="view-md-dialog"
        data-command={command.name}
        className="max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{command.label}</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-xs">{command.name}</code>
            {' · '}
            <span>skill file is editable in place</span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div
            className="flex items-center gap-2 p-8 text-sm text-muted-foreground"
            data-testid="view-md-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading skill file…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            Failed to load skill file: {error}
          </div>
        ) : artifact ? (
          <MarkdownEditor
            initialSource={artifact.content}
            onSave={save}
            saving={saving}
            saveLabel="Save skill file"
          />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">
            No skill file available for this command.
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// MarkdownViewer is re-exported so legacy callers can pull it from this file.
export { MarkdownViewer };
