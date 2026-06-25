'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MarkdownViewer } from './MarkdownViewer';

export interface MarkdownEditorProps {
  /** Initial markdown source. */
  initialSource: string;
  /** Called with the latest source on every change (controlled mode). */
  onChange?: (source: string) => void;
  /** Called when the user clicks Save. */
  onSave?: (source: string) => void | Promise<void>;
  /** Disable the Save button (e.g. while a save is in flight). */
  saving?: boolean;
  /** Label shown on the Save button. */
  saveLabel?: string;
  className?: string;
  /** Whether the editor starts open by default (defaults to true). */
  defaultEditing?: boolean;
}

/**
 * Markdown editor with a live preview pane.
 *
 * Layout:
 *
 *   ┌────────────────────────────────────────────┐
 *   │  textarea (raw markdown)                   │
 *   │                                            │
 *   ├────────────────────────────────────────────┤
 *   │  rendered preview                          │
 *   └────────────────────────────────────────────┘
 *   [ Save ]  [ Reset ]
 *
 * The editor is intentionally a plain `<textarea>` so the user can edit
 * 30+ KB skill files without a heavy CodeMirror/Monaco dependency.
 */
export function MarkdownEditor({
  initialSource,
  onChange,
  onSave,
  saving,
  saveLabel = 'Save',
  className,
  defaultEditing = true,
}: MarkdownEditorProps) {
  const [source, setSource] = React.useState(initialSource);
  const [editing, setEditing] = React.useState(defaultEditing);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset when the upstream source changes (e.g. user picks a different command).
  React.useEffect(() => {
    setSource(initialSource);
    setDirty(false);
    setError(null);
  }, [initialSource]);

  const update = (next: string) => {
    setSource(next);
    setDirty(next !== initialSource);
    onChange?.(next);
  };

  const save = async () => {
    setError(null);
    try {
      await onSave?.(source);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      data-testid="markdown-editor"
      className={cn('flex flex-col gap-3', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={editing ? 'default' : 'outline'}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!editing ? 'default' : 'outline'}
            onClick={() => setEditing(false)}
          >
            Preview
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          ) : (
            <span className="text-xs text-muted-foreground">No changes</span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => update(initialSource)}
            disabled={!dirty || saving}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
            data-testid="markdown-editor-save"
          >
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>

      {editing ? (
        <textarea
          data-testid="markdown-editor-textarea"
          value={source}
          onChange={(e) => update(e.target.value)}
          spellCheck={false}
          className={cn(
            'h-[60vh] w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground',
            'focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary',
          )}
        />
      ) : (
        <MarkdownViewer source={source} caption="Preview" />
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
