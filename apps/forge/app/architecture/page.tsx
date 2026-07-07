/**
 * `/architecture` — Architecture Center overview (default landing).
 *
 * Per M19 (architecture god-page decomposition), the 2,936 LoC
 * monolith that previously lived in `app/architecture/page.tsx` has
 * been split into:
 *
 *   - `app/architecture/[tab]/page.tsx`   — per-tab dynamic route
 *   - `components/architecture/ArchitectureCenter.tsx`
 *                                        — shared client component
 *                                          (the actual rendering)
 *   - `components/architecture/inline/*`  — extracted helpers
 *                                          (Pill, KPI, Donut, etc.)
 *
 * This page is the canonical "overview" entry. It renders the
 * ArchitectureCenter client component with `tab="overview"` so
 * the deep-link `/architecture` lands users on the summary tab
 * (KPIs + recent activity + health snapshot) without manual
 * selection.
 *
 * Per-tab URLs:
 *   /architecture              → overview  (this page)
 *   /architecture/adrs         → ADRs
 *   /architecture/contracts    → API contracts
 *   /architecture/tasks        → task breakdowns
 *   /architecture/risks        → risk registers
 *   /architecture/trace        → traceability matrix
 *   /architecture/versions     → architecture versions
 *   /architecture/radar        → tech radar
 *   /architecture/diagrams     → system diagrams
 *   /architecture/security     → security report
 */

import { ArchitectureCenter } from '@/components/architecture/ArchitectureCenter';

export default function ArchitectureOverviewPage() {
  return <ArchitectureCenter initialTab="overview" />;
}