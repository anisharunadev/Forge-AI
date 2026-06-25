'use client';

/**
 * /admin/llm-gateway/tenants/[id]/keys — Virtual Key management.
 *
 * Lists the tenant's Virtual Key metadata, with Rotate and Revoke
 * actions. The key VALUE never appears in the DOM (see
 * `KeyListTable.tsx` for the security rationale).
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { PageHeader, SectionCard } from '@/components/shell';

import { KeyListTable } from '@/components/admin/llm-gateway';

export default function TenantKeysPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  return (
    <AdminShell>
      <div
        className="flex flex-col gap-6"
        data-testid="tenant-keys"
        data-page-title={`Virtual Keys · ${tenantId}`}
      >
        <PageHeader
          eyebrow="LLM Gateway · Tenant"
          title="Virtual Keys"
          icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          description="LiteLLM Virtual Keys for this tenant. Only metadata is shown; key values live in AWS Secrets Manager."
          breadcrumbs={[
            { label: 'LLM Gateway', href: '/admin/llm-gateway' },
            { label: 'Tenants', href: '/admin/llm-gateway/tenants' },
            { label: tenantId, href: `/admin/llm-gateway/tenants/${tenantId}` },
            { label: 'Virtual Keys' },
          ]}
        />

        <SectionCard
          title="Keys"
          description="Rotate to mint a new key (the old key is revoked in LiteLLM; spend logs preserved per OQ-30). Revoke to immediately disable."
        >
          <KeyListTable tenantId={tenantId} />
        </SectionCard>
      </div>
    </AdminShell>
  );
}
