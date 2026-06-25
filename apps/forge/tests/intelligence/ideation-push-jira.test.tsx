/**
 * Forge AI-440 — Phase 1 "Push to Jira" ideation button tests.
 *
 * Covers:
 *   - Button is hidden when idea.status is not pushable (e.g. 'new'
 *     — though 'new' isn't in the IdeaStatus union, we use 'intake'
 *     as the equivalent low-stage state).
 *   - Button is visible when idea.status === 'approved'.
 *   - Click → mutation fires → success pill shows
 *     `data-epic-key="FORA-1234"`.
 *   - Error path: 500 from the API → error badge appears with retry.
 *
 * Fetch is mocked directly (no MSW — vitest in this project relies
 * on `vi.spyOn(globalThis, 'fetch')`). The TanStack Query client is
 * supplied via the inline test wrapper so each test gets a clean
 * mutation cache.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PushIdeaToJiraButton } from '../../components/ideation/PushIdeaToJiraButton';
import type { Idea } from '../../lib/ideation/data';

const newIdea: Idea = {
  id: 'idea-test-001',
  title: 'New idea',
  summary: 'A draft idea',
  status: 'intake',
  score: 6,
  scoreBreakdown: { impact: 5, feasibility: 7, confidence: 6, effort: 4 },
  owner: 'Test PM',
  ownerAvatar: 'TP',
  createdAt: '2026-06-22T00:00:00Z',
  tags: ['test'],
  impact: 'medium',
  analysis: 'Pending',
  risks: [],
};

const approvedIdea: Idea = {
  ...newIdea,
  id: 'idea-test-002',
  status: 'approved',
  title: 'Approved idea',
};

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

describe('<PushIdeaToJiraButton>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT render when idea.status is not pushable (intake)', () => {
    const { container } = renderWithClient(
      <PushIdeaToJiraButton idea={newIdea} />,
    );
    expect(
      container.querySelector('[data-testid="push-idea-to-jira-button"]'),
    ).toBeNull();
  });

  it('renders the button when idea.status === "approved"', () => {
    renderWithClient(<PushIdeaToJiraButton idea={approvedIdea} />);
    const button = screen.getByTestId('push-idea-to-jira-button');
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-idea-id')).toBe(approvedIdea.id);
  });

  it('click → mutation fires → success pill shows data-epic-key="FORA-1234"', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: 'jira',
            success: true,
            external_ref: 'JIRA/FORA-1234',
            error: null,
            record_id: 'rec-001',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    renderWithClient(<PushIdeaToJiraButton idea={approvedIdea} />);
    const button = screen.getByTestId('push-idea-to-jira-button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const call = fetchSpy.mock.calls[0]!;
    const [url, init] = call as [string, RequestInit];
    expect(String(url)).toContain(
      '/v1/ideation/ideas/idea-test-002/push/jira',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ project_key: 'FORA' });

    await waitFor(() => {
      const success = screen.getByTestId('push-idea-to-jira-success');
      expect(success.getAttribute('data-epic-key')).toBe('FORA-1234');
    });
    expect(
      screen.getByTestId('push-idea-to-jira-success').textContent,
    ).toContain('FORA-1234');
  });

  it('error path: 500 → error badge appears with retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'mcp_unavailable' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(<PushIdeaToJiraButton idea={approvedIdea} />);
    const button = screen.getByTestId('push-idea-to-jira-button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByTestId('push-idea-to-jira-error')).toBeTruthy();
    });
    expect(screen.getByTestId('push-idea-to-jira-error').textContent).toContain(
      'mcp_unavailable',
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('calls onPushed callback with the parsed JiraPushResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          target: 'jira',
          success: true,
          external_ref: 'JIRA/FORA-9999',
          error: null,
          record_id: 'rec-002',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const onPushed = vi.fn();
    renderWithClient(
      <PushIdeaToJiraButton idea={approvedIdea} onPushed={onPushed} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('push-idea-to-jira-button'));
    });

    await waitFor(() => {
      expect(onPushed).toHaveBeenCalledTimes(1);
    });
    expect(onPushed.mock.calls[0]![0]).toMatchObject({
      epicKey: 'FORA-9999',
    });
  });
});