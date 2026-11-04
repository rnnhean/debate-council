import type { LlmProvider, LlmRequest } from './llm.js';

/**
 * 确定性 Mock：同样的输入永远产出同样的输出。
 * 用于 smoke / 离线演示，不依赖网络与密钥。
 * 编排器在 user prompt 里写入 `STAGE=<stage>` 标记，Mock 据此分支。
 */
export class DebateMockProvider implements LlmProvider {
  name = 'mock';

  async complete(req: LlmRequest): Promise<string> {
    const stage = /STAGE=([a-z_0-9]+)/.exec(req.user)?.[1] ?? 'opening';
    switch (stage) {
      case 'opening':
        return JSON.stringify({ items: OPENING });
      case 'cross_exam_1':
        return JSON.stringify({ items: QUESTIONS });
      case 'cross_exam_2':
        return JSON.stringify({ items: REPLIES });
      case 'verdict':
        return JSON.stringify(VERDICT);
      default:
        return JSON.stringify({ items: [] });
    }
  }
}

const OPENING = [
  {
    role: 'analyst',
    stance: 'A',
    confidence: 0.71,
    text:
      '按上季度口径，全域投放的 CAC 是 46 元，私域召回是 31 元，但召回池只有 18 万可触达用户。若目标定在新增 60 万，只有 A 的渠道容量撑得住；代价是 CAC 会随量级上抬，我给出止损线：第 3 周 CAC 超过 62 元就砍量。',
    reasons: ['渠道容量足够覆盖 60 万新增', 'CAC 基准 46 元，仍低于 LTV 的 1/3', '有明确的周维度止损口径'],
  },
  {
    role: 'business',
    stance: 'B',
    confidence: 0.66,
    text:
      '只看新增会漏掉复购。B 的联营能把品牌活动塞进用户已经在用的垂类场景里，复购链路更短。我担心的不是花不出去，是花出去之后用户不来第二次——B 至少把第二次触达写进了合作条款。',
    reasons: ['复购链路与品牌资产可复利', '联营方自带场景流量', '合作条款可约定二次触达'],
  },
  {
    role: 'cost',
    stance: 'C',
    confidence: 0.78,
    text:
      'A 要吃掉 420 万，占季度预算的 78%，一旦第 3 周数据不达标，剩下 12% 的预算连补救都做不了。C 只花 220 万，把 320 万留成机动预算，而且私域召回的 CAC 最低。我要求在方案里写死熔断线。',
    reasons: ['预算占用 78%，容错空间过小', '私域 CAC 最低，下行可控', '保留机动预算便于中途纠偏'],
  },
  {
    role: 'risk',
    stance: 'C',
    confidence: 0.62,
    text:
      '合规上，A 的信息流素材要走二次审核，KOL 口播的舆情连带责任很难切割；B 的联营合同里有排他条款，法务至少要 10 个工作日。C 的执行链路最短、外部依赖最少，风险敞口最小。',
    reasons: ['A 的素材与 KOL 舆情风险不可控', 'B 的排他条款压缩谈判窗口', 'C 的外部依赖最少'],
  },
];

const QUESTIONS = [
  {
    role: 'analyst',
    target: 'business',
    text:
      'B 的复购 +8pt 是基于哪一份基线？如果基线是去年同期的联营活动，样本量和口径是否可比？没有口径的复购提升我不能采信。',
    focus: '复购基线口径',
  },
  {
    role: 'business',
    target: 'cost',
    text:
      'C 保留 320 万机动预算，但这笔钱在季度内真的能二次立项吗？如果流程上批不下来，机动预算就是纸面数字。',
    focus: '机动预算可执行性',
  },
  {
    role: 'cost',
    target: 'analyst',
    text:
      'A 的 CAC 46 元是按上季度平均量级算的，量级翻倍后边际 CAC 通常上涨 20%~35%。你的止损线 62 元是否已经包含这个上浮？',
    focus: '量级放大后的边际成本',
  },
  {
    role: 'risk',
    target: 'analyst',
    text:
      'A 的 3 周起量意味着素材要在 5 个工作日内过审。如果审核退回一次，起量窗口就废了，这个执行风险你打算怎么覆盖？',
    focus: '审核窗口与执行链路',
  },
];

const REPLIES = [
  {
    role: 'analyst',
    stance: 'B',
    confidence: 0.64,
    changed: true,
    fromStance: 'A',
    text:
      '成本官问得对：量级翻倍后边际 CAC 我按 +28% 重算，A 的实际 CAC 会到 59 元，离止损线只剩 3 元缓冲。这个缓冲不足以支撑 420 万的下注，我把立场调整为 B，但要求 B 的联营必须带可验证的二次触达指标。',
    reason: '边际 CAC 上浮 28% 后 A 的容错空间不足',
  },
  {
    role: 'business',
    stance: 'B',
    confidence: 0.72,
    changed: false,
    fromStance: 'B',
    text:
      '复购基线用的是今年 Q2 同垂类联营活动，样本 12.4 万，口径与本次一致；我会把基线写进立项材料，接受数据团队复核。机动预算的质疑我认一半，所以 B 的 360 万里预留 40 万做二次触达的兜底。',
    reason: '补充基线口径，维持 B',
  },
  {
    role: 'cost',
    stance: 'B',
    confidence: 0.58,
    changed: true,
    fromStance: 'C',
    text:
      '如果机动预算确实批不下来，那 C 的优势就少了一半。B 愿意把二次触达兜底写进预算，我接受把主方案改成 B，但必须同时保留 C 的熔断条款：月度 ROI 低于 1.2 就停止追加。',
    reason: 'C 的机动预算可执行性被质疑，B 提供了兜底条款',
  },
  {
    role: 'risk',
    stance: 'C',
    confidence: 0.6,
    changed: false,
    fromStance: 'C',
    text:
      'A 的审核风险没有正面回答，所以我仍然不支持 A。B 的排他条款我要求压缩到 3 家平台中的 1 家，法务窗口才能压到 7 个工作日。这一条不满足，我的立场就停在 C。',
    reason: 'A 的风险未回应；B 需压缩排他条款',
  },
];

const VERDICT = {
  decision: 'B',
  confidence: 0.73,
  reasons: [
    '成本官指出的边际 CAC 上浮使 A 的容错空间只剩 3 元，A 的高预算下注在执行风险上不成立',
    '数据分析师调整立场后，B 获得了「渠道容量 + 复购链路」两侧的证据支持',
    'B 愿意把二次触达兜底与熔断条款写进预算，回应了成本官与风险官的核心关切',
  ],
  minority: {
    role: 'risk',
    text:
      '风险官坚持 C：B 的排他条款尚未压缩到 7 个工作日窗口，若法务延期，B 的启动时点将晚于 Q4 活动窗口，届时 C 是唯一可执行方案。',
  },
};
