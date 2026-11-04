#!/usr/bin/env node
/**
 * smoke：以 LLM_MODE=mock 启动服务，跑完整一场辩论，断言：
 *   1. 有裁决结果（decision ∈ A/B/C，3 条理由，置信度 0..1）
 *   2. 至少 2 次立场变化
 *   3. 事件流按轮次齐全（opening 4 条 / question 4 条 / reply 4 条）
 *   4. SSE 能收到快照与实时事件
 *   5. 会话落库、列表、指标可用
 * 退出码非 0 即失败。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// 随机端口：避免上一次 smoke 残留进程占住固定端口，导致连到旧实例
const PORT = Number(process.env.SMOKE_PORT || 5200 + Math.floor(Math.random() * 300));
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const pass = (name, extra = '') => console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
const fail = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name} — ${detail}`);
};
function assert(name, cond, detail = '') {
  if (cond) pass(name, detail);
  else fail(name, detail || 'assertion failed');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server did not start within ${timeoutMs}ms`);
}

async function waitForStatus(id, wanted, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/sessions/${id}`);
    if (res.ok) {
      last = await res.json();
      if (wanted.includes(last.status)) return last;
    }
    await sleep(250);
  }
  throw new Error(
    `session ${id} did not reach ${wanted.join('/')} in ${timeoutMs}ms (last=${last?.status})`,
  );
}

/** 订阅 SSE，收集事件；收到 stopOn 里的状态或调用 close() 时结束 */
function openStream(id, stopOn = ['awaiting_review', 'completed', 'failed']) {
  const events = [];
  const statuses = [];
  const controller = new AbortController();
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });
  const finish = () => resolveDone({ events, statuses });

  (async () => {
    try {
      const res = await fetch(`${BASE}/api/sessions/${id}/stream`, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let eventName = 'message';
          const dataLines = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          let parsed;
          try {
            parsed = JSON.parse(dataLines.join('\n'));
          } catch {
            continue;
          }
          if (eventName === 'debate-event') events.push(parsed);
          if (eventName === 'status') {
            statuses.push(parsed);
            if (stopOn.includes(parsed?.status)) {
              finish();
              return;
            }
          }
        }
      }
      finish();
    } catch (err) {
      // 主动 abort 或连接关闭都算正常结束
      if (!controller.signal.aborted) console.log(`  [debug] stream 读取异常: ${err?.message ?? err}`);
      finish();
    }
  })();

  return {
    events,
    statuses,
    close: () => controller.abort(),
    done,
  };
}

async function run() {
  console.log('[smoke] starting server with LLM_MODE=mock ...');
  const child = spawn(process.execPath, [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, LLM_MODE: 'mock', PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  const cleanup = () => {
    if (child.killed || !child.pid) return;
    try {
      // Windows 上 tsx 会再起子进程，必须连子进程树一起结束
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill('SIGTERM');
    }
  };
  process.on('exit', cleanup);

  try {
    const health = await waitForServer();
    assert('health 返回 ok', health.ok === true);
    assert('smoke 跑在 mock 模式', health.mock === true, `mode=${health.model}`);

    console.log('[smoke] creating session ...');
    const created = await fetch(`${BASE}/api/sessions`, { method: 'POST' }).then((r) => r.json());
    assert('创建会话返回 id', typeof created.id === 'string' && created.id.length > 6, created.id);

    const stream = openStream(created.id);
    const mid = await waitForStatus(created.id, ['awaiting_review', 'completed', 'failed']);
    assert('阶段 1~3 到达 awaiting_review', mid.status === 'awaiting_review', `status=${mid.status}`);

    const { events } = await stream.done;
    stream.close();
    const openingEvents = events.filter((e) => e.type === 'opening');
    const questionEvents = events.filter((e) => e.type === 'question');
    const replyEvents = events.filter((e) => e.type === 'reply');
    const changeEvents = events.filter((e) => e.type === 'stance_change');

    assert('SSE 推送了 opening 事件', openingEvents.length === 4, `${openingEvents.length} 条`);
    assert('SSE 推送了质询事件', questionEvents.length === 4, `${questionEvents.length} 条`);
    assert('SSE 推送了回应事件', replyEvents.length === 4, `${replyEvents.length} 条`);
    assert(
      'SSE 推送了立场变化事件',
      changeEvents.length >= 2,
      `${changeEvents.length} 次变化`,
    );
    assert(
      '质询带有指向对象',
      questionEvents.every((e) => typeof e.target === 'string' && e.target !== e.actor),
      'target 字段完整',
    );

    // 人工确认点 -> 裁决
    console.log('[smoke] approving review and running verdict ...');
    const verdictStream = openStream(created.id, ['completed', 'failed']);
    const res = await fetch(`${BASE}/api/sessions/${created.id}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '请特别说明风险官的意见如何被处理。' }),
    });
    assert('裁决接口接受人工确认', res.status === 202, `HTTP ${res.status}`);

    const final = await waitForStatus(created.id, ['completed', 'failed']);
    const vEvents = await verdictStream.done;
    verdictStream.close();

    assert('会话最终 completed', final.status === 'completed', `status=${final.status}`);
    assert(
      'SSE 也推送了裁决事件',
      vEvents.events.some((e) => e.type === 'verdict'),
      `${vEvents.events.length} 条事件`,
    );

    const verdict = final.verdict;
    assert('裁决有选择', ['A', 'B', 'C'].includes(verdict?.decision), `decision=${verdict?.decision}`);
    assert('裁决有 3 条理由', Array.isArray(verdict?.reasons) && verdict.reasons.length === 3, `${verdict?.reasons?.length} 条`);
    assert(
      '裁决置信度在 0~1',
      typeof verdict?.confidence === 'number' && verdict.confidence > 0 && verdict.confidence <= 1,
      `confidence=${verdict?.confidence}`,
    );
    assert('裁决含少数意见', Boolean(verdict?.minority?.roleId), verdict?.minority?.roleId ?? '无');

    assert(
      '立场变化次数 >= 2',
      final.metrics.stanceChanges >= 2,
      `stanceChanges=${final.metrics.stanceChanges}`,
    );
    assert('指标含耗时', final.metrics.durationMs > 0, `${final.metrics.durationMs}ms`);
    assert('指标含事件数', final.metrics.eventCount === final.events.length, `${final.metrics.eventCount} 条`);
    assert('记录了 4 个阶段', final.stages.length === 4, final.stages.map((s) => s.stage).join(','));
    assert(
      '每阶段记录了耗时',
      final.stages.every((s) => typeof s.durationMs === 'number' && s.status === 'ok'),
      final.stages.map((s) => `${s.stage}:${s.durationMs}ms`).join(' '),
    );

    const list = await fetch(`${BASE}/api/sessions`).then((r) => r.json());
    assert(
      '会话出现在列表里',
      Array.isArray(list.items) && list.items.some((s) => s.id === final.id),
      `${list.items?.length ?? 0} 个会话`,
    );

    const usage = await fetch(`${BASE}/api/llm-usage`).then((r) => r.json());
    assert(
      'llm-usage 只暴露数字字段',
      typeof usage.calls === 'number' && typeof usage.promptTokens === 'number',
      `calls=${usage.calls}`,
    );

    const dir = resolve(ROOT, 'data/sessions');
    assert('数据落库到 data/sessions', existsSync(dir) && readdirSync(dir).length > 0);

    const summary = final.metrics;
    console.log(
      `\n[smoke] session=${final.id} decision=${verdict?.decision} confidence=${verdict?.confidence} ` +
        `changes=${summary.stanceChanges} events=${summary.eventCount} duration=${summary.durationMs}ms`,
    );
  } catch (err) {
    fail('smoke 执行异常', err instanceof Error ? err.message : String(err));
    if (serverLog) console.log('\n--- server log ---\n' + serverLog.slice(-4000));
  } finally {
    cleanup();
  }

  if (failures > 0) {
    console.log(`\n[smoke] FAILED: ${failures} 项断言未通过`);
    process.exit(1);
  }
  console.log('\n[smoke] PASSED');
  process.exit(0);
}

run();
