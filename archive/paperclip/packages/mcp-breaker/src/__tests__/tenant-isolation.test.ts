/**
 * Tenant isolation — per-(tenant, server) keying.
 *
 * A tenant-A Jira outage must NOT trip tenant-B Jira. A tenant-A Jira
 * outage must NOT trip tenant-A Slack. The cache-broker is the
 * enforcement boundary; these tests verify the breaker uses it.
 */

import { describe, it, expect } from 'vitest';
import {
  McpCircuitBreaker,
  InMemoryBreakerStore,
  InMemoryBreakerEventSink,
  type BreakerKey,
} from '../index.js';
import type { RequestContext } from '@fora/cache-broker';

const TENANT_A: RequestContext = {
  tenant_id: 'tnt_acme',
  principal: 'agent',
  actor: 'agent:router:run-001',
  trace_id: '01HXYZTRACE',
};
const TENANT_B: RequestContext = {
  tenant_id: 'tnt_globex',
  principal: 'agent',
  actor: 'agent:router:run-002',
  trace_id: '01HXYZTRACE',
};

const KEY_A_JIRA: BreakerKey = { tenant_id: 'tnt_acme', server_name: 'jira' };
const KEY_A_SLACK: BreakerKey = { tenant_id: 'tnt_acme', server_name: 'slack' };
const KEY_B_JIRA: BreakerKey = { tenant_id: 'tnt_globex', server_name: 'jira' };

function makeBreaker() {
  return new McpCircuitBreaker({
    store: new InMemoryBreakerStore(),
    events: new InMemoryBreakerEventSink(),
  });
}

describe('mcp-breaker tenant isolation', () => {
  it('tenant-A Jira trip does NOT trip tenant-A Slack', async () => {
    const b = makeBreaker();
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(TENANT_A, KEY_A_JIRA);
      await b.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    // tenant-A Jira is open.
    expect((await b.inspect(TENANT_A, KEY_A_JIRA)).state).toBe('open');
    // tenant-A Slack is still closed and callable.
    expect((await b.inspect(TENANT_A, KEY_A_SLACK)).state).toBe('closed');
    const r = await b.beforeCall(TENANT_A, KEY_A_SLACK);
    expect(r.allow).toBe(true);
  });

  it('tenant-A Jira trip does NOT trip tenant-B Jira', async () => {
    const b = makeBreaker();
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(TENANT_A, KEY_A_JIRA);
      await b.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    // tenant-A Jira is open.
    expect((await b.inspect(TENANT_A, KEY_A_JIRA)).state).toBe('open');
    // tenant-B Jira is still closed and callable.
    expect((await b.inspect(TENANT_B, KEY_B_JIRA)).state).toBe('closed');
    const r = await b.beforeCall(TENANT_B, KEY_B_JIRA);
    expect(r.allow).toBe(true);
  });

  it('event stream is partitioned per (tenant, server)', async () => {
    const sink = new InMemoryBreakerEventSink();
    const b = new McpCircuitBreaker({
      store: new InMemoryBreakerStore(),
      events: sink,
    });
    // Trip tenant-A Jira.
    for (let i = 0; i < 5; i++) {
      await b.beforeCall(TENANT_A, KEY_A_JIRA);
      await b.recordFailure(TENANT_A, KEY_A_JIRA);
    }
    // Use tenant-A Slack once (success) — no event.
    await b.beforeCall(TENANT_A, KEY_A_SLACK);
    await b.recordSuccess(TENANT_A, KEY_A_SLACK);
    // Tenant-A Jira events.
    const aJira = sink.listFor('tnt_acme', 'jira');
    expect(aJira.length).toBe(1);
    expect(aJira[0]!.type).toBe('breaker.trip');
    // Tenant-A Slack events.
    const aSlack = sink.listFor('tnt_acme', 'slack');
    expect(aSlack.length).toBe(0);
    // Tenant-B Jira events.
    const bJira = sink.listFor('tnt_globex', 'jira');
    expect(bJira.length).toBe(0);
  });

  it('in-memory store size grows with key count', async () => {
    const store = new InMemoryBreakerStore();
    const b = new McpCircuitBreaker({ store, events: new InMemoryBreakerEventSink() });
    await b.beforeCall(TENANT_A, KEY_A_JIRA);
    await b.beforeCall(TENANT_A, KEY_A_SLACK);
    await b.beforeCall(TENANT_B, KEY_B_JIRA);
    expect(store.size()).toBe(3);
  });
});