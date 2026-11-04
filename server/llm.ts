// 共用 LLM 适配层模板。复制到每个项目的 server/llm.ts
// 安全规则：本文件只读取指定的 3 个环境变量，任何情况下不得打印 key。
// .env 由 server/env.ts 在进程启动时加载（见 env-template.ts），不在源码里硬编码任何凭据。

export interface LlmRequest {
  system: string;
  user: string;
  json?: boolean;
}

export interface LlmProvider {
  name: string;
  complete(req: LlmRequest): Promise<string>;
}

/**
 * 注意：不能在这里把 MODEL / API key 固化成模块级常量。
 * ESM 的 import 会先于 main.ts 里的 loadEnv() 求值，模块级读取会拿到 undefined。
 * 一律在调用时读 process.env。
 */
function resolveModel(): string {
  return process.env.MODEL_NAME || 'gpt-4o-mini';
}

// ---------- 调用计数：只记数字，不含任何密钥信息 ----------
export interface LlmUsage {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastLatencyMs: number;
  lastError?: string;
}

const usage: LlmUsage = {
  calls: 0,
  failedCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  lastLatencyMs: 0,
};

export function getLlmUsage(): LlmUsage {
  return { ...usage };
}

/** 单次调用预算超限或出错时，流程编排会降级到 Mock 继续，而不是整场失败。 */
export class LlmQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmQuotaError';
  }
}

// ---------- Mock：确定性，离线可用 ----------
export class MockProvider implements LlmProvider {
  name = 'mock';
  async complete(_req: LlmRequest): Promise<string> {
    // 由各项目实现确定性伪输出，保证 smoke 可重复
    throw new Error('MockProvider must be implemented per project');
  }
}

// ---------- 真实模型：OpenAI 兼容接口 ----------
export class OpenAICompatibleProvider implements LlmProvider {
  name = 'openai-compatible';
  // 同样在调用时读，避免 import 阶段早于 loadEnv()
  private get apiKey() {
    return process.env.OPENAI_API_KEY || '';
  }
  private get baseUrl() {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  available() {
    return this.apiKey.length > 0;
  }

  async complete(req: LlmRequest): Promise<string> {
    const started = Date.now();
    const model = resolveModel();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          // 本项目的每次调用都是「4 个角色 / 4 条质询 / 4 条回应 / 1 份裁决」的批量 JSON，
          // 1600 会被截断导致解析失败，这里给足余量
          max_tokens: 2600,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      // 网络错误：只记状态，不打印请求头与 body
      usage.failedCalls += 1;
      usage.lastError = 'network';
      throw new LlmQuotaError('LLM network error');
    }

    usage.lastLatencyMs = Date.now() - started;

    if (!res.ok) {
      // 只报状态码，不打印请求头与 body
      usage.failedCalls += 1;
      usage.lastError = `HTTP ${res.status}`;
      // 429 / 余额不足 / 各类 4xx 一律不重试，由上层回退 Mock
      throw new LlmQuotaError(`LLM HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    usage.calls += 1;
    if (data?.usage) {
      usage.promptTokens += data.usage.prompt_tokens ?? 0;
      usage.completionTokens += data.usage.completion_tokens ?? 0;
      usage.totalTokens +=
        data.usage.total_tokens ??
        (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0);
    }
    return data?.choices?.[0]?.message?.content ?? '';
  }
}

// ---------- 工厂：有 key 用真模型，无 key 回退 Mock；LLM_MODE=mock 强制 Mock ----------
export function createProvider(mock: LlmProvider): LlmProvider {
  if (process.env.LLM_MODE === 'mock') return mock;
  const real = new OpenAICompatibleProvider();
  return real.available() ? real : mock;
}

export function isMockMode(): boolean {
  if (process.env.LLM_MODE === 'mock') return true;
  return !process.env.OPENAI_API_KEY;
}

export function modelName(): string {
  return resolveModel();
}
