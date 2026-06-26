'use client';

/**
 * useWorkflowKeyboard — the editor's global keyboard shortcuts.
 *
 * Mounted by the canvas component. Listens on the canvas root so
 * inputs (e.g. the inspector) do not swallow the shortcuts.
 *
 * Shortcuts:
 *   - Space: open the Space palette (Command-style popover)
 *   - Delete / Backspace: delete selected node
 *   - Ctrl/Cmd+Z: undo (stub — UI only, real history is React Flow's history plugin)
 *   - Ctrl/Cmd+Shift+Z: redo
 *   - Ctrl/Cmd+S: force save
 *   - Ctrl/Cmd+Enter: run workflow
 *   - Esc: deselect node, close panels
 *   - Arrow keys: nudge selected node (Shift = 10px)
 */

import * as React from 'react';
import { useReactFlow } from '@xyflow/react';

import { useWorkflowStore } from './store';

export interface UseWorkflowKeyboardOptions {
  readonly onOpenPalette: () => void;
  readonly onRun: () => void;
  readonly onForceSave: () => void;
}

export function useWorkflowKeyboard({
  onOpenPalette,
  onRun,
  onForceSave,
}: UseWorkflowKeyboardOptions): void {
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setRightPanel = useWorkflowStore((s) => s.setRightPanel);
  const selectedId = useWorkflowStore((s) => s.selectedNodeId);
  const { getNodes, setNodes } = useReactFlow();

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      // Don't hijack typing in inputs.
      if (isInput) return;

      // Space — open palette
      if (e.code === 'Space') {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Esc — deselect / close panel
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setRightPanel('settings');
        return;
      }

      // Ctrl/Cmd + Enter — run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onRun();
        return;
      }

      // Ctrl/Cmd + S — save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onForceSave();
        return;
      }

      // Undo / Redo — left as future work; do not silently mutate.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        // No-op placeholder — surface in UI as a toast via parent.
        return;
      }

      // Delete — remove selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeNode(selectedId);
        return;
      }

      // Arrow nudge
      if (selectedId && e.key.startsWith('Arrow')) {
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (dx === 0 && dy === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const next = getNodes().map((n) =>
          n.id === selectedId ? { ...n, position: { x: n.position.x + dx * step, y: n.position.y + dy * step } } : n,
        );
        setNodes(next);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, setSelectedNode, setRightPanel, removeNode, onOpenPalette, onRun, onForceSave, getNodes, setNodes]);
}