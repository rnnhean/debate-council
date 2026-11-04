import { createBus, makeEvent } from './bus.js';
import type { LlmProvider } from './llm.js';
import { getLlmUsage } from './llm.js';
import {
  batchOpeningSystem,
  batchOpeningUser,
  type OpeningItem,
  type QuestionItem,
  questionsSystem,
  questionsUser,
  type ReplyItem,
  repliesSystem,
  repliesUser,
  verdictSystem,
  verdictUser,
} from './prompts.js';
import { DEBATER_IDS, ROLE_MAP } from './roles.js';
import { saveSession } from './store.js';
import type {
  DebateEvent,
  EventType,
  RoleId,
  RoleSnapshot,
  RoundId,
  Session,
  StanceId,
  StageRecord,
  Verdict,
} from '../shared/types.js';


export interface OrchestratorDeps {
  provider: LlmProvider;
  /** 真模型失败时的确定性兜底数据源 */
  fallback: LlmProvider;
  session: Session;
}

/** 解析模型输出里的 JSON，容忍 ``` 围栏和前后解释文字 */
function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no json object in output');
  return JSON.parse(candidate.slice(start, end + 1));
}

function asStance(value: unknown, fallback: StanceId): StanceId {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  // 容忍「方案A」「选项 A」「a」等写法
  const match = /(?:方案|选项)?\s*([ABC])/.exec(normalized);
  return match ? (match[1] as StanceId) : fallback;
}

const ROLE_ALIASES: Record<string, RoleId> = {
  analyst: 'analyst',
  数据分析师: 'analyst',
  数据: 'analyst',
  business: 'business',
  业务分析师: 'business',
  业务: 'business',
  cost: 'cost',
  成本官: 'cost',
  成本: 'cost',
  risk: 'risk',
  风险官: 'risk',
  风险: 'risk',
  judge: 'judge',
  裁决者: 'judge',
};

function asRole(value: unknown): RoleId | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return ROLE_ALIASES[key] ?? (key in ROLE_MAP ? (key as RoleId) : null);
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const scaled = n > 1 ? n / 100 : n;
  return Math.min(0.99, Math.max(0.05, Number(scaled.toFixed(2))));
}

function cleanText(value: unknown, max = 400): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

class EventLog {
  private seq: number;
  constructor(
    private session: Session,
    private emit: (event: DebateEvent) => void,
  ) {
    // 裁决阶段是在已落库的会话上追加，序号必须接着已有事件走
    this.seq = session.events.length;
  }

  add(
    round: RoundId,
    type: EventType,
    actor: RoleId,
    partial: Partial<
      Omit<DebateEvent, 'id' | 'seq' | 'round' | 'type' | 'actor' | 'at' | 'text'>
    > & { text: string },
  ): DebateEvent {
    this.seq += 1;
    const event = makeEvent(this.seq, round, { type, actor, ...partial });
    this.session.events.push(event);
    this.emit(event);
    return event;
  }
}

function snapshotRole(roleId: RoleId): RoleSnapshot {
  return {
    id: roleId,
    name: ROLE_MAP[roleId].name,
    stance: 'A',
    initialStance: 'A',
    changedCount: 0,
    questions: 0,
    replies: 0,
    challengesReceived: 0,
  };
}

const roleOf = (session: Session, id: RoleId) => session.roles.find((r) => r.id === id);

export interface SessionHooks {
  onEvent: (event: DebateEvent) => void;
  onStatus: (status: Session['status'], message?: string) => void;
}

interface StageMeta {
  inputChars: number;
  outputChars: number;
  llmCalls: number;
}

/**
 * 阶段 1~3：opening（1 次调用）→ cross_exam_1（1 次）→ cross_exam_2（1 次）。
 * 完成后会话停在 awaiting_review，等待人工确认/纠偏后再跑裁决。
 */
export async function runDebateStages(
  deps: OrchestratorDeps,
  hooks: SessionHooks,
): Promise<Session> {
  const { session } = deps;
  const log = new EventLog(session, hooks.onEvent);
  const started = Date.now();
  session.status = 'running';
  hooks.onStatus('running', '辩手已入场，开始独立开局陈述');

  const openings = await runStage(session, log, 'opening', (phase, meta) =>
    callBatch(deps, phase, batchOpeningSystem(), batchOpeningUser(), meta, (raw) => {
      const parsed = extractJson(raw) as { items?: unknown[] };
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const byRole = new Map<RoleId, OpeningItem>();
      for (const item of items) {
        const obj = item as Record<string, unknown>;
        const roleId = asRole(obj.role);
        if (!roleId || roleId === 'judge') continue;
        byRole.set(roleId, {
          role: roleId,
          stance: asStance(obj.stance, 'A'),
          confidence: clampConfidence(obj.confidence, 0.6),
          text: cleanText(obj.text, 320),
          reasons: Array.isArray(obj.reasons)
            ? obj.reasons.map((r) => cleanText(r, 80)).filter(Boolean)
            : [],
        });
      }
      const usable = DEBATER_IDS.map((id) => byRole.get(id)).filter((x): x is OpeningItem => Boolean(x));
      if (usable.length === 0) throw new Error('opening: no usable roles');
      return usable;
    }),
  );

  for (const roleId of DEBATER_IDS) {
    session.roles.push(snapshotRole(roleId));
  }
  for (const item of openings) {
    const snapshot = roleOf(session, item.role);
    if (!snapshot) continue;
    snapshot.stance = item.stance;
    snapshot.initialStance = item.stance;
    log.add('opening', 'opening', item.role, {
      text: item.text,
      stance: item.stance,
      reason: item.reasons.join(' / '),
    });
  }

  // ---------- 第一轮交叉质询 ----------
  const questions = await runStage(session, log, 'cross_exam_1', (phase, meta) =>
    callBatch(deps, phase, questionsSystem(), questionsUser(openings), meta, (raw) => {
      const parsed = extractJson(raw) as { items?: unknown[] };
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const out: QuestionItem[] = [];
      for (const item of items) {
        const obj = item as Record<string, unknown>;
        const role = asRole(obj.role);
        const target = asRole(obj.target);
        if (!role || !target || role === target || role === 'judge' || target === 'judge') continue;
        if (!roleOf(session, target)) continue;
        out.push({
          role,
          target,
          text: cleanText(obj.text, 200),
          focus: cleanText(obj.focus, 12) || '核心假设',
        });
      }
      if (!out.length) throw new Error('cross_exam_1: no usable questions');
      return out;
    }),
  );

  for (const q of questions) {
    const asker = roleOf(session, q.role);
    if (asker) asker.questions += 1;
    const target = roleOf(session, q.target);
    if (target) target.challengesReceived += 1;
    log.add('cross_exam_1', 'question', q.role, {
      target: q.target,
      text: q.text,
      reason: q.focus,
    });
  }

  // ---------- 第二轮回应 + 立场变化 ----------
  const replies = await runStage(session, log, 'cross_exam_2', (phase, meta) =>
    callBatch(deps, phase, repliesSystem(), repliesUser(openings, questions), meta, (raw) => {
      const parsed = extractJson(raw) as { items?: unknown[] };
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const out: ReplyItem[] = [];
      for (const item of items) {
        const obj = item as Record<string, unknown>;
        const role = asRole(obj.role);
        if (!role || role === 'judge') continue;
        const snapshot = roleOf(session, role);
        if (!snapshot) continue;
        const before = snapshot.stance;
        const stance = asStance(obj.stance, before);
        out.push({
          role,
          stance,
          confidence: clampConfidence(obj.confidence),
          changed: stance !== before,
          fromStance: before,
          text: cleanText(obj.text, 320),
          reason: cleanText(obj.reason, 160),
        });
      }
      if (!out.length) throw new Error('cross_exam_2: no usable replies');
      return out;
    }),
  );

  for (const reply of replies) {
    const snapshot = roleOf(session, reply.role);
    if (!snapshot) continue;
    snapshot.replies += 1;
    const from = snapshot.stance;
    const changed = reply.stance !== from;
    if (changed) {
      snapshot.stance = reply.stance;
      snapshot.changedCount += 1;
    }
    log.add('cross_exam_2', 'reply', reply.role, {
      text: reply.text,
      stance: snapshot.stance,
      fromStance: from,
      toStance: changed ? reply.stance : undefined,
      changed,
      reason: reply.reason,
    });
    if (changed) {
      log.add('cross_exam_2', 'stance_change', reply.role, {
        text: `${ROLE_MAP[reply.role].name} 将立场从 ${from} 调整为 ${reply.stance}`,
        fromStance: from,
        toStance: reply.stance,
        stance: reply.stance,
        changed: true,
        reason: reply.reason,
      });
    }
  }

  session.metrics.stanceChanges = session.roles.reduce((n, r) => n + r.changedCount, 0);
  session.metrics.durationMs = Date.now() - started;
  session.metrics.eventCount = session.events.length;
  session.metrics.llmCalls = session.stages.reduce((n, s) => n + s.llmCalls, 0);
  session.status = 'awaiting_review';
  log.add('cross_exam_2', 'system', 'judge', {
    text: '辩论记录已封存，等待人工确认后进入裁决。',
  });
  hooks.onStatus('awaiting_review', '等待人工确认');
  await saveSession(session);
  return session;
}

/** 阶段 4：人工确认（可附纠偏意见）后执行裁决（1 次调用） */
export async function runVerdict(
  deps: OrchestratorDeps,
  hooks: SessionHooks,
  note?: string,
): Promise<Session> {
  const { session } = deps;
  const log = new EventLog(session, hooks.onEvent);
  session.status = 'running';
  session.review = { action: 'approve', note: note?.trim() ?? '', at: new Date().toISOString() };
  hooks.onStatus('running', '裁决者入场');

  if (session.review.note) {
    log.add('verdict', 'system', 'judge', {
      text: `人工纠偏意见已注入裁决上下文：${session.review.note.slice(0, 200)}`,
    });
  }

  const openings = extractOpenings(session);
  const questions = extractQuestions(session);
  const replies = extractReplies(session);

  const verdict = await runStage(session, log, 'verdict', (phase, meta) =>
    callBatch(
      deps,
      phase,
      verdictSystem(),
      verdictUser(openings, questions, replies, session.review?.note),
      meta,
      (raw) => {
        const parsed = extractJson(raw) as Record<string, unknown>;
        const decision = asStance(parsed.decision, openings[0]?.stance ?? 'A');
        const reasons = Array.isArray(parsed.reasons)
          ? parsed.reasons.map((r) => cleanText(r, 160)).filter(Boolean).slice(0, 3)
          : [];
        if (!reasons.length) throw new Error('verdict: no reasons');
        const minorityRaw = parsed.minority as Record<string, unknown> | undefined;
        const minorityRole = minorityRaw ? asRole(minorityRaw.role) : null;
        const minorityText = minorityRaw ? cleanText(minorityRaw.text, 240) : '';
        const result: Verdict = {
          decision,
          confidence: clampConfidence(parsed.confidence, 0.6),
          reasons,
          minority:
            minorityRole && minorityText ? { roleId: minorityRole, text: minorityText } : null,
        };
        return result;
      },
    ),
  );

  session.verdict = verdict;
  log.add('verdict', 'verdict', 'judge', {
    text: verdict.reasons.join(' | '),
    stance: verdict.decision,
    reason: `置信度 ${verdict.confidence}`,
  });

  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  session.metrics.durationMs = Math.max(
    1,
    Date.now() - Date.parse(session.createdAt),
  );
  session.durationMs = session.metrics.durationMs;
  session.metrics.eventCount = session.events.length;
  session.metrics.confidence = verdict.confidence;
  session.metrics.llmCalls = session.stages.reduce((n, s) => n + s.llmCalls, 0);
  const used = getLlmUsage();
  session.metrics.promptTokens = used.promptTokens;
  session.metrics.completionTokens = used.completionTokens;
  hooks.onStatus('completed', '裁决完成');
  await saveSession(session);
  return session;
}

/** 单阶段执行：记录耗时/输入输出长度/调用次数，失败时降级到 Mock 重跑一次 */
async function runStage<T>(
  session: Session,
  log: EventLog,
  stage: RoundId,
  work: (phase: 'primary' | 'fallback', meta: StageMeta) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const meta: StageMeta = { inputChars: 0, outputChars: 0, llmCalls: 0 };
  let degraded = false;
  let error: string | undefined;
  let result: T | undefined;
  let failed = false;

  try {
    result = await work('primary', meta);
  } catch (err) {
    // 真实模型失败（429 / 余额不足 / 4xx / 解析失败）：不重试，立刻用确定性数据继续
    degraded = true;
    failed = true;
    error = err instanceof Error ? err.message : 'unknown error';
    log.add(stage, 'system', 'judge', {
      text: `阶段 ${stage} 主模型不可用（${error}），已回退确定性数据继续。`,
    });
  }

  if (failed) {
    meta.llmCalls = 0;
    meta.inputChars = 0;
    meta.outputChars = 0;
    try {
      result = await work('fallback', meta);
    } catch (fallbackErr) {
      const record: StageRecord = {
        stage,
        status: 'error',
        durationMs: Date.now() - started,
        inputChars: meta.inputChars,
        outputChars: meta.outputChars,
        llmCalls: meta.llmCalls,
        degraded,
        error: fallbackErr instanceof Error ? fallbackErr.message : 'fallback failed',
      };
      upsertStage(session, record);
      throw fallbackErr;
    }
  }

  upsertStage(session, {
    stage,
    status: 'ok',
    durationMs: Date.now() - started,
    inputChars: meta.inputChars,
    outputChars: meta.outputChars,
    llmCalls: meta.llmCalls,
    degraded,
    error,
  });
  return result as T;
}

function upsertStage(session: Session, record: StageRecord) {
  const idx = session.stages.findIndex((s) => s.stage === record.stage);
  if (idx >= 0) session.stages[idx] = record;
  else session.stages.push(record);
}

async function callBatch<T>(
  deps: OrchestratorDeps,
  phase: 'primary' | 'fallback',
  system: string,
  user: string,
  meta: StageMeta,
  parse: (raw: string) => T,
): Promise<T> {
  const provider = phase === 'fallback' ? deps.fallback : deps.provider;
  // 只统计主模型调用次数；回退 Mock 不计入 llmCalls，避免把降级算成真实调用
  if (phase === 'primary') meta.llmCalls += 1;
  meta.inputChars = system.length + user.length;
  const raw = await provider.complete({ system, user, json: true });
  meta.outputChars = raw.length;
  return parse(raw);
}

// ---------- 从事件还原上下文 ----------
function extractOpenings(session: Session): OpeningItem[] {
  return session.events
    .filter((e) => e.type === 'opening')
    .map((e) => ({
      role: e.actor,
      stance: e.stance ?? 'A',
      confidence: 0.6,
      text: e.text,
      reasons: e.reason ? e.reason.split(' / ') : [],
    }));
}

function extractQuestions(session: Session): QuestionItem[] {
  return session.events
    .filter((e) => e.type === 'question')
    .map((e) => ({
      role: e.actor,
      target: (e.target ?? 'analyst') as RoleId,
      text: e.text,
      focus: e.reason ?? '核心假设',
    }));
}

function extractReplies(session: Session): ReplyItem[] {
  return session.events
    .filter((e) => e.type === 'reply')
    .map((e) => ({
      role: e.actor,
      stance: e.stance ?? 'A',
      confidence: 0.6,
      changed: Boolean(e.changed),
      fromStance: e.fromStance ?? e.stance ?? 'A',
      text: e.text,
      reason: e.reason ?? '',
    }));
}

/** 异步启动阶段 1~3 */
export function startSession(deps: OrchestratorDeps): void {
  const bus = createBus(deps.session.id);
  const hooks: SessionHooks = {
    onEvent: (event) => bus.publish({ kind: 'event', data: event }),
    onStatus: (status, message) => bus.publish({ kind: 'status', data: { status, message } }),
  };
  void runDebateStages(deps, hooks).catch(async (err) => {
    deps.session.status = 'failed';
    deps.session.error = err instanceof Error ? err.message : 'unknown';
    hooks.onStatus('failed', '辩论失败');
    await saveSession(deps.session).catch(() => undefined);
  });
}

/** 异步启动裁决 */
export function startVerdict(deps: OrchestratorDeps, note?: string): void {
  const bus = createBus(deps.session.id);
  const hooks: SessionHooks = {
    onEvent: (event) => bus.publish({ kind: 'event', data: event }),
    onStatus: (status, message) => bus.publish({ kind: 'status', data: { status, message } }),
  };
  void runVerdict(deps, hooks, note).catch(async (err) => {
    deps.session.status = 'failed';
    deps.session.error = err instanceof Error ? err.message : 'unknown';
    hooks.onStatus('failed', '裁决失败');
    await saveSession(deps.session).catch(() => undefined);
  });
}
