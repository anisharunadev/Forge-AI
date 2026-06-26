/**
 * Market signal processor — surfaces competitor moves and industry trends.
 *
 * Stub pulls from a configured source registry and returns deterministic
 * relevance scores until the real extractor lands.
 */

import type { MarketSignal, TenantScopedContext } from './types';

export interface SignalSource {
  source: string;
  title: string;
  url: string;
  body: string;
}

const SOURCES: SignalSource[] = [
  {
    source: 'dev-to',
    title: 'AI coding agents in 2026',
    url: 'https://dev.to/example/ai-coding-agents-2026',
    body: 'Knowledge graphs are the new moat for AI agents',
  },
  {
    source: 'hn',
    title: 'Show HN: Visual QA agent',
    url: 'https://news.ycombinator.com/item?id=1',
    body: 'A new agent that uses screenshots to test PRs',
  },
];

export async function extractMarketSignals(
  ctx: TenantScopedContext,
): Promise<MarketSignal[]> {
  return SOURCES.map((s, i) => ({
    ...ctx,
    signal_id: `signal_${i}_${ctx.project_id}`,
    source: s.source,
    title: s.title,
    url: s.url,
    relevance: s.body,
    impact: 70 - i * 5,
    captured_at: new Date().toISOString(),
  }));
}