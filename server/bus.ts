import { EventEmitter } from 'node:events';
import type { DebateEvent, Session } from '../shared/types.js';

/**
 * 会话级事件总线：
 * - 编排过程中每产生一条事件就 push 给所有订阅者（SSE）
 * - 同时把事件追加进 session，交给 orchestrator 落库
 */
export class SessionBus extends EventEmitter {
  constructor(public readonly sessionId: string) {
    super();
    this.setMaxListeners(50);
  }

  publish(payload: { kind: 'event' | 'status' | 'verdict'; data: unknown }) {
    this.emit('message', payload);
  }
}

const buses = new Map<string, SessionBus>();

export function getBus(sessionId: string): SessionBus | undefined {
  return buses.get(sessionId);
}

export function createBus(sessionId: string): SessionBus {
  // 复用同一个 bus：阶段 1~3 的订阅者也要能收到后续裁决事件
  const existing = buses.get(sessionId);
  if (existing) return existing;
  const bus = new SessionBus(sessionId);
  buses.set(sessionId, bus);
  return bus;
}

export function disposeBus(sessionId: string) {
  const bus = buses.get(sessionId);
  if (!bus) return;
  setTimeout(() => {
    bus.removeAllListeners();
    buses.delete(sessionId);
  }, 60_000).unref?.();
}

/** 供 store / 测试复用：生成事件骨架 */
export function makeEvent(
  seq: number,
  round: DebateEvent['round'],
  partial: Omit<DebateEvent, 'id' | 'seq' | 'round' | 'at' | 'latencyMs' | 'status'> &
    Partial<Pick<DebateEvent, 'latencyMs' | 'status'>>,
): DebateEvent {
  return {
    id: `ev-${String(seq).padStart(3, '0')}`,
    seq,
    round,
    at: new Date().toISOString(),
    latencyMs: partial.latencyMs ?? 0,
    status: partial.status ?? 'ok',
    ...partial,
  };
}

export function summarize(session: Session) {
  return {
    id: session.id,
    status: session.status,
    eventCount: session.events.length,
    stanceChanges: session.metrics.stanceChanges,
    decision: session.verdict?.decision,
    confidence: session.verdict?.confidence,
  };
}
