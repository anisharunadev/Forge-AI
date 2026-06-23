/**
 * Vitest render tests for the AI-native panels (Phase 0.5-06):
 * TokenStream, ToolCallCard, AgentTraceTimeline.
 */

import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  TokenStream,
  ToolCallCard,
  AgentTraceTimeline,
} from '@/components/ai-native';
import type { AgentTraceStep } from '@/components/ai-native';

describe('TokenStream', () => {
  it('renders streaming text + caret + stop button; clicking Stop fires onStop', () => {
    const onStop = vi.fn();
    render(
      <TokenStream text="partial completion…" isStreaming onStop={onStop} />,
    );
    const stream = screen.getByTestId('token-stream');
    expect(stream.getAttribute('data-streaming')).toBe('true');
    expect(screen.getByTestId('token-stream-caret')).toBeTruthy();
    expect(screen.getByTestId('token-stream-body').textContent).toContain(
      'partial completion…',
    );
    const stop = screen.getByTestId('token-stream-stop');
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('does NOT render the caret when not streaming', () => {
    render(<TokenStream text="done" isStreaming={false} />);
    expect(screen.queryByTestId('token-stream-caret')).toBeNull();
    expect(screen.queryByTestId('token-stream-stop')).toBeNull();
  });

  it('does not render stop button when onStop is missing', () => {
    render(<TokenStream text="streaming" isStreaming />);
    expect(screen.getByTestId('token-stream-caret')).toBeTruthy();
    expect(screen.queryByTestId('token-stream-stop')).toBeNull();
  });
});

describe('ToolCallCard', () => {
  it('renders the tool name, JSON args, and status pill for a running call', () => {
    render(
      <ToolCallCard
        tool="jira.create_issue"
        status="running"
        args={{ project: 'FORGE', summary: 'Add typed-artifact route' }}
      />,
    );
    const card = screen.getByTestId('tool-call-card');
    expect(card.getAttribute('data-tool')).toBe('jira.create_issue');
    expect(card.getAttribute('data-status')).toBe('running');
    expect(card.textContent).toContain('jira.create_issue');
    expect(card.textContent).toContain('Running');
    const args = screen.getByTestId('tool-call-args');
    expect(args.textContent).toContain('FORGE');
    expect(args.textContent).toContain('typed-artifact route');
    // No result yet
    expect(screen.queryByTestId('tool-call-result')).toBeNull();
  });

  it('renders a result preview when provided', () => {
    render(
      <ToolCallCard
        tool="github.create_pr"
        status="success"
        args={{ branch: 'forge/kg-typed' }}
        result="https://github.com/acme/forge/pull/42"
        durationMs={842}
      />,
    );
    const card = screen.getByTestId('tool-call-card');
    expect(card.getAttribute('data-status')).toBe('success');
    expect(card.textContent).toContain('Success');
    expect(screen.getByTestId('tool-call-result').textContent).toContain(
      'github.com/acme/forge/pull/42',
    );
    expect(card.textContent).toContain('842ms');
  });

  it('renders failed status with destructive tone', () => {
    render(
      <ToolCallCard
        tool="aws.deploy"
        status="failed"
        args={{ service: 'forge' }}
      />,
    );
    const card = screen.getByTestId('tool-call-card');
    expect(card.className).toMatch(/ring-destructive/);
    expect(card.textContent).toContain('Failed');
  });
});

describe('AgentTraceTimeline', () => {
  const steps: ReadonlyArray<AgentTraceStep> = [
    {
      id: 's1',
      label: 'Ingest project',
      agent: 'forge-arch',
      state: 'completed',
      durationMs: 1_200,
      startedAt: '2026-06-22T12:00:00Z',
    },
    {
      id: 's2',
      label: 'Generate tests',
      agent: 'forge-tests',
      state: 'executing',
      durationMs: 4_300,
      startedAt: '2026-06-22T12:00:05Z',
    },
    {
      id: 's3',
      label: 'Request review',
      agent: 'forge-supervisor',
      state: 'thinking',
      startedAt: '2026-06-22T12:00:10Z',
    },
  ];

  it('renders one list item per step in order with the right tone', () => {
    render(<AgentTraceTimeline steps={steps} />);
    const list = screen.getByTestId('agent-trace-timeline');
    expect(list.getAttribute('data-steps')).toBe('3');
    const items = screen.getAllByTestId('agent-trace-item');
    expect(items).toHaveLength(3);
    const first = items[0];
    const second = items[1];
    const third = items[2];
    if (!first || !second || !third) {
      throw new Error('expected three items');
    }
    expect(first.getAttribute('data-state')).toBe('completed');
    expect(second.getAttribute('data-state')).toBe('executing');
    expect(third.getAttribute('data-state')).toBe('thinking');
    expect(first.textContent).toContain('Ingest project');
    expect(first.textContent).toContain('completed');
    expect(first.textContent).toContain('1.2s');
  });

  it('renders an empty state when steps is empty', () => {
    render(<AgentTraceTimeline steps={[]} />);
    expect(screen.getByTestId('agent-trace-timeline-empty')).toBeTruthy();
  });
});
