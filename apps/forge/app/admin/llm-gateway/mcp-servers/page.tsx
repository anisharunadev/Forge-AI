'use client';

/**
 * /admin/llm-gateway/mcp-servers — LiteLLM MCP server browser.
 *
 * Read-only card grid. Per OQ-34, the LiteLLM admin UI is the
 * surface for managing MCP server config; Forge only renders the
 * read view.
 */

import * as React from 'react';
import { PlugZap } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard, EmptyState } from '@/components/shell';
import { Skeleton } from '@/components/ui/skeleton';

import { useMCPServers } from '@/lib/hooks/useLiteLLM';
import { MCPServerCard } from '@/components/admin/llm-gateway';

export default function MCPServersPage() {
  const q = useMCPServers();
  const servers = q.data ?? [];

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="llm-gateway-mcp"
        data-page-title="LLM Gateway · MCP servers"
      >
        <PageHeader
          eyebrow="LLM Gateway"
          title="MCP servers"
          icon={<PlugZap className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM Model Context Protocol servers reachable from the AI gateway. Read-only — manage configuration in the LiteLLM admin UI."
          breadcrumbs={[
            { label: 'LLM Gateway', href: '/admin/llm-gateway' },
            { label: 'MCP servers' },
          ]}
        />

        {q.isLoading ? (
          <div
            className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            data-testid="mcp-loading"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : servers.length === 0 ? (
          <EmptyState
            icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
            title="No MCP servers registered"
            description="Register MCP servers in the LiteLLM admin UI. Forge will surface them here within one refresh."
            testId="mcp-empty"
          />
        ) : (
          <SectionCard
            title={`${servers.length} server${servers.length === 1 ? '' : 's'}`}
            description="Read-only mirror of the LiteLLM MCP registry."
          >
            <div
              className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
              data-testid="mcp-grid"
            >
              {servers.map((s) => (
                <MCPServerCard key={s.id} server={s} />
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </AdminShell>
  );
}
