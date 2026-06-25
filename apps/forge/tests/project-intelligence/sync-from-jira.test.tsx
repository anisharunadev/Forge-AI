/**
 * Phase 4 — "Sync from Jira" button tests (Pillar 1 / FORA-501).
 *
 * Covers:
 *   - Button is hidden when `jiraIssueKey` is falsy.
 *   - Button is visible when `jiraIssueKey` is set.
 *   - Click → fetch is called with the right URL, method, headers
 *     (Idempotency-Key, content-type), and JSON body
 *     `{ issue_key, target, idea_id? }`.
 *   - On success → a success pill appears with `data-issue-key` set
 *     to the server's `external_key`.
 *   - On error → an error chip with retry appears.
 *
 * The test renders the button in isolation (the parent pages are
 * server components and would require a full router setup). The
 * test contract is the button itself, which is the only thing the
 * pages call.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  SyncFromJiraButton,
  syncFromJiraTestId,
} from '../../components/intelligence/SyncFromJiraButton';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('<SyncFromJiraButton>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT render when jiraIssueKey is falsy', () => {
    const { container } = renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey={null}
        target="story"
        ideaId="story-001"
      />,
    );
    expect(
      container.querySelector('[data-testid="sync-from-jira-story"]'),
    ).toBeNull();
  });

  it('renders the button with the right testid for each target', () => {
    const targets = ['epic', 'story', 'prd'] as const;
    for (const t of targets) {
      const { unmount } = renderWithClient(
        <SyncFromJiraButton
          jiraIssueKey={`FORA-${t.toUpperCase()}-001`}
          target={t}
          ideaId={`${t}-001`}
        />,
      );
      const btn = screen.getByTestId(syncFromJiraTestId(t));
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('data-issue-key')).toBe(
        `FORA-${t.toUpperCase()}-001`,
      );
      expect(btn.getAttribute('data-idea-id')).toBe(`${t}-001`);
      unmount();
    }
  });

  it('click → fetch is called with the right URL/method/body/headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          idea_id: 'story-001',
          external_key: 'FORA-STORY-001',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey="FORA-STORY-001"
        target="story"
        ideaId="story-001"
      />,
    );

    const btn = screen.getByTestId('sync-from-jira-story');
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/v1/connectors/jira/sync');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
    });
    // Idempotency-Key is set on the headers map.
    const headerMap = init.headers as Record<string, string>;
    expect(headerMap['Idempotency-Key']).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      issue_key: 'FORA-STORY-001',
      target: 'story',
      idea_id: 'story-001',
    });
  });

  it('on success → success pill shows data-issue-key="FORA-STORY-001"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          idea_id: 'story-001',
          external_key: 'FORA-STORY-001',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey="FORA-STORY-001"
        target="story"
        ideaId="story-001"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('sync-from-jira-story'));
    });

    await waitFor(() => {
      const success = screen.getByTestId('sync-from-jira-story-success');
      expect(success.getAttribute('data-issue-key')).toBe('FORA-STORY-001');
    });
  });

  it('on error → error chip appears with retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'mcp_unavailable' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey="FORA-STORY-001"
        target="story"
        ideaId="story-001"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('sync-from-jira-story'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-from-jira-story-error')).toBeTruthy();
    });
    expect(
      screen.getByTestId('sync-from-jira-story-error').textContent,
    ).toContain('mcp_unavailable');
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('calls onSynced callback on success with the right shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          idea_id: 'story-001',
          external_key: 'FORA-STORY-001',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const onSynced = vi.fn();
    renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey="FORA-STORY-001"
        target="story"
        ideaId="story-001"
        onSynced={onSynced}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('sync-from-jira-story'));
    });

    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
    expect(onSynced.mock.calls[0]![0]).toEqual({
      issue_key: 'FORA-STORY-001',
      idea_id: 'story-001',
      target: 'story',
    });
  });
});
