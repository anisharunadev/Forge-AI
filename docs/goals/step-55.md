/goal


Wire the Connector Center to the real backend. Replace all dummy data with real API calls. This phase covers the full Connector Center (7 tabs) + the cross-cutting ConnectorPicker component. Build on Phase 1 (auth) + Phase 2 (React Query setup). The backend has connector_manager, connector_states, connector_ingestion services. Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "multi-step form wizard validation Zod React Hook Form" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "OAuth connection flow redirect callback secure token" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "credentials vault reveal copy rotate expiration reminder" --domain ux-guideline -f markdown


Adopt every rule. Then build:


==========================================================

ZONE 1 — TYPE DEFINITIONS

==========================================================


In src/lib/api/types.ts (new file, central types for all phases):


```typescript

// CONNECTORS

export interface Connector {

  id: string;

  tenant_id: string;

  slug: string;                    // 'github', 'slack', 'jira', etc.

  name: string;

  display_name: string;

  description: string;

  category: 'source-control' | 'project-mgmt' | 'comms' | 'cloud' | 'quality' | 'data' | 'design' | 'monitoring' | 'custom';

  icon: string;                    // lucide icon name

  status: 'connected' | 'disconnected' | 'error' | 'paused' | 'syncing';

  

  // Connection

  auth_type: 'oauth' | 'api-key' | 'pat' | 'webhook' | 'service-account' | 'none';

  config: Record<string, any>;      // type-specific config

  scopes: string[];                 // for OAuth

  

  // Sync

  sync_enabled: boolean;

  sync_interval_minutes: number;

  last_sync_at: string | null;

  last_sync_status: 'ok' | 'error' | 'partial' | null;

  last_sync_records: number;

  

  // Health

  error_count_24h: number;

  success_count_24h: number;

  

  // Metadata

  installed_at: string;

  installed_by: string;

  version: string;

  documentation_url?: string;

}


export interface ConnectorMarketplaceItem {

  slug: string;

  name: string;

  display_name: string;

  description: string;

  category: Connector['category'];

  icon: string;

  auth_type: Connector['auth_type'];

  install_count: number;            // social proof

  rating: number;                   // 0-5

  rating_count: number;

  is_featured: boolean;

  is_official: boolean;             // Forge team vs community

  screenshot_url?: string;

  documentation_url?: string;

  required_scopes: string[];

  capabilities: string[];           // 'pull-issues', 'send-message', etc.

}


export interface ConnectorSyncEvent {

  id: string;

  connector_id: string;

  connector_slug: string;

  event_type: 'sync.started' | 'sync.completed' | 'sync.failed' | 'webhook.received' | 'config.updated' | 'auth.refreshed';

  status: 'ok' | 'error' | 'in-progress';

  records_processed: number;

  duration_ms: number;

  error_message?: string;

  started_at: string;

  completed_at: string | null;

}


export interface ConnectorCredential {

  id: string;

  tenant_id: string;

  connector_id: string;

  name: string;

  type: 'api-key' | 'oauth-token' | 'pat' | 'webhook-secret' | 'service-account';

  scope: 'org' | 'project';

  preview: string;                  // last 4 chars only

  expires_at: string | null;

  last_rotated_at: string;

  last_used_at: string | null;

  rotation_reminder_days: number;

  created_by: string;

  created_at: string;

}


export interface Webhook {

  id: string;

  tenant_id: string;

  name: string;

  direction: 'inbound' | 'outbound';

  url?: string;                     // outbound target

  events: string[];                 // subscribed events

  auth_type: 'none' | 'basic' | 'bearer' | 'hmac' | 'signature';

  status: 'active' | 'paused' | 'failing';

  last_triggered_at: string | null;

  last_delivery_status: 'ok' | 'error' | null;

  success_count_24h: number;

  error_count_24h: number;

  created_at: string;

}


export interface WebhookDelivery {

  id: string;

  webhook_id: string;

  event: string;

  status: 'ok' | 'error' | 'pending';

  response_code: number | null;

  duration_ms: number;

  attempted_at: string;

  payload_preview: string;

}


// Query keys

export const queryKeys = {

  connectors: {

    all: ['connectors'] as const,

    list: (status?: string) => [...queryKeys.connectors.all, 'list', status] as const,

    detail: (id: string) => [...queryKeys.connectors.all, 'detail', id] as const,

    marketplace: (category?: string) => [...queryKeys.connectors.all, 'marketplace', category] as const,

    activity: (filter?: any) => [...queryKeys.connectors.all, 'activity', filter] as const,

    credentials: () => [...queryKeys.connectors.all, 'credentials'] as const,

    webhooks: (direction?: string) => [...queryKeys.connectors.all, 'webhooks', direction] as const,

  },

};
========================================================== ZONE 2 — REACT QUERY HOOKS (connectors)
In src/lib/query/hooks.ts (append to existing file):

typescript

Copy
// CONNECTORS

export function useConnectors(status?: Connector['status']) {

  return useQuery({

    queryKey: queryKeys.connectors.list(status),

    queryFn: () => api.get<Connector[]>(

      status ? `/connectors?status=${status}` : '/connectors'

    ),

    refetchInterval: 30_000,        // poll for status changes

  });

}


export function useConnector(id: string) {

  return useQuery({

    queryKey: queryKeys.connectors.detail(id),

    queryFn: () => api.get<Connector>(`/connectors/${id}`),

    enabled: !!id,

  });

}


export function useInstallConnector() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: { slug: string; config: Record<string, any>; scopes?: string[] }) =>

      api.post<Connector>('/connectors/install', data),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: queryKeys.connectors.all });

      toast.success('Connector installed');

    },

  });

}


export function useOAuthCallback() {

  return useMutation({

    mutationFn: (data: { code: string; state: string; slug: string }) =>

      api.post<{ connector: Connector }>(`/connectors/oauth/callback`, data),

  });

}


export function useDisconnectConnector() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/connectors/${id}/disconnect`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connectors.all }),

  });

}


export function useUpdateConnectorConfig() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, ...data }: Partial<Connector> & { id: string }) =>

      api.patch<Connector>(`/connectors/${id}`, data),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: queryKeys.connectors.all });

      qc.invalidateQueries({ queryKey: queryKeys.connectors.detail(id) });

    },

  });

}


export function useSyncConnector() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<{ job_id: string }>(`/connectors/${id}/sync`),

    onSuccess: () => {

      toast.info('Sync started');

      setTimeout(() => qc.invalidateQueries({ queryKey: queryKeys.connectors.all }), 2000);

    },

  });

}


// MARKETPLACE

export function useMarketplace(category?: string) {

  return useQuery({

    queryKey: queryKeys.connectors.marketplace(category),

    queryFn: () => api.get<ConnectorMarketplaceItem[]>(

      category ? `/connectors/marketplace?category=${category}` : '/connectors/marketplace'

    ),

    staleTime: 5 * 60_000,

  });

}


// ACTIVITY

export function useConnectorActivity(filters?: {

  connector_id?: string;

  event_type?: string;

  since?: string;

}) {

  return useQuery({

    queryKey: queryKeys.connectors.activity(filters),

    queryFn: () => {

      const params = new URLSearchParams();

      if (filters?.connector_id) params.set('connector_id', filters.connector_id);

      if (filters?.event_type) params.set('event_type', filters.event_type);

      if (filters?.since) params.set('since', filters.since);

      return api.get<ConnectorSyncEvent[]>(`/connectors/activity?${params}`);

    },

    refetchInterval: 10_000,        // near-realtime feed

  });

}


// CREDENTIALS (vault)

export function useCredentials() {

  return useQuery({

    queryKey: queryKeys.connectors.credentials(),

    queryFn: () => api.get<ConnectorCredential[]>('/connectors/credentials'),

  });

}


export function useCreateCredential() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<ConnectorCredential> & { secret: string }) =>

      api.post<ConnectorCredential>('/connectors/credentials', data),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: queryKeys.connectors.credentials() });

      toast.success('Credential stored');

    },

  });

}


export function useRevealCredential() {

  return useMutation({

    mutationFn: (id: string) =>

      api.post<{ secret: string; expires_at: string }>(`/connectors/credentials/${id}/reveal`),

  });

}


export function useRotateCredential() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<ConnectorCredential>(`/connectors/credentials/${id}/rotate`),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: queryKeys.connectors.credentials() });

      toast.success('Credential rotated');

    },

  });

}


export function useRevokeCredential() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/connectors/credentials/${id}`),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: queryKeys.connectors.credentials() });

      toast.success('Credential revoked');

    },

  });

}


// WEBHOOKS

export function useWebhooks(direction?: 'inbound' | 'outbound') {

  return useQuery({

    queryKey: queryKeys.connectors.webhooks(direction),

    queryFn: () => api.get<Webhook[]>(

      direction ? `/webhooks?direction=${direction}` : '/webhooks'

    ),

  });

}


export function useCreateWebhook() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: Partial<Webhook>) => api.post<Webhook>('/webhooks', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.connectors.webhooks() }),

  });

}


export function useTestWebhook() {

  return useMutation({

    mutationFn: (id: string) => api.post<{ status: 'ok' | 'error'; response_code: number; message: string }>(`/webhooks/${id}/test`),

  });

}


export function useWebhookDeliveries(webhookId: string) {

  return useQuery({

    queryKey: ['webhooks', webhookId, 'deliveries'],

    queryFn: () => api.get<WebhookDelivery[]>(`/webhooks/${webhookId}/deliveries`),

    enabled: !!webhookId,

  });

}
========================================================== ZONE 3 — OVERVIEW TAB (the dashboard)
In src/components/connectors/overview-tab.tsx:

typescript

Copy
'use client';

import { useConnectors, useMarketplace, useConnectorActivity, useCredentials } from '@/lib/query/hooks';

import { ActivityFeed } from '@/components/shared/activity-feed';

import { KpiTile } from '@/components/shared/kpi-tile';


export function OverviewTab() {

  const { data: connectors, isLoading } = useConnectors();

  const { data: marketplace } = useMarketplace();

  const { data: activity } = useConnectorActivity();

  const { data: credentials } = useCredentials();

  

  // KPIs from real data

  const kpis = useMemo(() => {

    if (!connectors || !credentials) return null;

    return {

      connected: connectors.filter(c => c.status === 'connected').length,

      syncing_today: activity?.filter(a => 

        a.event_type === 'sync.completed' && 

        isToday(a.started_at)

      ).length ?? 0,

      failing: connectors.filter(c => c.status === 'error').length,

      credentials_expiring: credentials.filter(c => 

        c.expires_at && daysUntil(c.expires_at) < 14

      ).length,

    };

  }, [connectors, credentials, activity]);

  

  if (isLoading) return <Spinner />;

  

  return (

    <div>

      {/* KPI strip */}

      <KpiStrip>

        <KpiTile

          label="Connected"

          value={kpis.connected}

          delta={+2}

          icon={Plug}

          color="emerald"

        />

        <KpiTile

          label="Synced today"

          value={kpis.syncing_today}

          icon={RefreshCw}

        />

        <KpiTile

          label="Failing"

          value={kpis.failing}

          icon={AlertTriangle}

          color="rose"

        />

        <KpiTile

          label="Expiring creds"

          value={kpis.credentials_expiring}

          icon={Clock}

          color="amber"

        />

      </KpiStrip>

      

      {/* Activity feed */}

      <Section title="Recent sync activity" link={{ label: 'All activity', to: '?tab=activity' }}>

        <ActivityFeed items={activity?.slice(0, 10) || []} />

      </Section>

      

      {/* Recommended */}

      <Section title="Recommended for you">

        <ConnectorGrid items={marketplace?.filter(m => m.is_featured).slice(0, 4) || []} />

      </Section>

      

      {/* Credentials health */}

      <Section title="Credentials needing attention">

        {kpis.credentials_expiring > 0 ? (

          <CredentialsList items={credentials!.filter(c => c.expires_at && daysUntil(c.expires_at) < 14)} />

        ) : (

          <EmptyHint>All credentials are healthy ✓</EmptyHint>

        )}

      </Section>

    </div>

  );

}
========================================================== ZONE 4 — MARKETPLACE TAB
In src/components/connectors/marketplace-tab.tsx:

typescript

Copy
'use client';

import { useMarketplace, useInstallConnector } from '@/lib/query/hooks';


export function MarketplaceTab() {

  const [category, setCategory] = useState<string>('all');

  const [search, setSearch] = useState('');

  const { data: items, isLoading } = useMarketplace(category === 'all' ? undefined : category);

  const install = useInstallConnector();

  

  const filtered = useMemo(() => {

    if (!items) return [];

    return items.filter(m => 

      !search || m.name.toLowerCase().includes(search.toLowerCase())

    );

  }, [items, search]);

  

  return (

    <div>

      {/* Category chips */}

      <CategoryChips value={category} onChange={setCategory} />

      

      {/* Search */}

      <Input placeholder="Search connectors..." value={search} onChange={e => setSearch(e.target.value)} />

      

      {/* Featured carousel */}

      <FeaturedCarousel items={items?.filter(m => m.is_featured).slice(0, 5) || []} />

      

      {/* All connectors grid */}

      <ConnectorGrid

        items={filtered}

        onInstall={async (item) => {

          if (item.auth_type === 'oauth') {

            // Redirect to OAuth flow

            const state = crypto.randomUUID();

            sessionStorage.setItem('oauth_state', state);

            window.location.href = `/api/v1/connectors/oauth/start?slug=${item.slug}&state=${state}&redirect_uri=${window.location.origin}/connectors/oauth/callback`;

          } else {

            // Show API key dialog

            const config = await promptForConfig(item);

            await install.mutateAsync({ slug: item.slug, config });

          }

        }}

      />

    </div>

  );

}
OAuth callback handler (in src/app/connectors/oauth/callback/page.tsx):

typescript

Copy
'use client';

import { useEffect, useState } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { useOAuthCallback } from '@/lib/query/hooks';


export default function OAuthCallback() {

  const router = useRouter();

  const params = useSearchParams();

  const callback = useOAuthCallback();

  const [error, setError] = useState<string | null>(null);

  

  useEffect(() => {

    handleCallback();

  }, []);

  

  async function handleCallback() {

    const code = params.get('code');

    const state = params.get('state');

    const slug = params.get('slug') || sessionStorage.getItem('oauth_slug');

    const storedState = sessionStorage.getItem('oauth_state');

    

    // CSRF check

    if (state !== storedState) {

      setError('State mismatch — possible CSRF attack');

      return;

    }

    

    if (!code || !slug) {

      setError('Missing code or slug');

      return;

    }

    

    try {

      const res = await callback.mutateAsync({ code, state, slug });

      toast.success(`${res.connector.display_name} connected!`);

      sessionStorage.removeItem('oauth_state');

      sessionStorage.removeItem('oauth_slug');

      router.push('/connectors?tab=connected');

    } catch (err: any) {

      setError(err.message);

    }

  }

  

  if (error) return <ErrorPage message={error} />;

  return <LoadingPage message="Completing OAuth flow..." />;

}
========================================================== ZONE 5 — CONNECTED TAB
In src/components/connectors/connected-tab.tsx:

typescript

Copy
'use client';

import { useConnectors, useSyncConnector, useDisconnectConnector, useUpdateConnectorConfig } from '@/lib/query/hooks';


export function ConnectedTab() {

  const { data: connectors, isLoading } = useConnectors('connected');

  const sync = useSyncConnector();

  const disconnect = useDisconnectConnector();

  const updateConfig = useUpdateConnectorConfig();

  const [configOpen, setConfigOpen] = useState<string | null>(null);

  

  return (

    <div>

      <SectionHeader>

        <h2>Installed connectors</h2>

        <p>Manage your active integrations and their sync settings.</p>

      </SectionHeader>

      

      {connectors?.length === 0 ? (

        <EmptyState

          icon={Plug}

          title="No connectors installed"

          description="Browse the marketplace to find integrations."

          action={{ label: 'Browse marketplace', onClick: () => onTabChange('marketplace') }}

        />

      ) : (

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {connectors?.map(c => (

            <ConnectorCard

              key={c.id}

              connector={c}

              onSync={() => sync.mutate(c.id)}

              onDisconnect={() => {

                if (confirm(`Disconnect ${c.display_name}?`)) {

                  disconnect.mutate(c.id);

                }

              }}

              onConfigure={() => setConfigOpen(c.id)}

            />

          ))}

        </div>

      )}

      

      {configOpen && (

        <ConnectorConfigDialog

          connector={connectors!.find(c => c.id === configOpen)!}

          onClose={() => setConfigOpen(null)}

          onSave={async (data) => {

            await updateConfig.mutateAsync({ id: configOpen, ...data });

            setConfigOpen(null);

          }}

        />

      )}

    </div>

  );

}
========================================================== ZONE 6 — HEALTH TAB
Same pattern — useConnectorActivity + useConnectors, render real-time health:

typescript

Copy
export function HealthTab() {

  const { data: connectors } = useConnectors();

  const { data: activity } = useConnectorActivity();

  

  const healthKPIs = useMemo(() => {

    if (!connectors) return null;

    return {

      healthy: connectors.filter(c => c.status === 'connected' && c.last_sync_status === 'ok').length,

      syncing: connectors.filter(c => c.status === 'syncing').length,

      stale: connectors.filter(c => {

        if (!c.last_sync_at) return true;

        return hoursSince(c.last_sync_at) > 24;

      }).length,

      failed: connectors.filter(c => c.status === 'error' || c.last_sync_status === 'error').length,

      quarantined: connectors.filter(c => c.status === 'paused').length,

    };

  }, [connectors]);

  

  // Filter pills: All / Healthy / Syncing / Stale / Failed / Quarantined

  // Table: Connector | Status | Last sync | Last success | Last failure | Error rate | Latency | Actions

  // Each row: Re-sync, Quarantine, Pause buttons

  // Click row → connector detail drawer with recent sync log

}
========================================================== ZONE 7 — ACTIVITY TAB
typescript

Copy
export function ActivityTab() {

  const [filters, setFilters] = useState({ connector_id: '', event_type: '', since: '24h' });

  const { data: events, isLoading } = useConnectorActivity(filters);

  

  return (

    <div>

      <FilterBar>

        <Select onChange={v => setFilters(f => ({...f, connector_id: v}))}>

          <option value="">All connectors</option>

          {/* ... */}

        </Select>

        <Select onChange={v => setFilters(f => ({...f, event_type: v}))}>

          <option value="">All events</option>

          <option value="sync.completed">Sync completed</option>

          <option value="sync.failed">Sync failed</option>

          <option value="webhook.received">Webhook received</option>

        </Select>

        <Select onChange={v => setFilters(f => ({...f, since: v}))}>

          <option value="1h">Last hour</option>

          <option value="24h">Last 24h</option>

          <option value="7d">Last 7d</option>

        </Select>

      </FilterBar>

      

      <ActivityFeed items={events || []} virtualized />

    </div>

  );

}
========================================================== ZONE 8 — CREDENTIALS TAB
typescript

Copy
export function CredentialsTab() {

  const { data: credentials } = useCredentials();

  const reveal = useRevealCredential();

  const rotate = useRotateCredential();

  const revoke = useRevokeCredential();

  const [revealing, setRevealing] = useState<string | null>(null);

  const [revealedSecret, setRevealedSecret] = useState<{ id: string; secret: string } | null>(null);

  

  async function handleReveal(id: string) {

    setRevealing(id);

    try {

      const res = await reveal.mutateAsync(id);

      setRevealedSecret({ id, secret: res.secret });

      // Auto-hide after 30s

      setTimeout(() => setRevealedSecret(null), 30_000);

    } finally {

      setRevealing(null);

    }

  }

  

  return (

    <div>

      <SectionHeader>

        <h2>Credentials vault</h2>

        <p>API keys, OAuth tokens, and secrets. Rotate regularly. Reveal actions are audited.</p>

      </SectionHeader>

      

      <CredentialsList

        credentials={credentials || []}

        onReveal={handleReveal}

        onRotate={(id) => {

          if (confirm('Rotate this credential? Workflows using it will need re-auth.')) {

            rotate.mutate(id);

          }

        }}

        onRevoke={(id) => {

          if (confirm('Revoke this credential? Cannot be undone.')) {

            revoke.mutate(id);

          }

        }}

        revealedSecret={revealedSecret}

        revealing={revealing}

      />

    </div>

  );

}
========================================================== ZONE 9 — WEBHOOKS TAB
typescript

Copy
export function WebhooksTab() {

  const [direction, setDirection] = useState<'inbound' | 'outbound'>('outbound');

  const { data: webhooks } = useWebhooks(direction);

  const create = useCreateWebhook();

  const test = useTestWebhook();

  const [createOpen, setCreateOpen] = useState(false);

  

  return (

    <div>

      <SegmentedControl

        value={direction}

        onChange={setDirection}

        options={[

          { value: 'outbound', label: 'Outbound (Forge → external)' },

          { value: 'inbound', label: 'Inbound (external → Forge)' },

        ]}

      />

      

      <Button onClick={() => setCreateOpen(true)}>New webhook</Button>

      

      <WebhooksList

        webhooks={webhooks || []}

        direction={direction}

        onTest={(id) => test.mutateAsync(id).then(res =>

          toast[res.status === 'ok' ? 'success' : 'error'](res.message)

        )}

      />

      

      {createOpen && (

        <CreateWebhookDialog

          direction={direction}

          onClose={() => setCreateOpen(false)}

          onSubmit={async (data) => {

            await create.mutateAsync(data);

            setCreateOpen(false);

          }}

        />

      )}

    </div>

  );

}
========================================================== ZONE 10 — CROSS-CUTTING CONNECTORPICKER (Rule 12)
The ConnectorPicker is a SHARED component that can be used anywhere in the app — Ideation Sources, Workflow nodes, Co-pilot context, etc.

In src/components/connectors/connector-picker.tsx:

typescript

Copy
'use client';

import { useState } from 'react';

import { useMarketplace, useConnectors } from '@/lib/query/hooks';


export interface ConnectorPickerProps {

  // What kind of action this connector performs

  capability?: string;  // 'pull-issues', 'send-message', 'query-database', etc.

  

  // What kind of connectors to show

  category?: 'source-control' | 'project-mgmt' | 'comms' | 'data' | 'any';

  

  // Only show installed (vs. allow install in-flow)

  installedOnly?: boolean;

  

  // Pre-selected connector

  value?: string;

  onChange: (connectorId: string | null) => void;

  

  // Allow deselect

  allowClear?: boolean;

  

  // Custom rendering

  renderTrigger?: (props: { open: () => void; value: string | null }) => React.ReactNode;

}


export function ConnectorPicker({

  capability,

  category = 'any',

  installedOnly = true,

  value,

  onChange,

  allowClear = true,

  renderTrigger,

}: ConnectorPickerProps) {

  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState('');

  const { data: installed } = useConnectors('connected');

  const { data: marketplace } = useMarketplace();

  

  // Filter by capability + category + search

  const options = useMemo(() => {

    let pool = installedOnly ? (installed || []) : (marketplace || []);

    

    if (capability) {

      pool = pool.filter((c: any) => 

        c.capabilities?.includes(capability) || c.required_scopes?.includes(capability)

      );

    }

    if (category !== 'any') {

      pool = pool.filter((c: any) => c.category === category);

    }

    if (search) {

      pool = pool.filter((c: any) => 

        c.name.toLowerCase().includes(search.toLowerCase()) ||

        c.display_name.toLowerCase().includes(search.toLowerCase())

      );

    }

    

    return pool;

  }, [installed, marketplace, capability, category, search, installedOnly]);

  

  const selected = (installed || []).find((c: any) => c.id === value);

  

  if (renderTrigger) {

    return (

      <>

        {renderTrigger({ open: () => setOpen(true), value: value || null })}

        <Dialog open={open} onOpenChange={setOpen}>

          <ConnectorPickerContent

            options={options}

            value={value}

            onChange={onChange}

            onClose={() => setOpen(false)}

            search={search}

            onSearchChange={setSearch}

            installedOnly={installedOnly}

            allowClear={allowClear}

          />

        </Dialog>

      </>

    );

  }

  

  return (

    <Popover open={open} onOpenChange={setOpen}>

      <PopoverTrigger asChild>

        <Button variant="outline" className="w-full justify-between">

          {selected ? (

            <>

              <ConnectorIcon slug={selected.slug} />

              <span>{selected.display_name}</span>

            </>

          ) : (

            <>

              <Plug className="w-4 h-4" />

              <span>Select connector...</span>

            </>

          )}

          <ChevronDown className="w-4 h-4" />

        </Button>

      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="start">

        <ConnectorPickerContent

          options={options}

          value={value}

          onChange={onChange}

          onClose={() => setOpen(false)}

          search={search}

          onSearchChange={setSearch}

          installedOnly={installedOnly}

          allowClear={allowClear}

        />

      </PopoverContent>

    </Popover>

  );

}
USE THE CONNECTORPICKER IN:

typescript

Copy
// In Ideation Sources tab (Step 28)

<ConnectorPicker

  capability="pull-issues"

  onChange={(id) => setSourceConnectorId(id)}

/>


// In Workflow node config (Step 22)

<ConnectorPicker

  category="comms"

  onChange={(id) => updateNodeConfig({ connector_id: id })}

/>


// In Co-pilot context (Step 24)

<ConnectorPicker

  installedOnly

  onChange={(id) => addContext({ type: 'connector', id })}

/>
========================================================== ZONE 11 — REMOVE DUMMY DATA
bash

Copy
grep -r "dummyConnectors\|mockMarketplace\|sampleWebhooks" apps/forge/

grep -r "Jira.*github\.com.*1234\|Acme.*api_key_abc" apps/forge/  # your fake creds
Remove all hardcoded connector data.

========================================================== ZONE 12 — BACKEND ENDPOINTS (verify they exist)
python

Copy
# backend/app/api/v1/connectors.py

@router.get("/connectors")

@router.get("/connectors/marketplace")

@router.post("/connectors/install")

@router.post("/connectors/oauth/start")

@router.get("/connectors/oauth/callback")  # OR handled by /api/v1/connectors/oauth/callback

@router.post("/connectors/oauth/callback")

@router.get("/connectors/{id}")

@router.patch("/connectors/{id}")

@router.delete("/connectors/{id}")

@router.post("/connectors/{id}/disconnect")

@router.post("/connectors/{id}/sync")

@router.get("/connectors/activity")

@router.get("/connectors/credentials")

@router.post("/connectors/credentials")

@router.post("/connectors/credentials/{id}/reveal")

@router.post("/connectors/credentials/{id}/rotate")

@router.delete("/connectors/credentials/{id}")

@router.get("/webhooks")

@router.post("/webhooks")

@router.get("/webhooks/{id}/deliveries")

@router.post("/webhooks/{id}/test")
All endpoints use tenant_id from JWT (Rule 2).

========================================================== CONSTRAINTS
OAuth flow must include CSRF protection (state parameter validation)
Secrets are NEVER returned in plain text from list endpoints
Reveal action requires a fresh API call (not cached)
Reveal auto-expires after 30s
All rotation/revoke actions have confirmation dialogs
Use Phase 2's React Query setup + auth (Phase 1)
Don't break existing UI design (Step 31)
Real-time updates via polling (10s for activity, 30s for connectors)
All endpoints are tenant-scoped
========================================================== DELIVERABLE
files modified, new files in src/components/connectors/ + src/lib/query/
7 tabs wired to real API (Overview, Connected, Marketplace, Health, Activity, Credentials, Webhooks)
OAuth flow working end-to-end (start → callback → connected)
Credentials vault with reveal/rotate/revoke
Webhooks manager with create/test/deliveries
Cross-cutting ConnectorPicker component (used in Ideation, Workflows, Co-pilot)
All dummy data removed
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the page layout, keep the tab structure, keep the visual design
Test: install a connector via marketplace → appears in Connected tab
Test: OAuth flow (Jira/GitHub) → returns to app with connector connected
Test: trigger a manual sync → activity feed shows new event within 10s
Test: reveal a credential → secret shown for 30s, then auto-hides
Test: rotate a credential → new value, old value invalidated
Test: ConnectorPicker used in Ideation Sources → only shows "pull-issues" capable connectors