/**
 * Stories Center (Step 21 → Step 58 — Phase 7 wiring).
 *
 * The page is now fully client-driven: the orchestrator reads from
 * React Query hooks (`useStories`, `useSprints`, `useEpics`, …) and
 * there is no server-side fixture to seed.
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
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StoriesCenter } from './_components/StoriesCenter';

export const metadata: Metadata = {
  title: 'Stories · Forge AI Agent OS',
  description:
    'Every user story across this project. Drag cards across columns to update status.',
};

export default function StoriesPage() {
  return (
    <div className="mx-auto w-full max-w-[1800px]">
      <Suspense fallback={null}>
        <StoriesCenter />
      </Suspense>
    </div>
  );
}
