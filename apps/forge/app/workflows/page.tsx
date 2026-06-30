/**
 * `/workflows` index — Step-56 (Phase 4).
 *
 * The list view is the FastAPI-backed WorkflowCenter. The legacy
 * `Mode A → Mode B` gallery/canvas toggle (Step-22/23) now lives at
 * `/workflows/{id}` and `/workflows/{id}/edit` so the index page
 * stays focused on discovery.
 */

import { WorkflowCenter } from '@/components/workflows/WorkflowCenter';

export const dynamic = 'force-dynamic';

export default function WorkflowsIndexPage() {
  return <WorkflowCenter />;
}
