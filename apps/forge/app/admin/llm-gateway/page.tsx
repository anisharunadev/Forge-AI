/**
 * /admin/llm-gateway — LLM Gateway hub page.
 *
 * The Steward's landing page for the F-829 integration layer. Three
 * cards link to the three deep surfaces:
 *   - Tenants   (per-tenant config, virtual keys, guardrails)
 *   - MCP       (LiteLLM MCP server browser, read-only)
 *   - Health    (LiteLLM availability dashboard)
 *
 * The page is a Server Component — the cards are static and the
 * `LLMUnavailableBanner` lives at the app root so the per-page
 * banner status is uniform.
 */

import Link from 'next/link';
import { Building2, PlugZap, Activity, ArrowRight } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard, StatusPill } from '@/components/shell';

export const metadata = {
  title: 'LLM Gateway — Forge AI',
  description:
    'Per-tenant LLM configuration, LiteLLM virtual keys, guardrails, MCP servers, and gateway health.',
};

interface HubCard {
  readonly href: string;
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly ctaLabel: string;
}

const HUB_CARDS: ReadonlyArray<HubCard> = [
  {
    href: '/admin/llm-gateway/tenants',
    title: 'Tenants',
    description:
      'Per-tenant LLM config: model assignment, budget, guardrails, and Virtual Key lifecycle.',
    icon: <Building2 className="h-5 w-5" aria-hidden="true" />,
    ctaLabel: 'Open tenants',
  },
  {
    href: '/admin/llm-gateway/mcp-servers',
    title: 'MCP servers',
    description:
      'Browse the LiteLLM Model Context Protocol servers reachable from the AI gateway. Read-only.',
    icon: <PlugZap className="h-5 w-5" aria-hidden="true" />,
    ctaLabel: 'Browse servers',
  },
  {
    href: '/admin/llm-gateway/health',
    title: 'Health',
    description:
      'LiteLLM availability dashboard. Cached snapshot from the background health monitor.',
    icon: <Activity className="h-5 w-5" aria-hidden="true" />,
    ctaLabel: 'View health',
  },
];

export default function LLMGatewayHubPage() {
  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="llm-gateway-hub"
        data-page-title="LLM Gateway"
      >
        <PageHeader
          eyebrow="Admin"
          title="LLM Gateway"
          icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM is the AI gateway for every LLM call Forge makes. Use this surface to configure per-tenant keys, budgets, guardrails, and the available MCP servers."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {HUB_CARDS.map((card) => (
            <SectionCard
              key={card.href}
              testId={`llm-gateway-card-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
              title={card.title}
              description={card.description}
              headerRight={
                <StatusPill tone="info" label="F-829" size="sm" />
              }
            >
              <div className="flex items-center justify-between gap-3 pt-1">
                <span
                  aria-hidden="true"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-foreground"
                >
                  {card.icon}
                </span>
                <Link
                  href={card.href}
                  className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  data-testid={`llm-gateway-link-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {card.ctaLabel}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </SectionCard>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
