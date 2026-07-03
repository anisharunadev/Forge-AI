/**
 * TanStack Query hooks for Lessons Learned (F-002-LESSON / Step-64 Sub-step B).
 *
 * Mirrors the lib/hooks/useAnalytics.ts pattern. Pure fetchers live in
 * `lib/lessons/data.ts`; this file is just the query/mutation glue.
 */

'use client';

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  LessonCandidateListResponse,
  LessonDecideRequest,
  LessonDecisionResult,
  LessonStatus,
  MonthlyDigest,
} from '@/lib/api/lessons-types';
import {
  approveLesson,
  getMonthlyDigest,
  listLessons,
  rejectLesson,
} from '@/lib/lessons/data';

export const lessonsQueryKeys = {
  list: (status?: LessonStatus) => ['lessons', 'list', status ?? 'all'] as const,
  digest: (period_start?: string, period_end?: string) =>
    ['lessons', 'digest', period_start ?? '', period_end ?? ''] as const,
};

export function useLessons(
  status?: LessonStatus,
): UseQueryResult<LessonCandidateListResponse, Error> {
  return useQuery<LessonCandidateListResponse, Error>({
    queryKey: lessonsQueryKeys.list(status),
    queryFn: () => listLessons({ status, limit: 100 }),
    refetchInterval: 30_000,
  });
}

export function useApproveLesson(): UseMutationResult<
  LessonDecisionResult,
  Error,
  { lessonId: string; body: LessonDecideRequest }
> {
  return useMutation<
    LessonDecisionResult,
    Error,
    { lessonId: string; body: LessonDecideRequest }
  >({
    mutationFn: ({ lessonId, body }) => approveLesson(lessonId, body),
  });
}

export function useRejectLesson(): UseMutationResult<
  LessonDecisionResult,
  Error,
  { lessonId: string; body: LessonDecideRequest }
> {
  return useMutation<
    LessonDecisionResult,
    Error,
    { lessonId: string; body: LessonDecideRequest }
  >({
    mutationFn: ({ lessonId, body }) => rejectLesson(lessonId, body),
  });
}

export function useMonthlyDigest(
  period_start?: string,
  period_end?: string,
): UseQueryResult<MonthlyDigest, Error> {
  return useQuery<MonthlyDigest, Error>({
    queryKey: lessonsQueryKeys.digest(period_start, period_end),
    queryFn: () => getMonthlyDigest({ period_start, period_end }),
    refetchInterval: 5 * 60_000,
  });
}
