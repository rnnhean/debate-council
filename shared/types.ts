export type RoleId = 'analyst' | 'business' | 'cost' | 'risk' | 'judge';

export type StanceId = 'A' | 'B' | 'C';

export type RoundId = 'opening' | 'cross_exam_1' | 'cross_exam_2' | 'verdict';

export type EventType = 'opening' | 'question' | 'reply' | 'stance_change' | 'verdict' | 'system';

export type SessionStatus = 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed';

export interface DebateEvent {
  id: string;
  seq: number;
  round: RoundId;
  type: EventType;
  actor: RoleId;
  target?: RoleId;
  text: string;
  /** 当前（或变化后）立场 */
  stance?: StanceId;
  fromStance?: StanceId;
  toStance?: StanceId;
  changed?: boolean;
  reason?: string;
  latencyMs: number;
  status: 'ok' | 'error';
  at: string;
}

export interface RoleSnapshot {
  id: RoleId;
  name: string;
  stance: StanceId;
  initialStance: StanceId;
  changedCount: number;
  questions: number;
  replies: number;
  challengesReceived: number;
}

export interface Verdict {
  decision: StanceId;
  reasons: string[];
  confidence: number;
  minority: { roleId: RoleId; text: string } | null;
}

export interface SessionMetrics {
  durationMs: number;
  eventCount: number;
  stanceChanges: number;
  confidence: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface StageRecord {
  stage: RoundId;
  status: 'ok' | 'error';
  durationMs: number;
  inputChars: number;
  outputChars: number;
  llmCalls: number;
  degraded?: boolean;
  error?: string;
}

export interface Session {
  id: string;
  topic: string;
  options: Record<StanceId, { title: string; summary: string; budget: string }>;
  status: SessionStatus;
  createdAt: string;
  completedAt?: string;
  durationMs: number;
  llmMode: string;
  events: DebateEvent[];
  roles: RoleSnapshot[];
  verdict?: Verdict;
  metrics: SessionMetrics;
  stages: StageRecord[];
  review?: {
    action: 'approve';
    note: string;
    at: string;
  };
  error?: string;
}

export interface SessionSummary {
  id: string;
  topic: string;
  status: SessionStatus;
  createdAt: string;
  durationMs: number;
  decision?: StanceId;
  confidence?: number;
  eventCount: number;
  stanceChanges: number;
  llmMode: string;
}
