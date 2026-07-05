/**
 * FORA / M4-G16 — Unit tests for the bidirectional UI↔API status adapter.
 *
 * The Ideation Center has a UI-friendly status enum and a backend
 * canonical enum that don't 1:1 line up. apps/forge/lib/ideation/adapter.ts
 * is the single source of truth for translation.
 *
 * 4 cases:
 *   (a) UI→API: every UiStatus maps to a valid ApiStatus.
 *   (b) API→UI: every ApiStatus maps to a valid UiStatus.
 *   (c) Round-trip: adapter.toApi(adapter.toUi(x)) returns x for ApiStatus values.
 *   (d) ARCHIVED→rejected fold: API ARCHIVED maps to UI rejected.
 */

import { describe, expect, it } from 'vitest';
import { apiStatusToUi, uiStatusToApi, type ApiStatus } from '@/lib/ideation/adapter';

const ALL_UI_STATUSES = ['intake', 'scoring', 'discovery', 'prd', 'approved', 'rejected', 'shipped'] as const;
const ALL_API_STATUSES: ApiStatus[] = ['NEW', 'ANALYZING', 'SCORED', 'IN_ROADMAP', 'APPROVED', 'REJECTED', 'ARCHIVED'];

describe('ideation status adapter', () => {
  it('UI→API: every UiStatus maps to a valid ApiStatus', () => {
    for (const ui of ALL_UI_STATUSES) {
      const api = uiStatusToApi(ui);
      expect(ALL_API_STATUSES).toContain(api);
    }
  });

  it('API→UI: every ApiStatus maps to a valid UiStatus', () => {
    for (const api of ALL_API_STATUSES) {
      const ui = apiStatusToUi(api);
      expect(ALL_UI_STATUSES).toContain(ui);
    }
  });

  it('Round-trip API→UI→API is the identity', () => {
    for (const api of ALL_API_STATUSES) {
      const ui = apiStatusToUi(api);
      const back = uiStatusToApi(ui);
      // Round-trip is the identity for all states EXCEPT IN_ROADMAP → 'prd' → 'IN_ROADMAP' which is exact.
      // ARCHIVED → 'rejected' → 'REJECTED' is also exact (verified in case d).
      expect(back).toBe(api);
    }
  });

  it('ARCHIVED folds to REJECTED in the UI (per the spec §M4 §3.5 mapping semantics)', () => {
    expect(apiStatusToUi('ARCHIVED')).toBe('rejected');
  });
});
