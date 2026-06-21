'use client';

import * as React from 'react';
import { Save, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CATEGORY_LABEL, type Standard } from '@/lib/org-knowledge/data';
import { cn } from '@/lib/utils';

export interface StandardsEditorProps {
  standard: Standard | null;
  onSave?: (body: string) => void;
}

export function StandardsEditor({ standard, onSave }: StandardsEditorProps) {
  const [body, setBody] = React.useState('');

  React.useEffect(() => {
    setBody(standard?.body ?? '');
  }, [standard]);

  if (!standard) {
    return (
      <div
        className="card flex h-64 items-center justify-center text-sm text-forge-300"
        data-testid="standards-editor-empty"
      >
        Select a standard to edit.
      </div>
    );
  }

  return (
    <article
      className="card space-y-4"
      data-testid="standards-editor"
      data-standard-id={standard.id}
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-forge-300">
          <span>{CATEGORY_LABEL[standard.category]}</span>
          <span>·</span>
          <span>v{standard.version}</span>
          <span>·</span>
          <span>{standard.owner}</span>
        </div>
        <h2 className="text-xl font-semibold text-forge-50">{standard.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{standard.status}</Badge>
          <span className="text-[10px] text-forge-300">
            updated {standard.updatedAt}
          </span>
        </div>
      </header>

      <div className="grid gap-1.5">
        <label
          htmlFor="standard-body"
          className="text-xs font-medium text-forge-300"
        >
          Body
        </label>
        <Textarea
          id="standard-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-[220px] font-mono text-xs"
          data-testid="standards-body"
        />
      </div>

      {standard.status === 'in-review' ? (
        <p
          className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200"
          data-testid="standards-review-banner"
        >
          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
          This standard is in review. Saving will create a new revision.
        </p>
      ) : null}

      <footer className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBody(standard.body)}
          data-testid="standards-reset"
        >
          Reset
        </Button>
        <Button
          size="sm"
          onClick={() => onSave?.(body)}
          disabled={body === standard.body}
          data-testid="standards-save"
        >
          <Save className="h-3 w-3" aria-hidden="true" />
          Save revision
        </Button>
      </footer>
    </article>
  );
}

