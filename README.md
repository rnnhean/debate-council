# debate-council · 多 Agent 辩论决策系统

**一句话定位**：把一个「预算怎么花」的模糊决策，拆成 4 个立场互斥的角色各自开局、两轮交叉质询、人工确认后由独立裁决者收敛——全过程事件级落库、可回放、可量化。

业务场景固定为「Q4 季度市场活动方案该选哪个」：A 全域增长投放（420 万）/ B 渠道协同联营（360 万）/ C 预算收敛 + 私域深耕（220 万）。

---

## 一、它到底在解决什么

单次 LLM 问「该选 A 还是 B」，得到的是一个**没有对手**的答案。这个项目把决策过程显式化：

| 阶段 | 谁在说话 | 关键约束 |
| --- | --- | --- |
| `opening` 开局 | 数据分析师 / 业务分析师 / 成本官 / 风险官 | **互相不可见**，避免一开始就趋同 |
| `cross_exam_1` 质询 | 同一批 4 人 | 每人恰好 1 条质询，必须指向别人观点里一个**可被证伪的假设** |
| `cross_exam_2` 回应 | 同一批 4 人 | 正面回应质询；被击穿关键假设才允许改立场，且必须写清「哪条质询 + 哪个数字」 |
| —— 人工闸门 —— | 人 | 记录封存，人可以写一段纠偏意见再放行 |
| `verdict` 裁决 | 独立裁决者 | 只能引用辩论中出现过的证据，输出选择 / 3 条理由 / 置信度 / 少数意见 |

「人工闸门」不是装饰：裁决 prompt 会带上人的纠偏意见，且决议记录里保留 `review.note`，事后能区分「模型自己这么判的」和「人推着它这么判的」。

---

## 二、架构

```
┌──────────────────────────── 浏览器 (React 18 + Vite) ────────────────────────────┐
│  左侧会话列表    中间辩论流（按轮次分组）    右侧角色状态面板    底部裁决卡 + 指标条   │
│       │                 │                        │                     │            │
│       └────────────── EventSource（SSE）──────────┴─────────────────────┘            │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │ snapshot / debate-event / status 三种帧
┌───────────────────────────────────────▼─────────────────────────────────────────────┐
│                              Fastify 4 (server/app.ts)                                │
│  POST /api/sessions            建会话 → 立刻 202，编排异步跑                           │
│  GET  /api/sessions            会话列表（只读摘要）                                    │
│  GET  /api/sessions/:id        单场详情（含 events / stages / metrics）                │
│  GET  /api/sessions/:id/stream SSE 事件流（先补历史再转实时）                           │
│  POST /api/sessions/:id/verdict 人工确认 + 可选纠偏意见 → 触发裁决                     │
│  GET  /api/llm-usage           只返回数字：calls / promptTokens / completionTokens      │
│  GET  /api/health              模式探针（mock 或模型名，不含任何凭据）                  │
└──────────────────────────┬───────────────────────────────┬──────────────────────────┘
                           │                               │
              ┌────────────▼────────────┐     ┌────────────▼─────────────┐
              │ orchestrator.ts 状态机   │     │ bus.ts 每会话一个 EventEmitter │
              │ opening → exam1 → exam2  │     │ 事件带 seq，前端按 seq 去重    │
              │ → awaiting_review → verdict │   └──────────────────────────┘
              └────────────┬────────────┘
                           │ 每阶段一次「批量」调用
              ┌────────────▼────────────┐     ┌──────────────────────────┐
              │ llm.ts 适配层            │     │ store.ts                 │
              │ LLM_MODE=mock → Mock     │     │ data/sessions/<id>.json  │
              │ 否则 OpenAI 兼容接口      │     │ 内存缓存 + tmp→rename 原子写 │
              │ 4xx/超时 → 降级 Mock 一次 │     └──────────────────────────┘
              └─────────────────────────┘
```

单次辩论只有 **4 次模型调用**（不是 12 次）：一次拿 4 条开局、一次拿 4 条质询、一次拿 4 条回应、一次拿裁决。后端拿到整批 JSON 后**拆成逐角色事件**推 SSE，前端看到的仍是「一个人说完下一个说」的节奏。

---

## 三、启动

要求 Node 20、pnpm。本机 Node 20 用 nvm 管理：

```bash
export PATH="/c/Users/v-renhan/AppData/Local/nvm/v20.19.5:$PATH"

pnpm install
pnpm dev        # 开发：Fastify 5103 + Vite 5173（/api 反代到 5103）
```

生产模式：

```bash
pnpm build      # tsc -p tsconfig.server.json && vite build
pnpm start      # Fastify 直接托管 dist/，默认 http://127.0.0.1:5103
```

离线/确定性测试（**推荐日常都用这个**）：

```bash
pnpm smoke      # 内部以 LLM_MODE=mock 起服务、发起会话、断言裁决与立场变化、退出码非 0 即失败
LLM_MODE=mock pnpm dev    # 手动点界面也走 Mock，不消耗额度
```

**模型模式说明**：默认走真实模型（OpenAI 兼容接口，本机实测 `qwen-plus`）。凭据由 `server/env.ts` 从固定路径按白名单读取 3 个变量，不进仓库、不打印、不回传前端；没有 key 或显式 `LLM_MODE=mock` 时自动使用确定性 Mock。真实调用出现 429 / 余额不足 / 任意 4xx 时**不重试**，直接降级 Mock 并把该阶段标记为 `degraded`，页面上的「模型模式」指标会如实反映。

### 环境变量（可选）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PORT` / `HOST` | `5103` / `127.0.0.1` | 监听地址 |
| `LLM_MODE` | 空 | 设为 `mock` 强制离线 |
| `DEBATE_ROOT` | 含 `package.json` 的 cwd | 数据目录根（`data/sessions`） |

---

## 四、目录

```
debate-council/
├── server/
│   ├── main.ts          进程入口：先 loadEnv() 再建 app（ESM import 先于执行，所以环境变量一律调用时读）
│   ├── app.ts           Fastify 路由 + SSE 端点 + dist 静态托管
│   ├── orchestrator.ts  四阶段编排、阶段元信息、失败降级、事件落库
│   ├── prompts.ts       各阶段 system/user prompt（含人工纠偏意见注入）
│   ├── roles.ts         5 个角色：倾向、关注点、说话风格、色板、persona
│   ├── scenario.ts      议题与 A/B/C 三个方案
│   ├── mock.ts          确定性 Mock（按 prompt 里的 STAGE= 标记分派）
│   ├── llm.ts           适配层 + 调用计数（只记数字）
│   ├── env.ts           白名单读 3 个变量，失败静默回退 Mock
│   ├── bus.ts           每会话一条事件总线，事件带自增 seq
│   └── store.ts         会话读写（内存缓存 + 原子写）
├── shared/types.ts      前后端共用类型（Session / DebateEvent / StageRecord / Verdict …）
├── src/
│   ├── App.tsx          三栏布局、发起/确认/回放、错误与运行态
│   ├── useDebateStream.ts  EventSource 封装：先 snapshot 再增量、按 seq 去重
│   ├── derive.ts        从事件推导每个角色的「当前立场 / 是否改变过」
│   ├── components/      辩论流、事件卡、角色面板、裁决卡、指标条、回放条
│   └── styles.css       手写暗色主题，1180px / 820px 两个断点
├── scripts/smoke.mjs    端到端冒烟（随机端口、taskkill 清理子进程）
└── data/sessions/       每场会话一个 JSON
```

### 数据文件长什么样

```jsonc
{
  "id": "dc-20261102220700828-2qfg",
  "status": "completed",
  "roles": [{ "id": "analyst", "stance": "C", "initialStance": "C", "changedCount": 0, "questions": 1, "replies": 1, "challengesReceived": 1 }],
  "events": [{ "seq": 1, "round": "opening", "type": "opening", "actor": "analyst", "stance": "C", "text": "…" }],
  "stages": [{ "stage": "opening", "status": "ok", "durationMs": 18456, "inputChars": 1087, "outputChars": 1397, "llmCalls": 1, "degraded": false }],
  "verdict": { "decision": "B", "confidence": 0.82, "reasons": ["…", "…", "…"], "minority": { "roleId": "analyst", "text": "…" } },
  "review": { "action": "approve", "note": "", "at": "2026-11-02T14:07:50.993Z" },
  "metrics": { "durationMs": 61902, "eventCount": 14, "stanceChanges": 0, "confidence": 0.82, "llmCalls": 4, "promptTokens": 5551, "completionTokens": 2698 }
}
```

---

## 五、实现时踩到的坑与取舍

**1. SSE 的两条竞态，都是线上会出现的**
一开始先 `await` 读快照、再挂总线监听——Mock 模式下整场辩论 1 秒内跑完，事件在订阅前就丢了，前端只看到 0 条。改成**先订阅、后补历史**：订阅后把实时消息先塞进 buffer，然后发 `snapshot` + 逐条重放历史事件 + `status`，最后 `live=true` 并把 buffer 按 `seq` 去重刷出去。
另一个坑是 `req.raw.on('close')`：GET 请求上它会立刻触发，流当场被关。清理必须挂在 `reply.raw.on('close')` 和 `req.raw.on('aborted')` 上。

**2. 落库：内存缓存 + tmp→rename**
编排器在写、SSE 和轮询在读，直接 `writeFile` 会先截断再写，并发读就会拿到半截 JSON，表现为偶发 404。改成「内存 Map 优先 + 临时文件 rename」后彻底消失；`getSession` 仍然保留从磁盘读的兜底，进程重启后数据不丢。

**3. 4 次调用 vs 12 次调用**
12 次分开调用更「像人」、实现也更直白，但每次都要重复塞场景和上下文，token 翻数倍。最终选择批量：一次拿 4 个角色的输出，后端按数组元素拆成事件。代价是**一个角色输出的格式错误会拖垮整批**——因此解析层做了容错（去 ``` 围栏、容忍前后废话、中文角色名映射到 id、「方案 A」还原成 `A`、置信度大于 1 按百分数处理），只要拿到至少一条可用数据就不整批失败。

**4. 降级不是静默**
真实模型 429 / 4xx / 超时一律**不重试**（预算有限，重试只会更糟），直接该阶段用确定性数据补一次，阶段记录打 `degraded: true` 并在事件流里插一条 system 事件说明「主模型不可用」。宁可让用户看到「这段是降级的」，也不能假装一切正常。

**5. 立场变化不硬造**
Mock 里固定 2 次立场变化（保证 smoke 可断言），真实模型则只给规则、不强制次数——实测那一场 4 人全部维持原立场，每个人的维持理由都点到了具体质询和数字。这是真实结果，没有为了「看起来热闹」去改 prompt 逼它改口。

**6. 回放与实时共用一个渲染器**
回放不是录屏，而是把已落库的事件按 `seq` 截断重放：`cursor=0` 到 `events.length` 之间取前 N 条，前端用同一套组件渲染，所以回放态和实时态看起来完全一致。角色面板的「当前立场」也是**从已渲染事件推导**的，不是读最终快照——回放到第 3 条时右栏就只显示前 3 条能推出的状态。

**7. 手写 CSS 而不是 UI 库**
只有一个需求：按角色一色、按轮次分组。引 UI 库反而要覆盖它的主题。用 CSS 变量定义 5 个角色色，事件卡左侧色条 + 圆形头像色块，窄屏（≤820px）三栏自动堆成单列。

---

## 六、实测

以下数字来自本机真实运行，不是估算。

**真实模型（qwen-plus）单场完整辩论，2026-11-02**

| 指标 | 数值 |
| --- | --- |
| 模型调用次数 | 4（opening / cross_exam_1 / cross_exam_2 / verdict 各 1） |
| 失败调用 | 0 |
| prompt tokens | 5,551 |
| completion tokens | 2,698 |
| 总计 tokens | 8,249 |
| 端到端耗时（发起 → awaiting_review） | 50.1 s（三个阶段耗时累计，不含人工停留） |
| 端到端耗时（发起 → 裁决完成） | 61.9 s |
| 各阶段耗时 | opening 18.5 s / exam1 9.1 s / exam2 22.6 s / verdict 11.7 s |
| 单次调用最长延迟 | 11.7 s |
| 事件数 | 14（4 开局 + 4 质询 + 4 回应 + 1 封存 + 1 裁决） |
| 裁决结果 / 置信度 | B / 0.82 |
| 立场变化 | 0（4 人均维持，理由均指名具体质询与数字） |

**Mock 模式（`pnpm smoke`，用于回归）**

| 指标 | 数值 |
| --- | --- |
| 端到端耗时 | 31–34 ms（多次运行区间） |
| 事件数 | 17（含 2 条独立 `stance_change` 事件） |
| 裁决结果 / 置信度 | B / 0.73 |
| 立场变化 | 2 |
| 断言数 | 24 条，全部通过 |

观察：真实模型下立场变化为 0 并不代表辩论没发生——质询确实击穿了子假设（例如「用户访谈=强归因」），但四个角色都选择了「修正论据、保留结论」。这恰恰是多数真实决策会出现的形态：**结论稳定，边界条件被质询推着收紧**（如 B 方案新增第 12.3 条把 KOC 内容监管责任划给平台方）。

---

## 七、已知边界

- 议题写死在 `server/scenario.ts`，改议题需要改文件后重启（没做多议题管理，属于刻意收窄范围）。
- 会话数据只存本地 JSON，没有分页/归档，会话多了列表会变长。
- 单进程内存缓存 + 事件总线，天然只适合单实例；多实例需要外部 pub/sub。
- 人工闸门目前是「一次性放行」，没有多轮打回重议。
