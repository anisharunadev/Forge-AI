/**
 * F-800 Plan 3 — `useCopilotStore` Zustand unit tests.
 *
 * Verifies:
 *   - `toggle()` flips `open`
 *   - `setActiveConversation(id)` updates `activeConversationId`
 *   - `appendDraft` + `clearDraft` mutate the draft string
 *   - `dismissFirstRun()` persists to localStorage
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useCopilotStore } from '../../lib/store/copilot';

beforeEach(() => {
  // Reset the store to known initial state for each test.
  useCopilotStore.setState({
    open: false,
    activeConversationId: null,
    draft: '',
    lastError: null,
    firstRunDismissed: false,
  });
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('forge.copilot.firstRunDismissed');
  }
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('forge.copilot.firstRunDismissed');
  }
});

describe('useCopilotStore', () => {
  it('toggle() flips `open`', () => {
    expect(useCopilotStore.getState().open).toBe(false);
    act(() => useCopilotStore.getState().toggle());
    expect(useCopilotStore.getState().open).toBe(true);
    act(() => useCopilotStore.getState().toggle());
    expect(useCopilotStore.getState().open).toBe(false);
  });

  it('setOpen() sets the explicit value', () => {
    act(() => useCopilotStore.getState().setOpen(true));
    expect(useCopilotStore.getState().open).toBe(true);
  });

  it('setActiveConversation() updates activeConversationId', () => {
    act(() => useCopilotStore.getState().setActiveConversation('c-1'));
    expect(useCopilotStore.getState().activeConversationId).toBe('c-1');
    act(() => useCopilotStore.getState().setActiveConversation(null));
    expect(useCopilotStore.getState().activeConversationId).toBeNull();
  });

  it('appendDraft() concatenates chunks', () => {
    act(() => useCopilotStore.getState().appendDraft('Hello'));
    act(() => useCopilotStore.getState().appendDraft(', world'));
    expect(useCopilotStore.getState().draft).toBe('Hello, world');
  });

  it('clearDraft() resets draft to empty', () => {
    act(() => useCopilotStore.getState().setDraft('something'));
    expect(useCopilotStore.getState().draft).toBe('something');
    act(() => useCopilotStore.getState().clearDraft());
    expect(useCopilotStore.getState().draft).toBe('');
  });

  it('setError() updates lastError', () => {
    act(() => useCopilotStore.getState().setError('boom'));
    expect(useCopilotStore.getState().lastError).toBe('boom');
    act(() => useCopilotStore.getState().setError(null));
    expect(useCopilotStore.getState().lastError).toBeNull();
  });

  it('dismissFirstRun() persists to localStorage and updates the flag', () => {
    expect(useCopilotStore.getState().firstRunDismissed).toBe(false);
    act(() => useCopilotStore.getState().dismissFirstRun());
    expect(useCopilotStore.getState().firstRunDismissed).toBe(true);
    expect(
      window.localStorage.getItem('forge.copilot.firstRunDismissed'),
    ).toBe('1');
  });
});