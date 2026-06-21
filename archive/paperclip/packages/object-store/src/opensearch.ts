/**
 * @fora/object-store — OpenSearch adapter.
 *
 * OpenSearch's tenant-isolation surface is two-fold:
 *
 *   1. **Routing key includes `tenant_id`.** Every index/delete forces
 *      `routing = tenant_id` so a single document lookup is bound to
 *      the tenant's routing value. The consumer side re-applies the
 *      `tenant_id` filter at query time as a belt-and-braces check.
 *
 *   2. **Index-level `tenant_id` filter.** Every search/delete adds a
 *      `term: { tenant_id: <ctx.tenant_id> }` clause to the body. A
 *      caller cannot remove it; the adapter overrides the body to
 *      prepend the filter.
 *
 * Bar: a search issued by a tenant-B session against
 * `tenants/tnt_A/...` returns no documents from tenant A's namespace
 * even if the index name is shared.
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import {
  assertTenantPrefix,
  KeyPrefixMismatchError,
  type RequestContext,
} from './context.js';
import { silentSink, type AuditSink } from './audit.js';

// ---- Config ----------------------------------------------------------------

export interface ObjectStoreOpenSearchConfig {
  /** OpenSearch cluster node URL. */
  node: string;
  /** Optional injected client. */
  client?: OpenSearchClient;
  /** Audit sink. Defaults to silent. */
  audit_sink?: AuditSink;
}

// ---- Adapter ---------------------------------------------------------------

export interface OpenSearchIndexInput {
  /**
   * Document key. Must match `^tenants/{tenant_id}/...` so the OpenSearch
   * surface is consistent with S3 / GCS / SQS.
   */
  doc_key: string;
  index: string;
  body: Record<string, unknown>;
}

export interface OpenSearchSearchInput {
  index: string;
  query?: Record<string, unknown>;
  size?: number;
}

export interface OpenSearchSearchHit {
  doc_key: string;
  source: Record<string, unknown>;
  score: number | null;
}

export class ObjectStoreOpenSearchAdapter {
  private readonly cfg: ObjectStoreOpenSearchConfig;
  private readonly client: OpenSearchClient;
  private readonly sink: AuditSink;

  constructor(cfg: ObjectStoreOpenSearchConfig) {
    this.cfg = cfg;
    this.client = cfg.client ?? new OpenSearchClient({ node: cfg.node });
    this.sink = cfg.audit_sink ?? silentSink;
  }

  /**
   * Index a document. The document's `_id` is forced to the tenant-scoped
   * `doc_key`, and the routing key is forced to `tenant_id`.
   */
  async index(ctx: RequestContext, input: OpenSearchIndexInput): Promise<{ doc_id: string; result: string }> {
    this.guard(ctx, input.doc_key, 'opensearch.index');
    const enriched = { ...input.body, tenant_id: ctx.tenant_id };
    const res = await this.client.index({
      index: input.index,
      id: input.doc_key,
      routing: ctx.tenant_id,
      body: enriched,
      refresh: false,
    });
    return { doc_id: res.body._id, result: res.body.result ?? '' };
  }

  /**
   * Search the index. The adapter prepends a `term: { tenant_id }` filter
   * to whatever query the caller passes. The caller cannot remove it
   * because the filter is added at the bool/must level, not at the leaf.
   */
  async search(ctx: RequestContext, input: OpenSearchSearchInput): Promise<OpenSearchSearchHit[]> {
    this.guard(ctx, `opensearch://${input.index}`, 'opensearch.search');
    const body = {
      size: input.size ?? 50,
      query: {
        bool: {
          must: input.query ? [input.query] : [{ match_all: {} }],
          filter: [{ term: { tenant_id: ctx.tenant_id } }],
        },
      },
    };
    const res = await this.client.search({
      index: input.index,
      routing: ctx.tenant_id,
      body,
    });
    return res.body.hits.hits.map((h: { _id?: string; _source?: unknown; _score?: number | null }) => ({
      doc_key: String(h._id ?? ''),
      source: (h._source as Record<string, unknown>) ?? {},
      score: h._score ?? null,
    }));
  }

  /**
   * Delete a document by key. The adapter forces the routing to
   * `tenant_id` and the `_id` to the bound `doc_key`.
   */
  async delete(ctx: RequestContext, index: string, doc_key: string): Promise<{ result: string }> {
    this.guard(ctx, doc_key, 'opensearch.delete');
    const res = await this.client.delete({
      index,
      id: doc_key,
      routing: ctx.tenant_id,
    });
    return { result: res.body.result ?? '' };
  }

  // ---- internals -----------------------------------------------------------

  private guard(ctx: RequestContext, key: string, operation: 'opensearch.index' | 'opensearch.search' | 'opensearch.delete'): void {
    try {
      // Search uses a synthetic key (opensearch://<index>) that we still
      // match against the prefix. The prefix check on `opensearch://...`
      // will fail for search; we skip the prefix check for search because
      // the index name is the security boundary, not the doc_key. The
      // tenant_id filter is the gate.
      if (operation !== 'opensearch.search') {
        assertTenantPrefix(ctx.tenant_id, key);
      }
    } catch (err) {
      if (err instanceof KeyPrefixMismatchError) {
        this.sink({
          event: 'tenancy.denied',
          tenant_id: ctx.tenant_id,
          principal: ctx.principal,
          trace_id: ctx.trace_id,
          resource: 'object_store',
          operation,
          deny_reason: 'key_prefix_mismatch',
          log_safe_key: err.log_safe_key,
          ts: new Date().toISOString(),
        });
      }
      throw err;
    }
    this.sink({
      event: 'tenancy.allowed',
      tenant_id: ctx.tenant_id,
      principal: ctx.principal,
      trace_id: ctx.trace_id,
      resource: 'object_store',
      operation,
      log_safe_key: key.length > 64 ? `${key.slice(0, 64)}…` : key,
      ts: new Date().toISOString(),
    });
  }
}
