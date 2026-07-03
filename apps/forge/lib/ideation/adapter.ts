/**
 * Ideation status name adapter — bidirectional UI ↔ API mapping.
 *
 * The backend enum (verified at `backend/app/db/models/ideation.py:52`)
 * is `'NEW' | 'ANALYZING' | 'SCORED' | 'APPROVED' | 'IN_ROADMAP'
 *   | 'REJECTED' | 'ARCHIVED'`.
 *
 * The in-progress M2 view-model types (`lib/ideation/data.ts`) use
 * UX-friendly names that don't 1:1 line up. This module is the
 * single source of truth for the bidirectional translation.
 *
 * Mapping is semantic, not 1:1:
 *   - `ARCHIVED` folds into `rejected` in the UI (archived = hidden).
 *   - `shipped` is a UI-only state; there is no backend status. We
 *     collapse it to `APPROVED` on the way out so a card marked
 *     "shipped" locally still serializes to a valid enum value.
 */
import type { IdeaStatus as UiStatus } from './data';
import type { IdeaStatus as ApiStatus } from '@/lib/api/ideation';

const UI_TO_API: Record<UiStatus, ApiStatus> = {
  intake: 'NEW',
  scoring: 'ANALYZING',
  discovery: 'SCORED',
  prd: 'IN_ROADMAP',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  shipped: 'APPROVED',
};

const API_TO_UI: Record<ApiStatus, UiStatus> = {
  NEW: 'intake',
  ANALYZING: 'scoring',
  SCORED: 'discovery',
  APPROVED: 'approved',
  IN_ROADMAP: 'prd',
  REJECTED: 'rejected',
  ARCHIVED: 'rejected',
};

export function uiStatusToApi(status: UiStatus): ApiStatus {
  return UI_TO_API[status];
}

export function apiStatusToUi(status: ApiStatus): UiStatus {
  return API_TO_UI[status];
}