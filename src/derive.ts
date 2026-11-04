import type { DebateEvent, RoleId, StanceId } from './types';

const DEBATERS: RoleId[] = ['analyst', 'business', 'cost', 'risk'];

/** UI 用角色状态：开局前立场为 null（“待定”），不假装默认支持 A */
export interface UiRoleState {
  id: RoleId;
  stance: StanceId | null;
  initialStance: StanceId | null;
  changedCount: number;
  questions: number;
  replies: number;
  challengesReceived: number;
}

/** 从事件推导角色状态：回放时只喂可见事件，面板就会随时间推进 */
export function deriveRoles(events: DebateEvent[]): UiRoleState[] {
  const map = new Map<RoleId, UiRoleState>();
  for (const id of DEBATERS) {
    map.set(id, {
      id,
      stance: null,
      initialStance: null,
      changedCount: 0,
      questions: 0,
      replies: 0,
      challengesReceived: 0,
    });
  }

  for (const ev of events) {
    const role = map.get(ev.actor);
    if (ev.type === 'opening' && role && ev.stance) {
      role.stance = ev.stance;
      role.initialStance = ev.stance;
    }
    if (ev.type === 'question') {
      if (role) role.questions += 1;
      const target = ev.target ? map.get(ev.target) : undefined;
      if (target) target.challengesReceived += 1;
    }
    if (ev.type === 'reply' && role) {
      role.replies += 1;
      if (ev.changed && ev.stance) {
        role.stance = ev.stance;
        role.changedCount += 1;
      }
    }
  }
  return [...map.values()];
}

export function stanceChanges(events: DebateEvent[]): number {
  return events.filter((e) => e.type === 'stance_change').length;
}

export function stanceSequence(events: DebateEvent[], roleId: RoleId): StanceId[] {
  const seq: StanceId[] = [];
  for (const ev of events) {
    if (ev.actor !== roleId) continue;
    if (ev.type === 'opening' && ev.stance) seq.push(ev.stance);
    if (ev.type === 'stance_change' && ev.toStance) seq.push(ev.toStance);
  }
  return seq;
}
