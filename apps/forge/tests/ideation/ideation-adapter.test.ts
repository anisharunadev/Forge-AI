/**
 * Step 69 — bidirectional adapter tests for the ideation status name
 * translation layer (`lib/ideation/adapter.ts`).
 *
 * Pure unit tests — no fetch, no MSW, no TanStack. The mapping is the
 * single source of truth for translating between the UPPER_SNAKE_CASE
 * backend enum (verified at `backend/app/db/models/ideation.py:52`)
 * and the lower-case UX-friendly names used by the M2 view-model.
 */

import { describe, expect, it } from 'vitest';

import { apiStatusToUi, uiStatusToApi } from '@/lib/ideation/adapter';

describe('ideation status adapter', () => {
  it('maps every backend enum value to the corresponding UX name', () => {
    expect(apiStatusToUi('NEW')).toBe('intake');
    expect(apiStatusToUi('ANALYZING')).toBe('scoring');
    expect(apiStatusToUi('SCORED')).toBe('discovery');
    expect(apiStatusToUi('IN_ROADMAP')).toBe('prd');
    expect(apiStatusToUi('APPROVED')).toBe('approved');
    expect(apiStatusToUi('REJECTED')).toBe('rejected');
    // ARCHIVED intentionally folds into `rejected` so the UI hides it.
    expect(apiStatusToUi('ARCHIVED')).toBe('rejected');
  });

  it('maps every UX name to a backend enum value', () => {
    expect(uiStatusToApi('intake')).toBe('NEW');
    expect(uiStatusToApi('scoring')).toBe('ANALYZING');
    expect(uiStatusToApi('discovery')).toBe('SCORED');
    expect(uiStatusToApi('prd')).toBe('IN_ROADMAP');
    expect(uiStatusToApi('approved')).toBe('APPROVED');
    expect(uiStatusToApi('rejected')).toBe('REJECTED');
    // `shipped` is a UI-only state — collapse to APPROVED on the wire.
    expect(uiStatusToApi('shipped')).toBe('APPROVED');
  });

  it('roundtrips through the adapter for the canonical six statuses', () => {
    const canonical: Array<'intake' | 'scoring' | 'discovery' | 'prd' | 'approved' | 'rejected'> = [
      'intake',
      'scoring',
      'discovery',
      'prd',
      'approved',
      'rejected',
    ];
    for (const ui of canonical) {
      expect(apiStatusToUi(uiStatusToApi(ui))).toBe(ui);
    }
  });
});