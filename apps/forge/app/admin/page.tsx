'use client';

/**
 * /admin — Forge AI Settings page.
 *
 * Closes the 404 reported on the Settings nav entry
 * (`components/shell/nav-config.ts:141`). Wires 8 tabs that mirror
 * the project plan in
 * `/home/arunachalam.v@knackforge.com/.claude/plans/prancy-plotting-sloth.md`:
 *
 *   1. General        — project info (name, slug, branch, visibility)
 *   2. Members        — invite developers, manage roles
 *   3. Agents         — per-agent config (model, temperature, prompt)
 *   4. Providers      — LLM providers (add, rate limits, enable/disable)
 *   5. Env Vars       — per-project secrets (masked values)
 *   6. Integrations   — connector summary + CTA to /connector-center
 *   7. Workflow       — default agent per task type
 *   8. Audit          — settings-scoped audit events
 *
 * Each tab is a self-contained component under
 * `components/admin/settings/`. This page owns only the page-level
 * chrome and the tab switcher.
 */

import * as React from 'react';
import {
  Building2,
  Users,
  Bot,
  KeyRound,
  Eye,
  PlugZap,
  Workflow,
  History,
  Settings as SettingsIcon,
  Cpu,
  Sprout,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader } from '@/components/shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  GeneralTab,
  MembersTab,
  AgentsTab,
  ProvidersTab,
  EnvVarsTab,
  IntegrationsTab,
  WorkflowDefaultsTab,
  AuditTab,
} from '@/components/admin/settings';

export default function AdminSettingsPage() {
  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="admin-settings-page"
        data-page-title="Settings"
      >
        <PageHeader
          eyebrow="Lifecycle"
          title="Settings"
          icon={<SettingsIcon className="h-4 w-4" aria-hidden="true" />}
          description="Configure your project, invite team members, manage agents and LLM providers, and review settings changes in the audit log."
        />

        <Tabs defaultValue="general" className="w-full">
          <TabsList
            aria-label="Settings sections"
            className="flex w-full flex-wrap gap-1"
          >
            <TabsTrigger
              value="general"
              data-testid="tab-general"
              className="flex items-center gap-1.5"
            >
              <Building2 className="h-3 w-3" aria-hidden="true" />
              General
            </TabsTrigger>
            <TabsTrigger
              value="members"
              data-testid="tab-members"
              className="flex items-center gap-1.5"
            >
              <Users className="h-3 w-3" aria-hidden="true" />
              Members
            </TabsTrigger>
            <TabsTrigger
              value="agents"
              data-testid="tab-agents"
              className="flex items-center gap-1.5"
            >
              <Bot className="h-3 w-3" aria-hidden="true" />
              Agents
            </TabsTrigger>
            <TabsTrigger
              value="providers"
              data-testid="tab-providers"
              className="flex items-center gap-1.5"
            >
              <KeyRound className="h-3 w-3" aria-hidden="true" />
              Providers
            </TabsTrigger>
            <TabsTrigger
              value="env-vars"
              data-testid="tab-env-vars"
              className="flex items-center gap-1.5"
            >
              <Eye className="h-3 w-3" aria-hidden="true" />
              Env Vars
            </TabsTrigger>
            <TabsTrigger
              value="integrations"
              data-testid="tab-integrations"
              className="flex items-center gap-1.5"
            >
              <PlugZap className="h-3 w-3" aria-hidden="true" />
              Integrations
            </TabsTrigger>
            <TabsTrigger
              value="workflow"
              data-testid="tab-workflow"
              className="flex items-center gap-1.5"
            >
              <Workflow className="h-3 w-3" aria-hidden="true" />
              Workflow
            </TabsTrigger>
            <TabsTrigger
              value="audit"
              data-testid="tab-audit"
              className="flex items-center gap-1.5"
            >
              <History className="h-3 w-3" aria-hidden="true" />
              Audit
            </TabsTrigger>
            <TabsTrigger
              value="ai-gateway"
              data-testid="tab-ai-gateway"
              className="flex items-center gap-1.5"
            >
              <Cpu className="h-3 w-3" aria-hidden="true" />
              AI Gateway
            </TabsTrigger>
            <TabsTrigger
              value="seeds"
              data-testid="tab-seeds"
              className="flex items-center gap-1.5"
              asChild
            >
              <a href="/admin/seeds">
                <Sprout className="h-3 w-3" aria-hidden="true" />
                Seeds
              </a>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-4 space-y-4">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="members" className="mt-4 space-y-4">
            <MembersTab />
          </TabsContent>
          <TabsContent value="agents" className="mt-4 space-y-4">
            <AgentsTab />
          </TabsContent>
          <TabsContent value="providers" className="mt-4 space-y-4">
            <ProvidersTab />
          </TabsContent>
          <TabsContent value="env-vars" className="mt-4 space-y-4">
            <EnvVarsTab />
          </TabsContent>
          <TabsContent value="integrations" className="mt-4 space-y-4">
            <IntegrationsTab />
          </TabsContent>
          <TabsContent value="workflow" className="mt-4 space-y-4">
            <WorkflowDefaultsTab />
          </TabsContent>
          <TabsContent value="audit" className="mt-4 space-y-4">
            <AuditTab />
          </TabsContent>
          <TabsContent value="ai-gateway" className="mt-4 space-y-4">
            <div className="rounded-md border border-dashed border-border bg-card/40 p-6">
              <p className="text-sm text-muted-foreground">
                Per-tenant LiteLLM configuration, Virtual Key lifecycle, and
                guardrail assignments have moved to a dedicated surface.
              </p>
              <a
                href="/admin/llm-gateway"
                className="mt-2 inline-flex items-center text-sm font-medium text-foreground underline-offset-2 hover:underline"
                data-testid="ai-gateway-cta"
              >
                Open the LLM Gateway admin →
              </a>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
