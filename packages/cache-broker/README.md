# `@fora/cache-broker`

Tenant-tagged cache broker. Every key is `sha256(tenants:{tenant_id}:{resource}:{id})`;
the broker refuses any cross-tenant read and emits the canonical
`tenancy.denied` audit event on mismatch.

Per **ADR-0003 §4.1** (cache row in the tenancy matrix) and
**FORA-124 acceptance bar #4** and **FORA-165** (0.7.2d).

## Public surface

```ts
import {
  CacheBroker,
  InMemoryCacheStore,
  defaultAuditSink,
  type RequestContext,
} from '@fora/cache-broker';

const broker = new CacheBroker({
  store: new InMemoryCacheStore(),      // or your Redis adapter
  audit: defaultAuditSink(),            // JSONL in dev, FORA-36 in prod
});

const ctx: RequestContext = {
  tenant_id: 'tnt_8XQ',                 // from the verified JWT
  principal: 'agent',
  actor: 'agent:developer:run-001',
  trace_id: '01HXYZTRACE',
};

await broker.set(ctx, { tenant_id: ctx.tenant_id, resource: 'project', id: 'p1' }, { name: 'Acme' });

const result = await broker.get<{ name: string }>(ctx, { resource: 'project', id: 'p1' });
if (result.status === 'hit') console.log(result.value);
```

## Contract

- `get` returns `{ status: 'hit', value }`, `{ status: 'miss' }`, or
  `{ status: 'tenant_mismatch', reason }`. A cross-tenant read is shaped like a
  miss for the caller; the audit event is emitted with `resource: 'cache'`.
- `set` throws `TenantMismatchError` if the caller's `parts.tenant_id` does not
  match the bound `ctx.tenant_id`. The hash alone prevents the underlying
  backend from accepting a key under the wrong tenant; the type check prevents
  the caller from asking for it in the first place.
- `del` is symmetric: throws on tenant mismatch, deletes on match.
- The audit emit is best-effort. An emit failure logs to stderr; it does not
  turn a `hit` into a `miss`. The tenant gate runs before the audit call.

## Audit event

The canonical `tenancy.denied` event is defined in
[`src/audit.ts`](./src/audit.ts) and shared verbatim across 0.7.2b
(`db-pool`), 0.7.2c (`object-store`), and 0.7.2d (this package). See
[FORA-165](https://paperclip.example/FORA/issues/FORA-165) for the field set.

## Tests

```bash
pnpm test
```

Coverage:

- Same-tenant round trip
- Cross-tenant read returns `tenant_mismatch` + emits audit event
- Two tenants writing the same `(resource, id)` do not collide
- `set` with mismatched tenant throws + emits audit event
- Audit event shape is the canonical tenancy.denied field set
