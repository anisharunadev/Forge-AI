/**
 * Lessons Learned — pure data SDK (F-002-LESSON / Step-64 Sub-step B).
 *
 * Wraps `forgeFetch` (lib/forge-api.ts) with the lesson resource
 * surface. Pure functions, no React. TanStack Query hooks in
 * `lib/hooks/useLessons.ts` wrap these.
 */

import { api } from '@/lib/api/client';
import type {
  LessonCandidateListResponse,
  LessonDecideRequest,
  LessonDecisionResult,
  LessonStatus,
  MonthlyDigest,
} from '@/lib/api/lessons-types';

export interface ListLessonsParams {
  status?: LessonStatus;
  limit?: number;
}

export async function listLessons(
  params: ListLessonsParams = {},
): Promise<LessonCandidateListResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  const suffix = search.toString();
  return api.get<LessonCandidateListResponse>(`/lessons${suffix ? `?${suffix}` : ''}`);
}

export async function approveLesson(
  lessonId: string,
  body: LessonDecideRequest,
): Promise<LessonDecisionResult> {
  return api.post<LessonDecisionResult>(`/lessons/${encodeURIComponent(lessonId)}/approve`, body, {
    });
}

export async function rejectLesson(
  lessonId: string,
  body: LessonDecideRequest,
): Promise<LessonDecisionResult> {
  return api.post<LessonDecisionResult>(`/lessons/${encodeURIComponent(lessonId)}/reject`, body, {
    });
}

export async function getMonthlyDigest(
  params: { period_start?: string; period_end?: string } = {},
): Promise<MonthlyDigest> {
  const search = new URLSearchParams();
  if (params.period_start) search.set('period_start', params.period_start);
  if (params.period_end) search.set('period_end', params.period_end);
  const suffix = search.toString();
  return api.get<MonthlyDigest>(`/lessons/digest${suffix ? `?${suffix}` : ''}`);
}
