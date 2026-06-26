'use client';

/**
 * `useIdeationHotkeys` — Step 28.
 *
 * Global keyboard shortcuts wired on the Ideation Center page:
 *
 *   ⌘N              new idea (CaptureModal)
 *   ⌘⇧V             voice capture (switch CaptureModal to voice tab)
 *   ⌘⇧S             screen capture (switch CaptureModal to screen tab)
 *   ⌘K              search
 *   ⌘⇧P             process now (PipelineView)
 *   ⌘/              show shortcut sheet
 *
 * Mac-only on ⌘; non-Mac (Ctrl) is wired as a mirror so the bindings
 * work on Windows / Linux dev machines. The hook no-ops when the
 * target is inside an editable field (input / textarea / contentEditable).
 */

import * as React from 'react';

export type HotkeyId =
  | 'new-idea'
  | 'voice'
  | 'screen'
  | 'search'
  | 'process-now'
  | 'shortcuts';

export interface UseIdeationHotkeysOptions {
  /** Called for each matched hotkey. */
  readonly onHotkey: (id: HotkeyId) => void;
  /** Disable all shortcuts (e.g., during loading). */
  readonly disabled?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useIdeationHotkeys({ onHotkey, disabled }: UseIdeationHotkeysOptions): void {
  React.useEffect(() => {
    if (disabled) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (e.shiftKey) {
        if (key === 'v') {
          e.preventDefault();
          onHotkey('voice');
          return;
        }
        if (key === 's') {
          e.preventDefault();
          onHotkey('screen');
          return;
        }
        if (key === 'p') {
          e.preventDefault();
          onHotkey('process-now');
          return;
        }
      }

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        onHotkey('new-idea');
        return;
      }
      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        onHotkey('search');
        return;
      }
      if (key === '/' && !e.shiftKey) {
        e.preventDefault();
        onHotkey('shortcuts');
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onHotkey, disabled]);
}