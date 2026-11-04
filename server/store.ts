import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session, SessionSummary } from '../shared/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 数据目录按「项目根」定位：开发时源码在 server/，构建后编译产物在 dist-server/server/，
 * 用 cwd 兜底比相对 import.meta.url 更稳。
 */
const PROJECT_ROOT = process.env.DEBATE_ROOT
  ? resolve(process.env.DEBATE_ROOT)
  : existsSync(resolve(process.cwd(), 'package.json'))
    ? process.cwd()
    : resolve(HERE, '..', '..');
export const DATA_DIR = resolve(PROJECT_ROOT, 'data');
export const SESSIONS_DIR = resolve(DATA_DIR, 'sessions');

/**
 * 进程内在跑的会话放内存：编排器持续写入，SSE/轮询并发读取，
 * 只靠磁盘会读到写了一半的文件（表现为偶发 404）。
 */
const memory = new Map<string, Session>();

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

function pathFor(id: string) {
  // id 由服务端生成，格式受控；仍做一次白名单校验，防止路径穿越
  if (!/^[a-z0-9-]{6,40}$/i.test(id)) throw new Error('invalid session id');
  return resolve(SESSIONS_DIR, `${id}.json`);
}

/** 原子写：先写临时文件再 rename，避免读到半截 JSON */
export async function saveSession(session: Session): Promise<void> {
  memory.set(session.id, session);
  await ensureDir();
  const file = pathFor(session.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(session, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function getSession(id: string): Promise<Session | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const raw = await readFile(pathFor(id), 'utf8');
    const session = JSON.parse(raw) as Session;
    memory.set(id, session);
    return session;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  await ensureDir();
  const merged = new Map<string, Session>();
  let files: string[] = [];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(resolve(SESSIONS_DIR, file), 'utf8');
      const s = JSON.parse(raw) as Session;
      merged.set(s.id, s);
    } catch {
      // 损坏 / 临时文件不影响列表
    }
  }
  // 内存中的更完整（磁盘可能滞后于最新一步），覆盖同 id
  for (const [id, s] of memory) merged.set(id, s);

  return [...merged.values()]
    .map<SessionSummary>((s) => ({
      id: s.id,
      topic: s.topic,
      status: s.status,
      createdAt: s.createdAt,
      durationMs: s.durationMs,
      decision: s.verdict?.decision,
      confidence: s.verdict?.confidence,
      eventCount: s.events.length,
      stanceChanges: s.metrics.stanceChanges,
      llmMode: s.llmMode,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function newSessionId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `dc-${stamp}-${rand}`;
}
