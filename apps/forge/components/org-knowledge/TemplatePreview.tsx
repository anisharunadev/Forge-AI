'use client';

import * as React from 'react';
import { TEMPLATE_KIND_LABEL, type Template } from '@/lib/org-knowledge/data';

export interface TemplatePreviewProps {
  template: Template;
}

export function TemplatePreview({ template }: TemplatePreviewProps) {
  return (
    <article
      className="card space-y-3"
      data-testid="template-preview"
      data-template-id={template.id}
    >
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-forge-300">
          {TEMPLATE_KIND_LABEL[template.kind]}
        </p>
        <h3 className="text-lg font-semibold text-forge-50">{template.title}</h3>
        <p className="text-xs text-forge-200">{template.description}</p>
      </header>

      <pre
        className="overflow-x-auto rounded-md border border-forge-800 bg-forge-900 p-3 font-mono text-[11px] text-forge-100"
        data-testid="template-preview-body"
      >
        {template.preview}
      </pre>

      <footer className="flex items-center justify-between text-[10px] text-forge-300">
        <span>updated {template.updatedAt}</span>
        <span>{template.uses} uses</span>
      </footer>
    </article>
  );
}
