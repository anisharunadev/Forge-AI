/**
 * F-800 Plan 3 — Co-pilot component tests.
 *
 * Covers the four most behavior-critical UI surfaces from Plan 3:
 *   - `MessageBubble` renders markdown for assistant messages
 *   - `CitationChip` renders an `<a>` with the citation URL
 *   - `FeedbackButtons` dispatches `useSubmitFeedback` on click
 *   - `SuggestedActions` dispatches the right handler for each
 *     `action_type`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('../../hooks/use-copilot-mutations', () => ({
  useSubmitFeedback: vi.fn(),
  useSendMessage: vi.fn(),
  useDeleteConversation: vi.fn(),
}));

vi.mock('../../hooks/use-copilot', () => ({
  useCost: vi.fn(),
  useConversations: vi.fn(),
  useConversation: vi.fn(),
  useTools: vi.fn(),
}));

import { useSubmitFeedback } from '../../hooks/use-copilot-mutations';
import { useCost } from '../../hooks/use-copilot';
import { CitationChip } from '../../components/copilot/CitationChip';
import { FeedbackButtons } from '../../components/copilot/FeedbackButtons';
import { MessageBubble } from '../../components/copilot/MessageBubble';
import { SuggestedActions } from '../../components/copilot/SuggestedActions';
import { CostBadge } from '../../components/copilot/CostBadge';
import type { CopilotSuggestedAction, CopilotCitation, CopilotMessageRead } from '../../lib/api/copilot';

const mockedSubmitFeedback = vi.mocked(useSubmitFeedback);
const mockedUseCost = vi.mocked(useCost);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmitFeedback.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  } as never);
  mockedUseCost.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<CitationChip>', () => {
  it('renders a link with the citation URL', () => {
    const citation: CopilotCitation = {
      type: 'service',
      id: 'svc-1',
      label: 'auth-api',
      snippet: 'Authentication API',
      url: 'https://example.com/services/auth-api',
    };

    render(<CitationChip citation={citation} />, { wrapper: makeWrapper() });

    const link = screen.getByTestId('copilot-citation');
    expect(link.getAttribute('href')).toBe(
      'https://example.com/services/auth-api',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('data-citation-type')).toBe('service');
    expect(link.textContent).toContain('auth-api');
  });
});

describe('<MessageBubble>', () => {
  it('renders markdown for assistant messages', () => {
    const message: CopilotMessageRead = {
      id: 'm-1',
      conversation_id: 'c-1',
      role: 'assistant',
      content: '# Heading\n\nA paragraph with **bold** text.',
      citations: [],
      tool_calls: [],
      suggested_actions: [],
      confidence: 'high',
      feedback_rating: null,
      model: 'test',
      cost_usd: 0,
      tokens_in: 1,
      tokens_out: 1,
      latency_ms: 0,
      created_at: new Date().toISOString(),
    };

    render(<MessageBubble message={message} />, { wrapper: makeWrapper() });

    const root = screen.getByTestId('copilot-message');
    expect(root.getAttribute('data-role')).toBe('assistant');
    // Markdown heading + bold text both render.
    expect(root.querySelector('h1')?.textContent).toBe('Heading');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders plain text for user messages', () => {
    const message: CopilotMessageRead = {
      id: 'm-2',
      conversation_id: 'c-1',
      role: 'user',
      content: 'hi there',
      citations: [],
      tool_calls: [],
      suggested_actions: [],
      confidence: null,
      feedback_rating: null,
      model: null,
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: 0,
      created_at: new Date().toISOString(),
    };

    render(<MessageBubble message={message} />, { wrapper: makeWrapper() });

    const root = screen.getByTestId('copilot-message');
    expect(root.getAttribute('data-role')).toBe('user');
    expect(root.textContent).toContain('hi there');
  });
});

describe('<FeedbackButtons>', () => {
  it('submits thumbs-up feedback on click', () => {
    const mutate = vi.fn();
    mockedSubmitFeedback.mockReturnValue({
      mutate,
      isPending: false,
    } as never);

    render(
      <FeedbackButtons
        messageId="m-1"
        conversationId="c-1"
        currentRating={null}
      />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(screen.getByTestId('copilot-feedback-up'));

    expect(mutate).toHaveBeenCalledWith({
      messageId: 'm-1',
      rating: 'up',
      conversationId: 'c-1',
    });
  });

  it('submits thumbs-down feedback on click', () => {
    const mutate = vi.fn();
    mockedSubmitFeedback.mockReturnValue({
      mutate,
      isPending: false,
    } as never);

    render(
      <FeedbackButtons
        messageId="m-2"
        conversationId="c-1"
        currentRating={null}
      />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(screen.getByTestId('copilot-feedback-down'));

    expect(mutate).toHaveBeenCalledWith({
      messageId: 'm-2',
      rating: 'down',
      conversationId: 'c-1',
    });
  });
});

describe('<SuggestedActions>', () => {
  it('navigates when action_type is "navigate"', () => {
    const actions: CopilotSuggestedAction[] = [
      {
        label: 'Open Architecture',
        action_type: 'navigate',
        payload: { url: '/architecture' },
      },
    ];

    // Mock the router push.
    const push = vi.fn();
    const useRouterSpy = vi
      .spyOn(
        // dynamic require — the real module exports `useRouter`.
        // Tests stub via vi.mock above is not enough; we replace
        // `next/navigation` for this test only.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('next/navigation'),
        'useRouter',
      )
      .mockReturnValue({ push } as never);
    useRouterSpy.mockReturnValue({ push } as never);

    render(<SuggestedActions actions={actions} />, {
      wrapper: makeWrapper(),
    });

    fireEvent.click(screen.getByTestId('copilot-suggested-action'));
    expect(push).toHaveBeenCalledWith('/architecture');
  });

  it('calls onRunCommand for run_command actions', () => {
    const actions: CopilotSuggestedAction[] = [
      {
        label: 'Run forge-execute-phase',
        action_type: 'run_command',
        payload: { command_id: 'forge-execute-phase' },
      },
    ];
    const onRunCommand = vi.fn();
    const onDraft = vi.fn();

    render(
      <SuggestedActions
        actions={actions}
        onRunCommand={onRunCommand}
        onDraft={onDraft}
      />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(screen.getByTestId('copilot-suggested-action'));
    expect(onRunCommand).toHaveBeenCalledWith(actions[0]);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('calls onDraft for draft actions', () => {
    const actions: CopilotSuggestedAction[] = [
      {
        label: 'Save as ADR draft',
        action_type: 'draft',
        payload: { artifact_type: 'adr', title: 'New ADR' },
      },
    ];
    const onRunCommand = vi.fn();
    const onDraft = vi.fn();

    render(
      <SuggestedActions
        actions={actions}
        onRunCommand={onRunCommand}
        onDraft={onDraft}
      />,
      { wrapper: makeWrapper() },
    );

    fireEvent.click(screen.getByTestId('copilot-suggested-action'));
    expect(onDraft).toHaveBeenCalledWith(actions[0]);
    expect(onRunCommand).not.toHaveBeenCalled();
  });
});

describe('<CostBadge>', () => {
  it('renders $0.0000 when cost data is missing', () => {
    mockedUseCost.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as never);

    render(<CostBadge conversationId={null} />, {
      wrapper: makeWrapper(),
    });

    const badge = screen.getByTestId('copilot-cost-badge');
    expect(badge.textContent).toBe('$0.0000');
  });

  it('renders the running cost when present', () => {
    mockedUseCost.mockReturnValue({
      data: {
        conversation_id: 'c-1',
        total_cost_usd: 0.0042,
        total_tokens_in: 10,
        total_tokens_out: 20,
        budget_remaining_usd: 0.9958,
        budget_ceiling_usd: 1.0,
        budget_status: 'active',
      },
      isLoading: false,
      isError: false,
    } as never);

    render(<CostBadge conversationId="c-1" />, { wrapper: makeWrapper() });

    expect(screen.getByTestId('copilot-cost-badge').textContent).toBe(
      '$0.0042',
    );
  });
});