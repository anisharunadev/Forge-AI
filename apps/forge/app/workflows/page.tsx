'use client';

/**
 * Workflows page — Mode A (Template Gallery) ↔ Mode B (Canvas).
 *
 * Two views in one route. State machine:
 *   - 'gallery' (default): template gallery with KPIs + tabs
 *   - 'canvas': React Flow editor for a specific workflow
 *
 * Transitioning from gallery → canvas seeds the store with the
 * chosen template's nodes + edges via `hydrateFromTemplate`.
 */

import * as React from 'react';

import { WorkflowGallery } from '@/components/workflow/WorkflowGallery';
import { WorkflowCanvas } from '@/components/workflow/WorkflowCanvas';
import { useWorkflowStore } from '@/components/workflow/store';
import type { WorkflowTemplate } from '@/lib/workflow/types';

type View = 'gallery' | 'canvas';

export default function WorkflowsPage() {
  const [view, setView] = React.useState<View>('gallery');
  const hydrateFromTemplate = useWorkflowStore((s) => s.hydrateFromTemplate);
  const setDoc = useWorkflowStore((s) => s.setDoc);

  const openTemplate = React.useCallback(
    (template: WorkflowTemplate) => {
      setDoc({ name: template.name, description: template.description });
      hydrateFromTemplate({
        nodes: template.nodes,
        edges: template.edges,
        name: template.name,
        description: template.description,
      });
      setView('canvas');
    },
    [hydrateFromTemplate, setDoc],
  );

  const openFromScratch = React.useCallback(() => {
    setDoc({ name: 'Untitled workflow', description: '' });
    hydrateFromTemplate({ nodes: [], edges: [], name: 'Untitled workflow', description: '' });
    setView('canvas');
  }, [hydrateFromTemplate, setDoc]);

  const backToGallery = React.useCallback(() => {
    setView('gallery');
  }, []);

  if (view === 'canvas') {
    return <WorkflowCanvas onBack={backToGallery} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <WorkflowGallery
        onOpenTemplate={openTemplate}
        onOpenUserWorkflow={(id) => {
          setDoc({ name: `Workflow ${id}` });
          hydrateFromTemplate({ nodes: [], edges: [], name: `Workflow ${id}`, description: 'Opened from My workflows' });
          setView('canvas');
        }}
        onFromScratch={openFromScratch}
      />
    </div>
  );
}