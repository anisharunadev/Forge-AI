'use client';

/**
 * Phase 5 — Live audit feed over WebSocket.
 *
 * Connects to `/ws/audit` (added in `backend/app/api/ws/audit.py`),
 * authenticates via the same `?token=` query param convention used
 * by `api.ws`, and surfaces:
 *
 *   - `status` — `connecting | open | reconnecting | closed`
 *   - `events` — newest-first list of audit events (capped at 500)
 *
 * Reconnect uses exponential backoff capped at 30s. We do NOT ack
 * Redis stream entries; each tab is a transient consumer and
 * disconnecting it is fine (the audit row itself is durable in
 * `audit_events`).
 */

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/api/auth';

export type AuditEvent = {
  id: string;
  type: 'event';
  action: string;
  ts: string;
};

type Status = 'connecting' | 'open' | 'reconnecting' | 'closed';

const MAX_EVENTS = 500;

export function useAuditStream(): { status: Status; events: AuditEvent[] } {
  const [status, setStatus] = useState<Status>('connecting');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const connect = () => {
      if (cancelledRef.current) return;
      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting');
      const token = useAuth.getState().token ?? '';
      const wsBase = process.env.NEXT_PUBLIC_FORGE_WS_URL ?? '';
      const path = `/ws/audit?token=${encodeURIComponent(token)}`;
      const url = `${wsBase}${path}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
        setStatus('open');
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as Partial<AuditEvent> & {
            type?: string;
          };
          if (data?.type === 'event' && typeof data.id === 'string') {
            const ev: AuditEvent = {
              id: data.id,
              type: 'event',
              action: String(data.action ?? ''),
              ts: String(data.ts ?? ''),
            };
            setEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS));
          }
        } catch {
          // ponytail: ignore malformed frames; the next reconnect will
          // pick up the gap-free state because the audit row itself
          // is durable.
        }
      };
      ws.onclose = () => {
        if (cancelledRef.current) return;
        scheduleReconnect();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    };

    const scheduleReconnect = () => {
      if (cancelledRef.current) return;
      attemptsRef.current += 1;
      const delay = Math.min(30_000, 500 * 2 ** attemptsRef.current);
      setStatus('reconnecting');
      timerRef.current = window.setTimeout(connect, delay);
    };

    connect();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      wsRef.current?.close();
      setStatus('closed');
    };
  }, []);

  return { status, events };
}
