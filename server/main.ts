import { loadEnv } from './env.js';

// 必须最先执行：ESM 的 import 会先求值，所以 llm.ts 里的环境变量一律在调用时才读
loadEnv();

import { buildApp } from './app.js';
import { createProvider, isMockMode, modelName, type LlmProvider } from './llm.js';
import { DebateMockProvider } from './mock.js';

const PORT = Number(process.env.PORT || 5103);
const HOST = process.env.HOST || '127.0.0.1';

async function main() {
  const mock = new DebateMockProvider();
  const provider: LlmProvider = createProvider(mock);
  const app = await buildApp({ provider, fallback: mock });
  await app.listen({ port: PORT, host: HOST });
  // 只报模式与端口，不打印任何凭据
  console.log(
    `[debate-council] listening on http://${HOST}:${PORT} mode=${isMockMode() ? 'mock' : modelName()}`,
  );
}

main().catch((err) => {
  console.error('[debate-council] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
