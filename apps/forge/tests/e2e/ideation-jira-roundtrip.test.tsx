/**
 * Phase 4 e2e — Ideation ↔ Jira round-trip (Pillar 1 / FORA-440).
 *
 * This is a coarse browser-level simulation: it exercises the
 *   Push-to-Jira → see the epicKey → Sync-from-Jira
 * flow in two client components, asserting the fetch URLs/methods/
 * bodies at each step. The pages themselves are server components;
 * the buttons are the public contract, so we exercise them
 * directly.
 *
 * Phases covered end-to-end:
 *   1. Phase 1: <PushIdeaToJiraButton> posts the push call and
 *      renders `data-epic-key="FORA-1234"` on success.
 *   2. Phase 4: <SyncFromJiraButton> posts the sync call and
 *      renders `data-issue-key="FORA-1234"` on success — the
 *      "round-trip" closure.
 *
 * The test mocks `globalThis.fetch` (vitest pattern) and tracks all
 * calls so the assertion can pin every URL and method.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PushIdeaToJiraButton } from '../../components/ideation/PushIdeaToJiraButton';
import {
  SyncFromJiraButton,
  syncFromJiraTestId,
} from '../../components/intelligence/SyncFromJiraButton';
import type { Idea } from '../../lib/ideation/data';

const approvedIdea: Idea = {
  id: 'idea-roundtrip-001',
  title: 'Round-trip idea',
  summary: 'A push + sync round trip',
  status: 'approved',
  score: 8,
  scoreBreakdown: { impact: 8, feasibility: 8, confidence: 8, effort: 5 },
  owner: 'Test PM',
  ownerAvatar: 'TP',
  createdAt: '2026-06-22T00:00:00Z',
  tags: ['roundtrip'],
  impact: 'high',
  analysis: 'Pending',
  risks: [],
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

describe('Ideation ↔ Jira round-trip (e2e)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Push to Jira → Sync from Jira → both pills show the same key', async () => {
    // Mock BOTH endpoints in a single spy.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // 1st: push idea → Jira
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: 'jira',
            success: true,
            external_ref: 'JIRA/FORA-1234',
            error: null,
            record_id: 'rec-roundtrip-001',
            pushed_at: '2026-06-22T00:00:00Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // 2nd: sync from Jira
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            idea_id: 'epic-roundtrip-001',
            external_key: 'FORA-1234',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    // Render BOTH buttons in the same tree — this mirrors the real
    // round-trip where the operator sees the push receipt and
    // immediately triggers a sync.
    renderWithClient(
      <div>
        <PushIdeaToJiraButton idea={approvedIdea} />
        <SyncFromJiraButton
          jiraIssueKey="FORA-1234"
          target="epic"
          ideaId="epic-roundtrip-001"
        />
      </div>,
    );

    // -- 1. Push to Jira --
    const pushBtn = screen.getByTestId('push-idea-to-jira-button');
    await act(async () => {
      fireEvent.click(pushBtn);
    });

    await waitFor(() => {
      const receipt = screen.getByTestId('push-idea-to-jira-success');
      expect(receipt.getAttribute('data-epic-key')).toBe('FORA-1234');
    });

    // -- 2. Sync from Jira (the same FORA-1234 we just pushed) --
    const syncBtn = screen.getByTestId(syncFromJiraTestId('epic'));
    await act(async () => {
      fireEvent.click(syncBtn);
    });

    await waitFor(() => {
      const pill = screen.getByTestId('sync-from-jira-epic-success');
      expect(pill.getAttribute('data-issue-key')).toBe('FORA-1234');
    });

    // -- 3. Verify both fetch calls were made with the right shape --
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Push call (1st)
    const [pushUrl, pushInit] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(pushUrl)).toContain(
      '/v1/ideation/ideas/idea-roundtrip-001/push/jira',
    );
    expect(pushInit.method).toBe('POST');
    expect(JSON.parse(String(pushInit.body))).toEqual({ project_key: 'FORA' });

    // Sync call (2nd)
    const [syncUrl, syncInit] = fetchSpy.mock.calls[1]! as [string, RequestInit];
    expect(String(syncUrl)).toContain('/v1/connectors/jira/sync');
    expect(syncInit.method).toBe('POST');
    expect(JSON.parse(String(syncInit.body))).toEqual({
      issue_key: 'FORA-1234',
      target: 'epic',
      idea_id: 'epic-roundtrip-001',
    });

    // -- 4. Both pills agree on FORA-1234 (the round-trip closure) --
    const pushPill = screen.getByTestId('push-idea-to-jira-success');
    const syncPill = screen.getByTestId('sync-from-jira-epic-success');
    expect(pushPill.getAttribute('data-epic-key')).toBe('FORA-1234');
    expect(syncPill.getAttribute('data-issue-key')).toBe('FORA-1234');
  });

  it('Sync-from-Jira alone: status update round-trips on the wire', async () => {
    // The Phase 4 "Sync from Jira" alone (no prior push) — this is
    // what the project-intelligence pages exercise. The button
    // posts the same sync call and renders the updated issue key.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            idea_id: 'story-rt-002',
            external_key: 'FORA-1234',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    renderWithClient(
      <SyncFromJiraButton
        jiraIssueKey="FORA-1234"
        target="story"
        ideaId="story-rt-002"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('sync-from-jira-story'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-from-jira-story-success')).toBeTruthy();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/v1/connectors/jira/sync');
    expect(JSON.parse(String(init.body))).toEqual({
      issue_key: 'FORA-1234',
      target: 'story',
      idea_id: 'story-rt-002',
    });
  });
});
