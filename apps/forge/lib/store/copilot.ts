/**
 * Co-pilot client state (Zustand).
 *
 * Drives the right-side Cmd+J Co-pilot panel. Mirrors the shape of
 * `useTerminalStore` (see `lib/store.ts`) so the rest of the app
 * can compose panel + terminal state in one place later if needed.
 *
 * F-800 Plan 2 — frontend shell + scaffold. Plan 3 adds the
 * conversation list + API integration on top of these primitives.
 * Plan 4 adds `firstRunDismissed` + `dismissFirstRun()` so the
 * one-time "Press ⌘J to chat with Co-pilot" tooltip can persist
 * its dismissal across reloads via localStorage.
 */

import { create } from 'zustand';

const FIRST_RUN_STORAGE_KEY = 'forge.copilot.firstRunDismissed';

interface CopilotState {
  open: boolean;
  activeConversationId: string | null;
  draft: string;
  lastError: string | null;
  /** True when a tool call or API request returned 403. Drives the
   *  ``PermissionDeniedBanner``. Distinct from ``lastError`` so we
   *  don't false-positive on every transient fetch error. */
  permissionDenied: boolean;
  firstRunDismissed: boolean;
  /** True while the Co-pilot is generating a response (used by the
   *  floating launcher to show the "thinking" gradient pulse even
   *  after the panel is closed). Set true on send, false on settle. */
  streaming: boolean;
  /** Unread message count surfaced on the FAB's notification badge.
   *  Increments when a response lands while the panel is closed;
   *  clears when the user opens the panel. */
  unreadCount: number;

  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversation: (id: string | null) => void;
  setDraft: (draft: string) => void;
  appendDraft: (chunk: string) => void;
  clearDraft: () => void;
  setError: (msg: string | null) => void;
  setPermissionDenied: (denied: boolean) => void;
  dismissFirstRun: () => void;
  setStreaming: (streaming: boolean) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
  /** Per-conversation pin flag — local-only UI state. Mirrors the
   *  pinned set persisted by `ConversationList`. `null` when there
   *  is no active conversation to pin. */
  isPinned: boolean;
  setPinned: (pinned: boolean) => void;
}

export const useCopilotStore = create<CopilotState>((set) => ({
  open: false,
  activeConversationId: null,
  draft: '',
  lastError: null,
  permissionDenied: false,
  // SSR-safe default. The real localStorage value is loaded in a
  // client-only ``useEffect`` (see ``useHydrateCopilotFlags``) so the
  // server-rendered HTML matches the first client render and React
  // does not log a hydration mismatch.
  firstRunDismissed: false,
  streaming: false,
  unreadCount: 0,
  isPinned: false,

  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setDraft: (draft) => set({ draft }),
  appendDraft: (chunk) =>
    set((state) => ({ draft: state.draft + chunk })),
  clearDraft: () => set({ draft: '' }),
  setError: (msg) => set({ lastError: msg, permissionDenied: false }),
  setPermissionDenied: (denied) =>
    set({ permissionDenied: denied, lastError: denied ? 'permission_denied' : null }),
  dismissFirstRun: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, '1');
    }
    set({ firstRunDismissed: true });
  },
  setStreaming: (streaming) =>
    set((state) => ({
      streaming,
      // When a response lands while the panel is closed, surface a
      // notification badge on the FAB. We only increment when the
      // transition is false→false→true→false (i.e. settled) AND the
      // panel wasn't open to witness the arrival. The FAB clears
      // the count the next time the user opens the panel.
      unreadCount: !streaming && !state.open && state.streaming ? state.unreadCount + 1 : state.unreadCount,
    })),
  incrementUnread: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),
  clearUnread: () => set({ unreadCount: 0 }),
  setPinned: (pinned) => set({ isPinned: pinned }),
}));

/**
 * Hydrate client-only flags from ``localStorage`` after mount.
 *
 * Must be called from a component (not at module top-level) so it
 * runs during the React commit phase on the client. Calling
 * ``useCopilotStore.setState`` here is safe because we wait for the
 * effect — server render and the very first client render both see
 * the SSR-safe default ``firstRunDismissed: false``.
 */
export function useHydrateCopilotFlags(): void {
  if (typeof window === 'undefined') return;
  const stored = window.localStorage.getItem(FIRST_RUN_STORAGE_KEY);
  if (stored === '1' && !useCopilotStore.getState().firstRunDismissed) {
    useCopilotStore.setState({ firstRunDismissed: true });
  }
}
