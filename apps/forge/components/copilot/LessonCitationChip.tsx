'use client';

/**
 * Co-pilot citation chip (F-002-LESSON / Step-64 Sub-step B).
 *
 * When the Co-pilot response draws on an approved lesson, the
 * response renderer mounts this chip beside the message. Clicking
 * it deep-links into the Steward review queue at the lesson.
 *
 * Render contract:
 *   - When `lessonId` is a non-empty string, the chip renders with
 *     `data-testid="lesson-citation-{lessonId}"`.
 *   - When `lessonId` is missing / empty / null, the chip is a no-op
 *     (returns `null`). This makes it safe to mount unconditionally
 *     in the message renderer — the caller doesn't have to gate the
 *     render themselves.
 */

import { GraduationCap } from 'lucide-react';

interface LessonCitationChipProps {
  /** When omitted (or empty), the chip is a no-op. The Co-pilot
   *  message renderer relies on this for safe unconditional mounting. */
  lessonId?: string | null;
  title?: string;
  templateId?: string | null;
}

export function LessonCitationChip({
  lessonId,
  title = '',
  templateId,
}: LessonCitationChipProps): React.JSX.Element | null {
  // M10 Track B (T-B3) — null-safe render. If there's no lesson
  // to cite, render nothing. This is what the AC contract for
  // "absent when no lessonId" asserts.
  if (!lessonId) return null;
  return (
    <a
      href={`/knowledge-center/lessons?focus=${encodeURIComponent(lessonId)}`}
      className="inline-flex items-center gap-1 rounded border border-[var(--accent-indigo)]/40 bg-[var(--accent-indigo)]/10 px-2 py-0.5 text-xs text-[var(--accent-indigo)] hover:bg-[var(--accent-indigo)]/15"
      data-testid={`lesson-citation-${lessonId}`}
      title={templateId ? `Promoted to template ${templateId}` : title}
    >
      <GraduationCap className="h-3 w-3" />
      <span>Lesson: {title.slice(0, 40)}{title.length > 40 && '…'}</span>
    </a>
  );
}

export default LessonCitationChip;
