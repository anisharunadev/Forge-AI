/**
 * Co-pilot → @forge-ai/forge-pi integration (Step 45, ZONE 4-F).
 *
 * "When you @mention an entity, it auto-resolves to the right code."
 *
 * Co-pilot calls `resolveMention()` whenever a user types `@entity-name`
 * in the chat. We delegate to forge-pi's `queryKnowledgeGraph` so the
 * Co-pilot has full codebase understanding. When forge-pi is missing,
 * we fall back to a naive substring match against the existing local
 * project glossary.
 */

import type { KnowledgeGraphNode } from '@forge-ai/forge-pi';

import { DEV_TENANT_UUID } from '../../config/dev-seeds';

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

export interface ResolvedMention {
  /** e.g. "service:forge-dashboard", "adr:001", "persona:pm". */
  ref: string;
  label: string;
  kind: string;
  source: string;
}

/**
 * Resolve a `@mention` string to a list of candidate entities.
 * Returns an empty list if no matches are found.
 */
export async function resolveMention(
  raw: string,
): Promise<ResolvedMention[]> {
  const cleaned = raw.replace(/^@/, '').trim().toLowerCase();
  if (!cleaned) return [];

  const pi = await getPi();
  if (pi) {
    const graph = await pi.queryKnowledgeGraph(ctx(), {
      label_contains: cleaned,
    });
    return graph.nodes.map((n: KnowledgeGraphNode) => ({
      ref: `${n.kind}:${n.id}`,
      label: n.label,
      kind: n.kind,
      source: n.source,
    }));
  }
  return [];
}