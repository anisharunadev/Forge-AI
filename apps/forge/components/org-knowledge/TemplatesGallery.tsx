'use client';

import * as React from 'react';
import { LayoutTemplate, Eye } from 'lucide-react';

import { TemplatePreview } from '@/components/org-knowledge/TemplatePreview';
import {
  TEMPLATE_KIND_LABEL,
  type Template,
} from '@/lib/org-knowledge/data';
import { Button } from '@/components/ui/button';

export interface TemplatesGalleryProps {
  templates: ReadonlyArray<Template>;
  onUse?: (template: Template) => void;
}

export function TemplatesGallery({ templates, onUse }: TemplatesGalleryProps) {
  const [previewId, setPreviewId] = React.useState<string | null>(
    templates[0]?.id ?? null,
  );
  const preview = templates.find((t) => t.id === previewId) ?? null;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[260px_1fr]"
      data-testid="templates-gallery"
    >
      <ul
        role="list"
        aria-label="Template list"
        className="space-y-2"
        data-testid="templates-list"
      >
        {templates.map((t) => {
          const active = t.id === previewId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setPreviewId(t.id)}
                className={
                  active
                    ? 'card w-full text-left ring-1 ring-ring'
                    : 'card w-full text-left hover:bg-forge-800/60'
                }
                data-testid={`templates-item-${t.id}`}
                data-selected={String(active)}
              >
                <div className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-forge-300" aria-hidden="true" />
                  <span className="font-medium">{t.title}</span>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-forge-300">
                  {TEMPLATE_KIND_LABEL[t.kind]} · {t.uses} uses
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-3">
        {preview ? (
          <TemplatePreview template={preview} />
        ) : (
          <div className="card text-sm text-forge-300">No template selected.</div>
        )}
        {preview ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => onUse?.(preview)}
              data-testid="templates-use"
            >
              <Eye className="h-3 w-3" aria-hidden="true" />
              Use template
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
