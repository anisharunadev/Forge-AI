/**
 * Approvals REST tests — FORA-172 (0.1.4.e).
 *
 * Covers the two new human-interaction endpoints:
 *   - POST /v1/runs/{id}/approvals/{approvalId}/decide
 *   - POST /v1/runs/{id}/stages/{stage}/return
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { buildServer } from '../src/server.js';
import {
  InMemoryApprovalsRepo,
  RecordingEventBus,
  RecordingPaperclipClient,
  RecordingPager,
  TestClock,
} from '../src/test-doubles.js';
import { asRunId, asTenantId } from '../src/types.js';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111');
const RUN_ID = asRunId(randomUUID());
const IDEM_KEY = '9f0c0c52-7e7b-4a3a-8d5a-1c9c5e3e3e3e';

// Re-use the MemoryPool shim from lifecycle tests for idempotency lookups.
// (Copied and simplified for just the idempotency tables).
class IdemOnlyPool {
  readonly idem: any[] = [];
  async query(sqlOrConfig: any, values2?: any[]): Promise<any> {
    const text = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const values = typeof sqlOrConfig === 'string' ? (values2 ?? []) : (sqlOrConfig.values ?? []);
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (sql.startsWith('select key, tenant_id, run_id, request_fingerprint')) {
      const row = this.idem.find(i => i.tenant_id === values[0] && i.key === values[1]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('insert into agent_run_idempotency_keys')) {
      const row = {
        key: values[0],
        tenant_id: values[1],
        run_id: values[2],
        request_fingerprint: values[3],
        response_status: values[4],
        response_body: JSON.parse(values[5]),
      };
      this.idem.push(row);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  async connect(): Promise<any> {
    return { query: this.query.bind(this), release: () => {} };
  }
}

describe('Approvals REST API', () => {
  let repo: InMemoryApprovalsRepo;
  let bus: RecordingEventBus;
  let paperclip: RecordingPaperclipClient;
  let pager: RecordingPager;
  let clock: TestClock;
  let pool: IdemOnlyPool;

  beforeEach(() => {
    clock = new TestClock();
    repo = new InMemoryApprovalsRepo(clock);
    bus = new RecordingEventBus();
    paperclip = new RecordingPaperclipClient();
    pager = new RecordingPager();
    pool = new IdemOnlyPool();
  });

  async function makeApp() {
    return buildServer({
      config: {
        port: 0,
        host: '127.0.0.1',
        databaseUrl: 'memory://test',
        defaultCostCeilingUsd: '100.00',
        logLevel: 'silent',
        env: 'test',
      },
      pool: pool as any,
      approvals: { repo, bus, paperclip, pager, clock },
      extractTenant: () => TENANT,
    });
  }

  describe('POST /v1/runs/:id/approvals/:approvalId/decide', () => {
    it('applies a decision and returns the outcome', async () => {
      const app = await makeApp();
      const approval = await repo.insertPending({
        runId: RUN_ID,
        tenantId: TENANT,
        stage: 'dev',
        gateKind: 'dev->qa',
        requiredRole: 'qa',
        expiresAt: new Date(clock.now().getTime() + 3600000),
        artefactRefs: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/runs/${RUN_ID}/approvals/${approval.id}/decide`,
        headers: { 'idempotency-key': IDEM_KEY },
        payload: {
          decision: 'accept',
          reason: 'looks good',
          decided_by: { actor: 'user:123', role: 'qa' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.status).toBe('approved');
      expect(body.approval.decision).toBe('accept');

      // Verify side effects
      expect(bus.events).toHaveLength(1);
      expect(bus.events[0]!.type).toBe('approval_decided');
    });

    it('handles request_changes with return_to', async () => {
      const app = await makeApp();
      const approval = await repo.insertPending({
        runId: RUN_ID,
        tenantId: TENANT,
        stage: 'dev',
        gateKind: 'dev->qa',
        requiredRole: 'qa',
        expiresAt: new Date(clock.now().getTime() + 3600000),
        artefactRefs: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/runs/${RUN_ID}/approvals/${approval.id}/decide`,
        headers: { 'idempotency-key': IDEM_KEY },
        payload: {
          decision: 'request_changes',
          reason: 'needs more tests',
          decided_by: { actor: 'user:123', role: 'qa' },
          return_to: { to_stage: 'architect', required_role: 'cto' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.status).toBe('rejected'); // request_changes maps to rejected status in repo
      expect(body.returned.toStage).toBe('architect');

      expect(bus.events.some(e => e.type === 'stage_returned')).toBe(true);
    });
  });

  describe('POST /v1/runs/:id/stages/:stage/return', () => {
    it('finds the pending approval and returns it', async () => {
      const app = await makeApp();
      await repo.insertPending({
        runId: RUN_ID,
        tenantId: TENANT,
        stage: 'dev',
        gateKind: 'dev->qa',
        requiredRole: 'qa',
        expiresAt: new Date(clock.now().getTime() + 3600000),
        artefactRefs: [],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/runs/${RUN_ID}/stages/dev/return`,
        headers: { 'idempotency-key': IDEM_KEY },
        payload: {
          to_stage: 'architect',
          reason: 'manual operator return',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.stage).toBe('dev');
      expect(body.returned.fromStage).toBe('dev');
      expect(body.returned.toStage).toBe('architect');
    });

    it('returns 404 if no pending approval exists for the stage', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/runs/${RUN_ID}/stages/dev/return`,
        headers: { 'idempotency-key': IDEM_KEY },
        payload: { to_stage: 'architect', reason: 'foo' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });
});
