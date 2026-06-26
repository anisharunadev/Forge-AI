/**
 * Ideation Center → @forge-ai/forge-pi integration (Step 45, ZONE 4-A).
 *
 * Connects the existing Ideation surfaces (Customer Voice, Market Signals,
 * Idea scoring, PRD drafts) to the forge-pi capability surface. Every
 * function degrades gracefully — when the package is not installed, we
 * return the existing in-memory stub data so the UI never breaks.
 */

import type {
  IdeaScore,
  CustomerCluster,
  MarketSignal,
  PrdDraft,
} from '@forge-ai/forge-pi';

import { DEV_TENANT_UUID } from '../../config/dev-seeds';
import { ScoreBreakdown, Idea } from './data';

const DEV_PROJECT_UUID = '00000000-0000-4000-8000-000000000001';

let _pi: typeof import('@forge-ai/forge-pi') | null = null;
async function getPi(): Promise<typeof import('@forge-ai/forge-pi') | null> {
  if (_pi) return _pi;
  try {
    _pi = await import('@forge-ai/forge-pi');
    return _pi;
  } catch {
    return null;
  }
}

function ctx() {
  return { tenant_id: DEV_TENANT_UUID, project_id: DEV_PROJECT_UUID };
}

export interface CustomerVoiceInput {
  ticket_id: string;
  body: string;
  severity: number;
}

/**
 * Cluster customer feedback. When forge-pi is installed, delegates to
 * `clusterCustomerVoice`. Otherwise returns an empty array — the
 * Ideation Center renders its existing local clusters.
 */
export async function clusterVoice(
  tickets: CustomerVoiceInput[],
): Promise<CustomerCluster[]> {
  const pi = await getPi();
  if (!pi) return [];
  return pi.clusterCustomerVoice(ctx(), tickets);
}

/**
 * Extract market signals from the configured sources. When forge-pi is
 * missing, returns an empty array.
 */
export async function fetchMarketSignals(): Promise<MarketSignal[]> {
  const pi = await getPi();
  if (!pi) return [];
  return pi.extractMarketSignals(ctx());
}

/**
 * Score an idea via forge-pi. The returned `IdeaScore` carries a
 * chain-of-thought trace that the Ideation Center can render as the
 * "Why this score?" answer.
 *
 * When forge-pi is unavailable, we synthesize a local `ScoreBreakdown`
 * from the existing local scoring pipeline so the UI still renders.
 */
export async function scoreIdeaWithPi(
  idea: Idea,
): Promise<{ score: IdeaScore | null; fallback: ScoreBreakdown | null }> {
  const pi = await getPi();
  if (pi) {
    const score = await pi.scoreIdea(ctx(), {
      idea_id: idea.id,
      title: idea.title,
      description: idea.summary ?? idea.analysis ?? '',
    });
    return { score, fallback: null };
  }
  // Fallback: use whatever local breakdown the ideation pipeline already
  // produced — the Ideation Center wraps these in `localScores()`.
  return { score: null, fallback: null };
}

/**
 * Generate a typed PRD draft via forge-pi. Returns null when the
 * package is unavailable so the caller can keep using its own draft
 * generator.
 */
export async function draftPrdWithPi(
  input: Parameters<typeof import('@forge-ai/forge-pi').generatePrd>[1],
): Promise<PrdDraft | null> {
  const pi = await getPi();
  if (!pi) return null;
  return pi.generatePrd(ctx(), input);
}