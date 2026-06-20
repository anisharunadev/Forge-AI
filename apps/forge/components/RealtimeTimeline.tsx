'use client';

/**
 * FORA-514 §3 — run timeline wrapper that subscribes to `run.updated` and
 * `run.stage_changed` realtime events. Hydrates the SSR-fetched stages
 * + current stage, then refreshes them on a debounced 250 ms cadence
 * when a WS frame arrives. While the socket is not `open`, the
 * supplied `fetcher` keeps the timeline fresh on a 5 s poll interval.
 *
 * Replaces the previous server-only Timeline pattern: the existing
 * `<Timeline>` RSC stays as the visual layer; this component wraps it
 * with a thin realtime + poll client component.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Timeline } from './Timeline';
import { useRealtime, type FrameHandler, type WsTopic } from '@/lib/useRealtime';
import type { Stage, StageRecord } from '@/lib/types';

const DEBOUNCE_MS = 250;

export interface RealtimeTimelineProps {
  runId: string;
  initialCurrentStage: Stage | 'done';
  initialStages: ReadonlyArray<StageRecord>;
  /** Fetches the latest run header + stages from the orchestrator. */
  fetcher: () => Promise<{
    currentStage: Stage | 'done';
    stages: ReadonlyArray<StageRecord>;
  }>;
}

export function RealtimeTimeline({
  runId,
  initialCurrentStage,
  initialStages,
  fetcher,
}: RealtimeTimelineProps) {
  const [currentStage, setCurrentStage] = useState<Stage | 'done'>(initialCurrentStage);
  const [stages, setStages] = useState<ReadonlyArray<StageRecord>>(initialStages);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetcher()
        .then((next) => {
          setCurrentStage(next.currentStage);
          setStages(next.stages);
        })
        .catch(() => {
          /* Silent — the orchestrator unreachable state covers transport. */
        });
    }, DEBOUNCE_MS);
  }, [fetcher]);

  const { status, subscribe } = useRealtime({
    fallbackPoll: scheduleRefresh,
    pollIntervalMs: 5_000,
  });

  useEffect(() => {
    const handler: FrameHandler = (frame) => {
      // Cheap filter: ignore frames for other runs. Without this a busy
      // tenant (multiple runs) would refresh every run's page on every
      // stage change. The envelope shape is opaque to the hook so we
      // inspect the JSON-encoded envelope via the frame's envelope
      // field; missing fields are tolerated and the refresh fires
      // anyway (cheaper than parsing in two places).
      const env = frame.envelope as { run_id?: unknown } | undefined;
      if (env && typeof env === 'object' && env.run_id && env.run_id !== runId) {
        return;
      }
      scheduleRefresh();
    };
    const offs: Array<() => void> = [];
    offs.push(subscribe('run.updated' as WsTopic, handler));
    offs.push(subscribe('run.stage_changed' as WsTopic, handler));
    return () => {
      for (const off of offs) off();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [subscribe, scheduleRefresh, runId]);

  return (
    <div data-testid="realtime-timeline" data-realtime-status={status}>
      <Timeline runId={runId} currentStage={currentStage} stages={stages} />
    </div>
  );
}
