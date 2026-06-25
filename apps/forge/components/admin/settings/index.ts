/**
 * Barrel export for the Settings page tab components.
 *
 * Each tab is a self-contained React component that owns its own
 * data fetching (via `useSettings` hooks) and mutation UI. The
 * `app/admin/page.tsx` page composes them inside a single `<Tabs>`
 * container; nothing else in the app imports from this barrel
 * directly.
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
