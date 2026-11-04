import type { StanceId } from '../shared/types.js';

export interface OptionCard {
  title: string;
  summary: string;
  budget: string;
}

export interface Scenario {
  topic: string;
  brief: string;
  options: Record<StanceId, OptionCard>;
}

export const SCENARIO: Scenario = {
  topic: 'Q4 季度市场活动方案该选哪个？',
  brief:
    '公司 Q4 市场预算总额 540 万元，需要在三个方案中选定一个主攻方向。上季度新增用户环比 -6.2%，复购率持平，预算委员会要求本周内给出结论。',
  options: {
    A: {
      title: '全域增长投放',
      summary: '信息流 + KOL 集中投放，3 周内起量，目标新增用户 60 万。',
      budget: '420 万',
    },
    B: {
      title: '渠道协同联营',
      summary: '与 3 家垂类平台联合做主题活动，目标复购率 +8pt、新增 25 万。',
      budget: '360 万',
    },
    C: {
      title: '预算收敛 + 私域深耕',
      summary: '砍掉低效投放，聚焦老客召回与私域内容，目标 ROI 1.9。',
      budget: '220 万',
    },
  },
};

export const SCENARIO_OPTION_IDS: StanceId[] = ['A', 'B', 'C'];
