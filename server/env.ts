// 复制到每个项目的 server/env.ts —— 进程启动时加载凭据
// 规则：
//   1. 只读白名单里的 3 个变量，其余一律忽略
//   2. 不打印、不落盘、不回传给前端
//   3. 文件不存在或读不到就静默跳过，回退 Mock 模式
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve('D:/20260916/knowledge-hub-backend/.env');
const WHITELIST = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MODEL_NAME'] as const;

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (process.env.OPENAI_API_KEY) return;          // 已有环境变量优先，不覆盖
  let raw: string;
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return;                                        // 无权限/不存在 -> Mock
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (!(WHITELIST as readonly string[]).includes(key)) continue;   // 白名单之外直接丢弃
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) process.env[key] = val;
  }
  raw = '';
}

// 只返回布尔状态，绝不返回内容
export function llmStatus() {
  const key = process.env.OPENAI_API_KEY || '';
  return {
    configured: key.length > 0,
    keyFingerprint: key ? `len=${key.length}` : 'none',
    model: process.env.MODEL_NAME || 'gpt-4o-mini',
    baseUrlHost: (() => {
      try { return new URL(process.env.OPENAI_BASE_URL || '').host; } catch { return 'default'; }
    })(),
  };
}
