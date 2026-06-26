/**
 * Stories Center (Step 21).
 *
 * Dedicated kanban-first center for stories. Replaces the prior
 * sub-section inside `/project-intelligence` with a full projection of
 * the canonical `Story` type across three views (Kanban / List /
 * Timeline) plus a story detail drawer.
 *
 * Skill influence (`ui-ux-pro-max` queries):
 *   - "Always show input label" — every input has a visible label
 *     (sr-only or explicit).
 *   - "Status colors paired with icons/dots" — every status dot is
 *     paired with text or an icon, never color-only.
 *   - "Keyboard accessibility required" — @dnd-kit KeyboardSensor +
 *     PointerSensor, role="dialog", Esc closes, focus returns to
 *     originating card on drawer close.
 *   - "Z-index scale" — uses the canonical 30/40/50 tokens, no
 *     arbitrary large numbers.
 *
 * Data: stories come from the static `lib/stories/mock-data.ts`
 * fixture (server-side import — no useEffect hydration noise). The
 * page is server-rendered for the shell, then a client component
 * (`StoriesCenter`) takes over for interactivity.
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StoriesCenter } from './_components/StoriesCenter';
import { STORIES, ASSIGNEE_POOL, SPRINTS, SAMPLE_COMMENTS } from '@/lib/stories/mock-data';

export const metadata: Metadata = {
  title: 'Stories · Forge AI Agent OS',
  description:
    'Every user story across this project. Drag cards across columns to update status.',
};

export default function StoriesPage() {
  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <Suspense fallback={null}>
        <StoriesCenter
          initialStories={STORIES}
          assignees={ASSIGNEE_POOL}
          sprints={SPRINTS}
          sampleComments={SAMPLE_COMMENTS}
        />
      </Suspense>
    </div>
  );
}