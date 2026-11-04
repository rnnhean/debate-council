import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBus, getBus } from './bus.js';
import { getLlmUsage, isMockMode, modelName, type LlmProvider } from './llm.js';
import { startSession, startVerdict } from './orchestrator.js';
import { DEBATER_IDS, ROLE_MAP, ROLES } from './roles.js';
import { SCENARIO } from './scenario.js';
import { getSession, listSessions, newSessionId, saveSession } from './store.js';
import type { Session } from '../shared/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// 兼容两种运行方式：tsx 跑 server/（dist 在项目根），node 跑 dist-server/server/（dist 也在项目根）
const PROJECT_ROOT = existsSync(resolve(process.cwd(), 'package.json'))
  ? process.cwd()
  : resolve(HERE, '..', '..');
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');

export interface AppDeps {
  provider: LlmProvider;
  fallback: LlmProvider;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return payload;
  });

  app.get('/api/health', async () => ({
    ok: true,
    mock: isMockMode(),
    model: isMockMode() ? 'mock' : modelName(),
    roles: ROLES.length,
  }));

  app.get('/api/llm-usage', async () => getLlmUsage());

  app.get('/api/scenario', async () => ({
    topic: SCENARIO.topic,
    brief: SCENARIO.brief,
    options: SCENARIO.options,
    roles: ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title,
      color: r.color,
      focus: r.focus,
      style: r.style,
    })),
  }));

  // ---------- 创建会话：异步跑 stage 1~3 ----------
  app.post('/api/sessions', async (_req, reply) => {
    const id = newSessionId();
    const session: Session = {
      id,
      topic: SCENARIO.topic,
      options: SCENARIO.options,
      status: 'queued',
      createdAt: new Date().toISOString(),
      durationMs: 0,
      llmMode: isMockMode() ? 'mock' : 'live',
      events: [],
      roles: [],
      metrics: {
        durationMs: 0,
        eventCount: 0,
        stanceChanges: 0,
        confidence: 0,
        llmCalls: 0,
        promptTokens: 0,
        completionTokens: 0,
      },
      stages: [],
    };
    createBus(id);
    await saveSession(session);
    startSession({ provider: deps.provider, fallback: deps.fallback, session });
    reply.code(202);
    return { id, status: session.status };
  });

  app.get('/api/sessions', async () => {
    const items = await listSessions();
    return { items };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = await getSession(req.params.id);
    if (!session) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return session;
  });

  // ---------- 人工确认点：确认后跑裁决 ----------
  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/api/sessions/:id/verdict',
    async (req, reply) => {
      const session = await getSession(req.params.id);
      if (!session) {
        reply.code(404);
        return { error: 'not_found' };
      }
      if (session.status !== 'awaiting_review') {
        reply.code(409);
        return { error: 'not_awaiting_review', status: session.status };
      }
      startVerdict({ provider: deps.provider, fallback: deps.fallback, session }, req.body?.note);
      reply.code(202);
      return { id: session.id, status: 'running' };
    },
  );

  // ---------- SSE ----------
  app.get<{ Params: { id: string } }>('/api/sessions/:id/stream', async (req, reply) => {
    const session = await getSession(req.params.id);
    if (!session) {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 先订阅再回放：mock 阶段毫秒级跑完，先回放后订阅会丢掉中间事件
    const bus = getBus(session.id) ?? createBus(session.id);
    const buffer: Array<{ kind: string; data: unknown }> = [];
    let live = false;
    const onMessage = (payload: { kind: string; data: unknown }) => {
      if (!live) {
        buffer.push(payload);
        return;
      }
      if (payload.kind === 'event') send('debate-event', payload.data);
      else if (payload.kind === 'status') send('status', payload.data);
      else send('message', payload.data);
    };
    bus.on('message', onMessage);

    const latest = (await getSession(session.id)) ?? session;
    send('snapshot', latest);
    const replayed = latest.events.length;
    for (const ev of latest.events) send('debate-event', ev);
    send('status', {
      status: latest.status,
      message: latest.status === 'awaiting_review' ? '等待人工确认' : undefined,
    });

    // 冲刷订阅期间缓存的实时事件（按 seq 去重，避免与快照重复）
    live = true;
    for (const payload of buffer) {
      const event = payload.data as { seq?: number } | undefined;
      if (
        payload.kind === 'event' &&
        typeof event?.seq === 'number' &&
        event.seq <= replayed
      ) {
        continue;
      }
      if (payload.kind === 'event') send('debate-event', payload.data);
      else if (payload.kind === 'status') send('status', payload.data);
    }
    buffer.length = 0;

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    heartbeat.unref?.();

    // 注意：不能用 req.raw 的 'close' —— GET 请求体读完就会立即触发，会把流提前掐断；
    // 只有响应端的 'close' 才代表客户端真的断开了
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      bus.off('message', onMessage);
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    };
    reply.raw.on('close', close);
    reply.raw.on('error', close);
    req.raw.on('aborted', close);
  });

  // ---------- 静态资源（生产） ----------
  if (existsSync(DIST_DIR)) {
    await app.register(fastifyStatic, { root: DIST_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404);
        return reply.send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export { DEBATER_IDS, ROLE_MAP };
