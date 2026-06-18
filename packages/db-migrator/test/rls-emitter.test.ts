/**
 * Unit tests for the RLS SQL emitter.
 *
 * The emitter is pure — it turns a {@link TenantScopedModel} into a SQL
 * string. These tests assert the canonical shape, which the
 * property-based test in `property-based.test.ts` then fuzzes across
 * every model in the registry.
 *
 * The shape is fixed: it is what the lint rule in 0.7.2d will check for,
 * and what the 0.7.2c connection pool relies on (it sets `app.tenant_id`
 * and the policy `USING (tenant_id = coalesce(nullif(current_setting(...),
 * '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid))` is what reads
 * the GUC).
 */

import { describe, it, expect } from 'vitest';

import {
  NIL_UUID,
  TENANT_ISOLATION_POLICY,
  emitAllRlsModels,
  emitModelDdl,
  isValidIdentifier,
  tenantIsolationPolicyExpr,
} from '../src/rls.js';
import { FORA_MODELS, TENANTS_MODEL_NAME, getRlsModels } from '../src/registry.js';

describe('isValidIdentifier', () => {
  it('accepts snake_case identifiers', () => {
    expect(isValidIdentifier('users')).toBe(true);
    expect(isValidIdentifier('agent_runs')).toBe(true);
    expect(isValidIdentifier('a')).toBe(true);
  });
  it('rejects non-snake_case or non-alpha-leading', () => {
    expect(isValidIdentifier('Users')).toBe(false);
    expect(isValidIdentifier('1users')).toBe(false);
    expect(isValidIdentifier('users;drop table')).toBe(false);
    expect(isValidIdentifier('user-id')).toBe(false);
  });
});

describe('tenantIsolationPolicyExpr', () => {
  it('uses the canonical sentinel + missing_ok GUC lookup', () => {
    const expr = tenantIsolationPolicyExpr();
    expect(expr).toContain("current_setting('app.tenant_id', true)");
    expect(expr).toContain("''"); // nullif catches the empty-string case
    expect(expr).toContain(NIL_UUID);
  });
});

describe('emitModelDdl', () => {
  it('emits the canonical policy shape for a multi-tenant model', () => {
    const sql = emitModelDdl(FORA_MODELS.find((m) => m.name === 'users')!);
    expect(sql).toMatch(/CREATE TABLE "users"/);
    expect(sql).toMatch(/"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(sql).toMatch(/"created_at" timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/"tenant_id" uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/ALTER TABLE "users" ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE "users" FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      new RegExp(`CREATE POLICY ${TENANT_ISOLATION_POLICY} ON "users"\\s+USING \\(`),
    );
    expect(sql).toMatch(/coalesce\(nullif\(current_setting\('app\.tenant_id', true\), ''\)::uuid/);
    expect(sql).toMatch(/'00000000-0000-0000-0000-000000000000'::uuid/);
  });

  it('does NOT enable RLS on the tenants table itself (bootstrap)', () => {
    const sql = emitModelDdl(FORA_MODELS.find((m) => m.name === TENANTS_MODEL_NAME)!);
    expect(sql).toMatch(/CREATE TABLE "tenants"/);
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(new RegExp(`CREATE POLICY ${TENANT_ISOLATION_POLICY}`));
  });

  it('rejects reserved column names', () => {
    expect(() =>
      emitModelDdl({
        name: 'evil',
        columns: [{ name: 'id', type: 'uuid' }],
      }),
    ).toThrow(/reserved/);
    expect(() =>
      emitModelDdl({
        name: 'evil',
        columns: [{ name: 'tenant_id', type: 'uuid' }],
      }),
    ).toThrow(/reserved/);
  });

  it('rejects invalid identifiers', () => {
    expect(() => emitModelDdl({ name: 'Drop;Table', columns: [] })).toThrow(/Invalid model name/);
    expect(() =>
      emitModelDdl({ name: 'ok', columns: [{ name: 'bad-name', type: 'text' }] }),
    ).toThrow(/Invalid column name/);
  });

  it('emits DROP POLICY IF EXISTS before CREATE POLICY for idempotency', () => {
    const sql = emitModelDdl(FORA_MODELS.find((m) => m.name === 'sessions')!);
    const dropIdx = sql.indexOf(`DROP POLICY IF EXISTS ${TENANT_ISOLATION_POLICY}`);
    const createIdx = sql.indexOf(`CREATE POLICY ${TENANT_ISOLATION_POLICY}`);
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });
});

describe('emitAllRlsModels', () => {
  it('emits DDL for every RLS-bearing model in the registry', () => {
    const sql = emitAllRlsModels(getRlsModels());
    for (const m of getRlsModels()) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${m.name}"`));
      expect(sql).toMatch(
        new RegExp(`CREATE POLICY ${TENANT_ISOLATION_POLICY} ON "${m.name}"`),
      );
    }
    // Bootstrap is excluded.
    expect(sql).not.toMatch(new RegExp(`CREATE POLICY ${TENANT_ISOLATION_POLICY} ON "${TENANTS_MODEL_NAME}"`));
  });
});
