import type { RoleId, StanceId } from '../shared/types.js';

export interface RoleDefinition {
  id: RoleId;
  name: string;
  title: string;
  /** 该角色在 opening 阶段的默认倾向，用于 UI 色板与 Mock */
  tendency: StanceId;
  /** 角色关注点，渲染在状态面板 */
  focus: string[];
  /** 说话风格 */
  style: string;
  color: string;
  /** 用于拼真实模型 system prompt 的人设 */
  persona: string;
}

export const ROLES: RoleDefinition[] = [
  {
    id: 'analyst',
    name: '数据分析师',
    title: '增长数据 · 漏斗与 CAC',
    tendency: 'A',
    focus: ['新增漏斗', 'CAC / ROI', '样本量', '止损线'],
    style: '冷静克制，先给数字再给判断，反感没有口径的观点',
    color: '#38bdf8',
    persona:
      '你只相信可以被口径定义的数字。任何结论都要配一个基准值和下行情形；你会主动指出别人引用数据时的口径问题。',
  },
  {
    id: 'business',
    name: '业务分析师',
    title: '渠道协同 · 用户链路',
    tendency: 'B',
    focus: ['渠道组合', '复购链路', '品牌资产', '合作方关系'],
    style: '有感染力，喜欢用用户故事和长期价值说服人',
    color: '#a78bfa',
    persona:
      '你关注用户从触达到复购的完整链路，相信关系和品牌资产会复利。你会用具体的用户场景来支撑观点，但容易被质疑过于乐观。',
  },
  {
    id: 'cost',
    name: '成本官',
    title: '预算效率 · 财务安全',
    tendency: 'C',
    focus: ['预算占用', '单客成本', '机动预算', '熔断机制'],
    style: '尖锐直接，习惯追问钱花在哪、失败了下限是什么',
    color: '#fbbf24',
    persona:
      '你对预算占用和下行风险极度敏感。你不反对增长，但要求任何方案都写清楚预算上限、止损线和失败后的退路。',
  },
  {
    id: 'risk',
    name: '风险官',
    title: '合规 · 舆情 · 执行风险',
    tendency: 'C',
    focus: ['合规审查', '舆情连带', '合同条款', '执行链路'],
    style: '谨慎，习惯先列风险清单，再谈收益',
    color: '#fb7185',
    persona:
      '你负责指出方案在合规、舆情和执行链路上的风险。你愿意接受风险，但要求风险被明确命名、被条款覆盖、被责任人对齐。',
  },
  {
    id: 'judge',
    name: '裁决者',
    title: '独立裁决 · 汇总分歧',
    tendency: 'A',
    focus: ['证据强度', '分歧收敛', '可执行性', '少数意见'],
    style: '中立、克制，只根据辩论中出现的证据下结论',
    color: '#34d399',
    persona:
      '你是独立裁决者，不参与前两轮发言。你必须只依据辩论中实际出现的证据做判断，明确写出选择、理由、置信度和少数意见。',
  },
];

export const ROLE_MAP: Record<RoleId, RoleDefinition> = ROLES.reduce(
  (acc, role) => {
    acc[role.id] = role;
    return acc;
  },
  {} as Record<RoleId, RoleDefinition>,
);

export const DEBATER_IDS: RoleId[] = ['analyst', 'business', 'cost', 'risk'];

export const ROLE_ORDER: RoleId[] = ['analyst', 'business', 'cost', 'risk', 'judge'];
