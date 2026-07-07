/**
 * `/architecture/[tab]` — Architecture Center, per-tab deep-link.
 *
 * Per M19 (architecture god-page decomposition), the 10 tabs of the
 * Architecture Center each get their own URL:
 *
 *   /architecture/adrs         → ADRs tab
 *   /architecture/contracts    → API Contracts
 *   /architecture/tasks        → Task Breakdowns
 *   /architecture/risks        → Risk Registers
 *   /architecture/trace        → Traceability
 *   /architecture/versions     → Versions
 *   /architecture/radar        → Tech Radar
 *   /architecture/diagrams     → Diagrams
 *   /architecture/security     → Security Report
 *
 * The default landing (`/architecture`) renders the overview tab via
 * `app/architecture/page.tsx`.
 *
 * The 2,936-LoC god-page that previously lived at `app/architecture/
 * page.tsx` was split into:
 *
 *   - this dynamic route (per-tab deep-links)
 *   - `components/architecture/ArchitectureCenter.tsx`
 *     (the shared client component)
 *   - `components/architecture/inline/*` (extracted helpers)
 *
 * The split is structural rather than behavioral — the rendering
 * logic is unchanged. Per-tab URLs preserve the existing `?tab=`
 * query semantics so any old bookmark to `/architecture?tab=adrs`
 * still works.
 */

import { notFound } from 'next/navigation';

import { ArchitectureCenter } from '@/components/architecture/ArchitectureCenter';

type ArchitectureTabId =
  | 'overview'
  | 'adrs'
  | 'contracts'
  | 'tasks'
  | 'risks'
  | 'trace'
  | 'versions'
  | 'radar'
  | 'diagrams'
  | 'security';

const TAB_IDS: ReadonlyArray<ArchitectureTabId> = [
  'overview',
  'adrs',
  'contracts',
  'tasks',
  'risks',
  'trace',
  'versions',
  'radar',
  'diagrams',
  'security',
];

function isTabId(value: string): value is ArchitectureTabId {
  return (TAB_IDS as ReadonlyArray<string>).includes(value);
}

interface PageProps {
  readonly params: Promise<{ tab: string }>;
}

export function generateStaticParams() {
  return TAB_IDS.map((tab) => ({ tab }));
}

export default async function ArchitectureTabPage({ params }: PageProps) {
  const { tab } = await params;
  if (!isTabId(tab)) {
    notFound();
  }
  return <ArchitectureCenter initialTab={tab} />;
}
