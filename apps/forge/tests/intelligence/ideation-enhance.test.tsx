/**
 * Forge AI-440 / Pillar 1 Phase 2 — Idea Enhance dialog tests.
 *
 * Covers `<IdeaEnhanceDialog>` + `useIdeaEnhance` end-to-end:
 *
 *   - Dialog renders the textarea + submit button.
 *   - Submit empty note → button is disabled.
 *   - Submit valid note → fetch called with
 *     `POST /v1/ideation/ideas/{id}/enhance`
 *     body `{ editor_note }` + `Idempotency-Key`.
 *   - On 200 → success card appears with the new summary.
 *   - On error → dialog stays open with retry button.
 *
 * Fetch is mocked with `vi.spyOn(globalThis, 'fetch')` per the
 * project convention (`ideation-push-jira.test.tsx`). TanStack Query
 * is supplied via the inline test wrapper so each test gets a clean
 * mutation cache.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { IdeaEnhanceDialog } from '../../components/ideation/IdeaEnhanceDialog';
import { useIdeaEnhance } from '../../lib/hooks/useIdeaEnhance';
import type { Idea } from '../../lib/ideation/data';

const sampleIdea: Idea = {
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

describe('<IdeaEnhanceDialog>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the textarea + submit button when open', () => {
    renderWithClient(
      <IdeaEnhanceDialog idea={sampleIdea} open onOpenChange={() => {}} />,
    );
    expect(screen.getByTestId('idea-enhance-dialog')).toBeTruthy();
    expect(screen.getByTestId('idea-enhance-textarea')).toBeTruthy();
    expect(screen.getByTestId('idea-enhance-submit')).toBeTruthy();
  });

  it('submit is disabled when the editor note is empty (or whitespace only)', () => {
    renderWithClient(
      <IdeaEnhanceDialog idea={sampleIdea} open onOpenChange={() => {}} />,
    );
    const submit = screen.getByTestId('idea-enhance-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('idea-enhance-textarea'), {
      target: { value: '   ' },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('idea-enhance-textarea'), {
      target: { value: 'focus on onboarding friction' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('submit valid note → fetch called with right body → success card appears', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'analysis-001',
          idea_id: 'idea-test-001',
          summary: 'Re-analyzed summary',
          problem_statement: 'Problem statement',
          target_users: ['PMs'],
          success_metrics: ['activation'],
          assumptions: [],
          risks: ['risk one'],
          related_artifacts: [],
          model_used: 'claude-opus-4-7',
          cost_usd: 0.04,
          analyzed_at: '2026-06-22T00:01:00Z',
          editor_note: 'focus on onboarding friction',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(
      <IdeaEnhanceDialog idea={sampleIdea} open onOpenChange={() => {}} />,
    );

    fireEvent.change(screen.getByTestId('idea-enhance-textarea'), {
      target: { value: 'focus on onboarding friction' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('idea-enhance-submit'));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain(
      '/v1/ideation/ideas/idea-test-001/enhance',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ editor_note: 'focus on onboarding friction' });

    await waitFor(() => {
      expect(screen.getByTestId('idea-enhance-success')).toBeTruthy();
    });
    expect(
      screen.getByTestId('idea-enhance-success').textContent,
    ).toContain('Re-analyzed summary');
    expect(
      screen.getByTestId('idea-enhance-success').textContent,
    ).toContain('focus on onboarding friction');
  });

  it('error path → dialog stays open with retry button', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'budget_exhausted' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithClient(
      <IdeaEnhanceDialog idea={sampleIdea} open onOpenChange={() => {}} />,
    );

    fireEvent.change(screen.getByTestId('idea-enhance-textarea'), {
      target: { value: 'something meaningful' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('idea-enhance-submit'));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('idea-enhance-error')).toBeTruthy();
    });
    expect(screen.getByTestId('idea-enhance-error').textContent).toContain(
      'budget_exhausted',
    );
    const retry = screen.getByTestId('idea-enhance-retry');
    expect(retry).toBeTruthy();
    // Dialog stays open — submit button is still in the tree.
    expect(screen.getByTestId('idea-enhance-submit')).toBeTruthy();
  });

  it('does NOT post when dialog is closed (ideaId gated to empty string)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    function Harness(): React.ReactElement {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button
            type="button"
            data-testid="close-dialog"
            onClick={() => setOpen(false)}
          >
            close
          </button>
          <IdeaEnhanceDialog
            idea={sampleIdea}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }

    renderWithClient(<Harness />);

    // Type a note so the submit button is enabled, then close the
    // dialog before clicking submit. The mutation should be gated
    // and not fire a request.
    fireEvent.change(screen.getByTestId('idea-enhance-textarea'), {
      target: { value: 'some note' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-dialog'));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useIdeaEnhance hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mutation posts to the enhance endpoint with snake_case body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'analysis-001',
          idea_id: 'idea-test-002',
          summary: 'ok',
          problem_statement: '',
          target_users: [],
          success_metrics: [],
          assumptions: [],
          risks: [],
          related_artifacts: [],
          model_used: null,
          cost_usd: 0,
          analyzed_at: '2026-06-22T00:01:00Z',
          editor_note: 'focus',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    function Probe(): React.ReactElement {
      const mutation = useIdeaEnhance('idea-test-002');
      React.useEffect(() => {
        mutation.mutate({ editorNote: 'focus' });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <span data-testid="probe-status">{mutation.status}</span>;
    }

    renderWithClient(<Probe />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain('/v1/ideation/ideas/idea-test-002/enhance');
    expect(JSON.parse(String(init.body))).toEqual({ editor_note: 'focus' });
  });
});
