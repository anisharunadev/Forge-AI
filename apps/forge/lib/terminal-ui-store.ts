'use client';

/**
 * Terminal — UI store (rail state, focus mode, help overlay).
 *
 * Persists user preferences (which rails are open, focus mode toggle,
 * visit counter) into localStorage so the canvas-first layout survives
 * reloads. Keeps the *terminal session* state (sessions, audit, layout)
 * in `useTerminalStore` — this store is strictly chrome.
 *
 * Skill influence:
 *   - ux-guideline (z-index management) — focus mode uses a defined
 *     z-index tier (z-50) so it always sits above rails (z-20) and the
 *     terminal canvas (z-10).
 *   - ux-guideline (reduced-motion) — slide/fade transitions are short
 *     (180-200ms) and rely on the global reduced-motion rule.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LeftRailSection = 'sessions' | 'context' | 'skills' | 'commands' | 'layout';

/** Right rail only has the audit log today; the union leaves room for future sections. */
export type RightRailSection = 'audit';

/** UI state for the terminal workspace chrome. */
interface TerminalUiState {
  /** Currently expanded left rail section — null means collapsed. */
  leftRail: LeftRailSection | null;
  /** Currently expanded right rail section — null means collapsed. */
  rightRail: RightRailSection | null;
  /** Visit counter — used to suppress first-visit tooltips after 5 visits. */
  visitCount: number;
  /** Whether the help overlay is open. */
  helpOpen: boolean;
  /** Whether focus mode (Zen) is active. */
  focusMode: boolean;

  /** Toggle a left rail section — clicking the same one collapses it. */
  toggleLeftRail: (section: LeftRailSection) => void;
  /** Toggle a right rail section. */
  toggleRightRail: (section: RightRailSection) => void;
  /** Close both rails (terminal-only mode). */
  collapseAllRails: () => void;
  /** Expand a specific rail section (used by Cmd+Shift+0 to expand everything). */
  setLeftRail: (section: LeftRailSection | null) => void;
  setRightRail: (section: RightRailSection | null) => void;

  /** Help overlay controls. */
  openHelp: () => void;
  closeHelp: () => void;

  /** Focus mode controls. */
  toggleFocusMode: () => void;
  setFocusMode: (on: boolean) => void;

  /** Increment the visit counter (called once on mount). */
  bumpVisitCount: () => void;
}

const STORAGE_KEY = 'forge:terminal-ui:v1';

export const useTerminalUiStore = create<TerminalUiState>()(
  persist(
    (set, get) => ({
      // First-visit defaults: both rails collapsed so the terminal gets
      // the full canvas. The visit counter starts at 0 so the first-visit
      // tooltips fire once and then get suppressed after 5 visits.
      leftRail: null,
      rightRail: null,
      visitCount: 0,
      helpOpen: false,
      focusMode: false,

      toggleLeftRail: (section) => {
        const cur = get().leftRail;
        set({ leftRail: cur === section ? null : section });
      },
      toggleRightRail: (section) => {
        const cur = get().rightRail;
        set({ rightRail: cur === section ? null : section });
      },
      collapseAllRails: () => set({ leftRail: null, rightRail: null }),
      setLeftRail: (section) => set({ leftRail: section }),
      setRightRail: (section) => set({ rightRail: section }),

      openHelp: () => set({ helpOpen: true }),
      closeHelp: () => set({ helpOpen: false }),

      toggleFocusMode: () => set({ focusMode: !get().focusMode }),
      setFocusMode: (on) => set({ focusMode: on }),

      bumpVisitCount: () => set({ visitCount: get().visitCount + 1 }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist preferences — never persist transient dialog state.
      partialize: (state) => ({
        leftRail: state.leftRail,
        rightRail: state.rightRail,
        visitCount: state.visitCount,
        focusMode: state.focusMode,
      }),
      version: 1,
    },
  ),
);

/** Stable ordered list of left-rail sections — drives both the rail UI and shortcuts. */
export const LEFT_RAIL_SECTIONS: ReadonlyArray<{
  id: LeftRailSection;
  label: string;
  shortcut: string;
}> = [
  { id: 'sessions', label: 'Sessions',  shortcut: '⌘1' },
  { id: 'context',  label: 'Context',   shortcut: '⌘2' },
  { id: 'skills',   label: 'Skills',    shortcut: '⌘3' },
  { id: 'commands', label: 'Commands',  shortcut: '⌘4' },
  { id: 'layout',   label: 'Layout',    shortcut: '⌘L' },
];

export const RIGHT_RAIL_SECTIONS: ReadonlyArray<{
  id: RightRailSection;
  label: string;
  shortcut: string;
}> = [
  { id: 'audit', label: 'Audit log', shortcut: '⌘5' },
];