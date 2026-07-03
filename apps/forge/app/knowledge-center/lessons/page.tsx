/**
 * Knowledge Center → Lessons Learned — page route for the Steward
 * review queue (F-002-LESSON / Step-64 Sub-step B).
 */

import { Suspense } from 'react';

import LessonsList from '@/components/lessons/LessonsList';

export const dynamic = 'force-dynamic';

export default function LessonsPage(): JSX.Element {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Suspense fallback={null}>
        <LessonsList />
      </Suspense>
    </main>
  );
}
