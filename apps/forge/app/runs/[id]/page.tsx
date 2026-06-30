/**
 * `/runs/[id]` — Step-56 (Phase 4).
 *
 * Run detail view backed by the FastAPI workflow run API. Replaces
 * the FORA orchestrator run detail (7-stage model) that was wired in
 * Step 14.
 */

import { WorkflowRunDetail } from '@/components/workflows/WorkflowRunDetail';

export const dynamic = 'force-dynamic';

export default function RunDetailPage() {
  return <WorkflowRunDetail />;
}
