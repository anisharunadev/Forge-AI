/**
 * Barrel export for the Settings page tab components.
 *
 * Each tab is a self-contained React component that owns its own
 * data fetching (via `useSettings` hooks) and mutation UI. The
 * `app/admin/page.tsx` page composes them inside a single vertical
 * sidebar layout with three grouped sections:
 *
 *   Account     Profile · Sessions · Notifications · API Tokens
 *   Workspace   General · Members · Agents · Providers · Env Vars
 *               · Integrations · Workflow · Audit
 *   Enterprise  AI Gateway · Seeds · Webhooks · Connected Apps
 *               · SSO · Branding · Billing · Feature Flags
 *               · Keyboard
 */

export { GeneralTab } from './GeneralTab';
export { MembersTab } from './MembersTab';
export { InviteMemberDialog } from './InviteMemberDialog';
export { AgentsTab } from './AgentsTab';
export { EditAgentConfigDialog } from './EditAgentConfigDialog';
export { ProvidersTab } from './ProvidersTab';
export { AddProviderDialog } from './AddProviderDialog';
export { EnvVarsTab } from './EnvVarsTab';
export { AddEnvVarDialog } from './AddEnvVarDialog';
export { IntegrationsTab } from './IntegrationsTab';
export { WorkflowDefaultsTab } from './WorkflowDefaultsTab';
export { AuditTab } from './AuditTab';
export { AIGatewayTab } from './AIGatewayTab';
export { SeedsTab } from './SeedsTab';

// Step-47 additions — Account section
export { ProfileTab } from './ProfileTab';
export { SessionsTab } from './SessionsTab';
export { NotificationsTab } from './NotificationsTab';
export { APITokensTab } from './APITokensTab';

// Step-47 additions — Enterprise section
export { WebhooksTab } from './WebhooksTab';
export { ConnectedAppsTab } from './ConnectedAppsTab';
export { SSOTab } from './SSOTab';
export { BrandingTab } from './BrandingTab';
export { BillingTab } from './BillingTab';
export { FeatureFlagsTab } from './FeatureFlagsTab';
export { KeyboardShortcutsTab } from './KeyboardShortcutsTab';

export {
  SettingsSidebar,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionId,
  type SettingsGroup,
  type SettingsGroupId,
} from './SettingsSidebar';
export { SectionShell } from './SectionShell';
export { FloatingLabelInput } from './FloatingLabelInput';
