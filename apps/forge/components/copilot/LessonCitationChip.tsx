'use client';

/**
 * Co-pilot citation chip (F-002-LESSON / Step-64 Sub-step B).
 *
 * When the Co-pilot response draws on an approved lesson, the
 * response renderer mounts this chip beside the message. Clicking
 * it deep-links into the Steward review queue at the lesson.
 */

import { GraduationCap } from 'lucide-react';

interface LessonCitationChipProps {
  lessonId: string;
  title: string;
  templateId?: string | null;
}

export function LessonCitationChip({
  lessonId,
  title,
  templateId,
}: LessonCitationChipProps): JSX.Element {
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
