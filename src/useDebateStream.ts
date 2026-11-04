import { useCallback, useEffect, useRef, useState } from 'react';
import type { DebateEvent, Session, SessionStatus } from './types.js';

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

export interface LiveState {
  session: Session | null;
  events: DebateEvent[];
  status: SessionStatus | null;
  statusMessage: string;
  screenState: 'idle' | 'running' | 'awaiting' | 'done' | 'error';
  connection: ConnectionState;
  error: string;
}

const EMPTY: LiveState = {
  session: null,
  events: [],
  status: null,
  statusMessage: '',
  screenState: 'idle',
  connection: 'idle',
  error: '',
};

/**
 * 订阅会话 SSE：
 * - 收到 snapshot（含历史事件）先整体替换
 * - 之后按 seq 去重追加，避免重连时重复
 * - 事件按 seq 排序，渲染顺序稳定
 */
export function useDebateStream(sessionId: string | null) {
  const [state, setState] = useState<LiveState>(EMPTY);
  const seen = useRef<Set<number>>(new Set());
  const esRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    seen.current = new Set();
    esRef.current?.close();
    esRef.current = null;
    setState(EMPTY);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      reset();
      return;
    }
    reset();
    setState((s) => ({ ...s, connection: 'connecting' }));

    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    esRef.current = es;

    const applySnapshot = (session: Session) => {
      seen.current = new Set(session.events.map((e) => e.seq));
      setState((s) => ({
        ...s,
        session,
        events: [...session.events].sort((a, b) => a.seq - b.seq),
        status: session.status,
        screenState: screenStateOf(session.status),
      }));
    };

    const append = (event: DebateEvent) => {
      if (seen.current.has(event.seq)) return;
      seen.current.add(event.seq);
      setState((s) => {
        const events = [...s.events, event].sort((a, b) => a.seq - b.seq);
        return { ...s, events };
      });
    };

    es.addEventListener('snapshot', (ev) => {
      try {
        applySnapshot(JSON.parse((ev as MessageEvent).data) as Session);
      } catch {
        /* ignore malformed frame */
      }
    });

    es.addEventListener('debate-event', (ev) => {
      try {
        append(JSON.parse((ev as MessageEvent).data) as DebateEvent);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener('status', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          status: SessionStatus;
          message?: string;
        };
        setState((s) => ({
          ...s,
          status: payload.status,
          statusMessage: payload.message ?? '',
          screenState: screenStateOf(payload.status),
          connection: 'live',
        }));
        // 终态时服务端会继续保留连接，前端主动断开即可
        if (payload.status === 'completed' || payload.status === 'failed') {
          void refreshSession();
        }
      } catch {
        /* ignore */
      }
    });

    es.onopen = () => setState((s) => ({ ...s, connection: 'live', error: '' }));
    es.onerror = () => {
      setState((s) =>
        s.connection === 'closed'
          ? s
          : { ...s, connection: 'error', error: '事件流连接中断，正在等待服务端' },
      );
    };

    async function refreshSession() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const session = (await res.json()) as Session;
        setState((s) => {
          seen.current = new Set([...seen.current, ...session.events.map((e) => e.seq)]);
          const merged = mergeEvents(s.events, session.events);
          return {
            ...s,
            session,
            events: merged,
            status: session.status,
            screenState: screenStateOf(session.status),
          };
        });
      } catch {
        /* ignore */
      }
    }

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionId, reset]);

  return state;
}

function mergeEvents(a: DebateEvent[], b: DebateEvent[]): DebateEvent[] {
  const map = new Map<number, DebateEvent>();
  for (const e of a) map.set(e.seq, e);
  for (const e of b) map.set(e.seq, e);
  return [...map.values()].sort((x, y) => x.seq - y.seq);
}

export function screenStateOf(status: SessionStatus | null): LiveState['screenState'] {
  switch (status) {
    case 'running':
    case 'queued':
      return 'running';
    case 'awaiting_review':
      return 'awaiting';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}
