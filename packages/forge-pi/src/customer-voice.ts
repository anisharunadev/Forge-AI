/**
 * Customer voice clustering — auto-groups Zendesk / Jira Service Desk
 * tickets by theme.
 *
 * Stub groups tickets by simple keyword overlap until the real clustering
 * service lands. The shape of `CustomerCluster` matches the backend
 * payload verbatim.
 */

import type { CustomerCluster, TenantScopedContext } from './types';

export interface VoiceTicket {
  ticket_id: string;
  body: string;
  severity: number;
}

const THEME_KEYWORDS: Record<string, string[]> = {
  auth: ['login', 'sso', 'okta', 'session', 'mfa'],
  performance: ['slow', 'latency', 'p95', 'timeout'],
  'knowledge-graph': ['graph', 'node', 'edge', 'knowledge'],
  ideation: ['idea', 'feature', 'request'],
};

export async function clusterCustomerVoice(
  ctx: TenantScopedContext,
  tickets: VoiceTicket[],
): Promise<CustomerCluster[]> {
  const clusters = new Map<string, CustomerCluster>();

  for (const ticket of tickets) {
    const body = ticket.body.toLowerCase();
    const matchedThemes = Object.entries(THEME_KEYWORDS)
      .filter(([, keywords]) => keywords.some((k) => body.includes(k)))
      .map(([theme]) => theme);

    for (const theme of matchedThemes.length === 0 ? ['uncategorized'] : matchedThemes) {
      const existing = clusters.get(theme);
      if (existing) {
        existing.ticket_ids.push(ticket.ticket_id);
        existing.severity = Math.max(existing.severity, ticket.severity);
      } else {
        clusters.set(theme, {
          ...ctx,
          cluster_id: `cluster_${theme}_${ctx.project_id}`,
          theme,
          ticket_ids: [ticket.ticket_id],
          summary: `Tickets mentioning ${theme.replace('-', ' ')}`,
          severity: ticket.severity,
          related_services: [],
        });
      }
    }
  }

  return Array.from(clusters.values());
}