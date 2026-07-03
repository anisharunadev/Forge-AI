'use client';

/**
 * /admin — Forge AI Settings page (Step-47 expansion).
 *
 * Layout: 240px sticky vertical sidebar (Account / Workspace /
 * Enterprise sections) + flex-1 right panel that swaps in the
 * active tab.
 *
 * Sections (21):
 *   Account    Profile · Sessions · Notifications · API Tokens
 *   Workspace  General · Members · Agents · Providers · Env Vars
 *              · Integrations · Workflow · Audit
 *   Enterprise AI Gateway · Seeds · Webhooks · Connected Apps
 *              · SSO · Branding · Billing · Feature Flags · Keyboard
 *
 * The sidebar uses Framer Motion `layoutId="settings-rail"` so the
 * 2px primary left rail animates between active rows. The page owns
 * no data fetching; each tab is a self-contained client component
 * that hydrates its own slice of state (or uses localStorage-backed
 * mock data for the new sections).
 *
 * Route preserved at /admin per "Keep route".
 */

import * as React from 'react';

import { ErrorState } from '@/components/error-state';

import {
  GeneralTab,
  MembersTab,
  AgentsTab,
  ProvidersTab,
  EnvVarsTab,
  IntegrationsTab,
  WorkflowDefaultsTab,
  AuditTab,
  AIGatewayTab,
  SeedsTab,
  SettingsSidebar,
  ProfileTab,
  SessionsTab,
  NotificationsTab,
  APITokensTab,
  WebhooksTab,
  ConnectedAppsTab,
  SSOTab,
  BrandingTab,
  BillingTab,
  FeatureFlagsTab,
  KeyboardShortcutsTab,
  type SettingsSectionId,
} from '@/components/admin/settings';

export default function AdminSettingsPage() {
  const [active, setActive] = React.useState<SettingsSectionId>('general');
  const [showError, setShowError] = React.useState(false);

  if (showError) {
    return (
      <div
        className="mx-auto w-full max-w-[1280px] p-8"
        data-testid="admin-settings-page"
        data-page-title="Settings"
      >
        <ErrorState
          title="We couldn't load this project's settings"
          description="The backend endpoint for project info lands with sub-plan A; this tab will populate once it ships."
          onRetry={() => setShowError(false)}
          testId="settings-error"
        />
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-[1280px] space-y-6 p-8"
      data-testid="admin-settings-page"
      data-page-title="Settings"
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <SettingsSidebar
          active={active}
          onChange={setActive}
          lastChange={{ whenLabel: '12m ago', actorName: 'Arun' }}
        />
        <main
          className="min-w-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8"
          data-testid={`settings-panel-${active}`}
        >
          {/* Account */}
          {active === 'profile' ? <ProfileTab /> : null}
          {active === 'sessions' ? <SessionsTab /> : null}
          {active === 'notifications' ? <NotificationsTab /> : null}
          {active === 'api-tokens' ? <APITokensTab /> : null}

          {/* Workspace */}
          {active === 'general' ? <GeneralTab /> : null}
          {active === 'members' ? <MembersTab /> : null}
          {active === 'agents' ? <AgentsTab /> : null}
          {active === 'providers' ? <ProvidersTab /> : null}
          {active === 'env-vars' ? <EnvVarsTab /> : null}
          {active === 'integrations' ? <IntegrationsTab /> : null}
          {active === 'workflow' ? <WorkflowDefaultsTab /> : null}
          {active === 'audit' ? <AuditTab /> : null}

          {/* Enterprise */}
          {active === 'ai-gateway' ? <AIGatewayTab /> : null}
          {active === 'seeds' ? <SeedsTab /> : null}
          {active === 'webhooks' ? <WebhooksTab /> : null}
          {active === 'connected-apps' ? <ConnectedAppsTab /> : null}
          {active === 'sso' ? <SSOTab /> : null}
          {active === 'branding' ? <BrandingTab /> : null}
          {active === 'billing' ? <BillingTab /> : null}
          {active === 'feature-flags' ? <FeatureFlagsTab /> : null}
          {active === 'shortcuts' ? <KeyboardShortcutsTab /> : null}
        </main>
      </div>

      {/* Dev-only escape hatch — mirrors the screenshot scenario */}
      <button
        type="button"
        onClick={() => setShowError(true)}
        className="text-[10px] text-[var(--fg-muted)] underline-offset-2 hover:underline"
        data-testid="settings-error-trigger"
      >
        Simulate backend unreachable
      </button>
    </div>
  );
}
