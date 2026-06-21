'use client';

import * as React from 'react';
import {
  BookText,
  LayoutTemplate,
  ShieldCheck,
  Activity,
  Library,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { StandardsBrowser } from '@/components/org-knowledge/StandardsBrowser';
import { StandardsEditor } from '@/components/org-knowledge/StandardsEditor';
import { TemplatesGallery } from '@/components/org-knowledge/TemplatesGallery';
import { PoliciesList } from '@/components/org-knowledge/PoliciesList';
import { PolicyEditor } from '@/components/org-knowledge/PolicyEditor';
import { CreateStandardDialog } from '@/components/org-knowledge/CreateStandardDialog';
import { CreateTemplateDialog } from '@/components/org-knowledge/CreateTemplateDialog';
import { CreatePolicyDialog } from '@/components/org-knowledge/CreatePolicyDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiData } from '@/hooks/use-api-data';
import {
  type Policy,
  type Standard,
  type Template,
} from '@/lib/org-knowledge/data';

export default function OrganizationKnowledgePage() {
  const standardsRes = useApiData<ReadonlyArray<Standard>>('/v1/org-knowledge/standards');
  const templatesRes = useApiData<ReadonlyArray<Template>>('/v1/org-knowledge/templates');
  const policiesRes = useApiData<ReadonlyArray<Policy>>('/v1/org-knowledge/policies');

  const standardsList: ReadonlyArray<Standard> = standardsRes.data ?? [];
  const templatesList: ReadonlyArray<Template> = templatesRes.data ?? [];
  const policiesList: ReadonlyArray<Policy> = policiesRes.data ?? [];

  const [standards, setStandards] = React.useState<ReadonlyArray<Standard>>([]);
  const [policies, setPolicies] = React.useState<ReadonlyArray<Policy>>([]);

  // Seed from API once loaded.
  React.useEffect(() => {
    if (standards.length === 0 && standardsList.length > 0) {
      setStandards(standardsList);
    }
  }, [standardsList, standards.length]);
  React.useEffect(() => {
    if (policies.length === 0 && policiesList.length > 0) {
      setPolicies(policiesList);
    }
  }, [policiesList, policies.length]);

  const [selectedStandardId, setSelectedStandardId] = React.useState<string | undefined>(
    undefined,
  );
  const [selectedPolicyId, setSelectedPolicyId] = React.useState<string | undefined>(
    undefined,
  );

  React.useEffect(() => {
    if (!selectedStandardId && standards[0]) {
      setSelectedStandardId(standards[0].id);
    }
  }, [standards, selectedStandardId]);
  React.useEffect(() => {
    if (!selectedPolicyId && policies[0]) {
      setSelectedPolicyId(policies[0].id);
    }
  }, [policies, selectedPolicyId]);

  const selectedStandard = React.useMemo(
    () => standards.find((s) => s.id === selectedStandardId) ?? null,
    [standards, selectedStandardId],
  );
  const selectedPolicy = React.useMemo(
    () => policies.find((p) => p.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId],
  );

  const handleCreateStandard = (input: {
    title: string;
    category: Standard['category'];
    body: string;
  }) => {
    const next: Standard = {
      id: `std-${Date.now().toString(36)}`,
      title: input.title,
      category: input.category,
      body: input.body,
      status: 'draft',
      owner: 'you@acme.com',
      version: '0.1.0',
      updatedAt: new Date().toISOString(),
    };
    setStandards((curr) => [next, ...curr]);
    setSelectedStandardId(next.id);
    // eslint-disable-next-line no-console
    console.info('[org-knowledge] standard created', next.id);
  };

  const handleSaveStandard = (body: string) => {
    if (!selectedStandard) return;
    setStandards((curr) =>
      curr.map((s) =>
        s.id === selectedStandard.id
          ? { ...s, body, updatedAt: new Date().toISOString() }
          : s,
      ),
    );
  };

  const handleCreatePolicy = (input: {
    title: string;
    effect: Policy['effect'];
    scope: string;
    logic: Record<string, unknown>;
  }) => {
    const next: Policy = {
      id: `pol-${Date.now().toString(36)}`,
      title: input.title,
      effect: input.effect,
      scope: input.scope,
      logic: input.logic,
      enabled: true,
      updatedAt: new Date().toISOString(),
      owner: 'you@acme.com',
    };
    setPolicies((curr) => [next, ...curr]);
    setSelectedPolicyId(next.id);
  };

  const handleSavePolicy = (next: Policy) => {
    setPolicies((curr) =>
      curr.map((p) => (p.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : p)),
    );
  };

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="organization-knowledge"
      >
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Library className="h-5 w-5" aria-hidden="true" />
            Organization Knowledge
          </h1>
          <p className="text-sm text-muted-foreground">
            Org-level standards (F-001), templates (F-002), and policies (F-003).
            These artefacts are shared across all projects in this tenant.
          </p>
        </header>

        <Tabs defaultValue="standards" className="w-full">
          <TabsList aria-label="Organization knowledge sections">
            <TabsTrigger value="standards" data-testid="tab-standards">
              <BookText className="h-3 w-3" aria-hidden="true" />
              Standards
            </TabsTrigger>
            <TabsTrigger value="templates" data-testid="tab-templates">
              <LayoutTemplate className="h-3 w-3" aria-hidden="true" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="policies" data-testid="tab-policies">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Policies
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">
              <Activity className="h-3 w-3" aria-hidden="true" />
              Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="standards" className="space-y-3">
            <div className="flex justify-end">
              <CreateStandardDialog onCreate={handleCreateStandard} />
            </div>
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <StandardsBrowser
                standards={standards}
                selectedId={selectedStandardId}
                onSelect={(s) => setSelectedStandardId(s.id)}
              />
              <StandardsEditor
                standard={selectedStandard}
                onSave={handleSaveStandard}
              />
            </div>
          </TabsContent>

          <TabsContent value="templates" className="space-y-3">
            <div className="flex justify-end">
              <CreateTemplateDialog />
            </div>
            <TemplatesGallery templates={templatesList} />
          </TabsContent>

          <TabsContent value="policies" className="space-y-3">
            <div className="flex justify-end">
              <CreatePolicyDialog onCreate={handleCreatePolicy} />
            </div>
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <PoliciesList
                policies={policies}
                selectedId={selectedPolicyId}
                onSelect={(p) => setSelectedPolicyId(p.id)}
              />
              <PolicyEditor policy={selectedPolicy} onSave={handleSavePolicy} />
            </div>
          </TabsContent>

          <TabsContent value="activity">
            <div className="card text-sm text-forge-300" data-testid="ok-activity-empty">
              Activity feed wires up in a follow-up. Recent updates will
              appear here once the knowledge-audit stream is connected.
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
