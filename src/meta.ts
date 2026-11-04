/** 前端展示用的角色元信息，与 server/roles.ts 保持一致 */
import type { RoleId, StanceId } from './types.js';

export const ROLE_META: Record<RoleId, { name: string; title: string; color: string; focus: string[] }> = {
  analyst: {
    name: '数据分析师',
    title: '增长数据 · 漏斗与 CAC',
    color: '#38bdf8',
    focus: ['新增漏斗', 'CAC / ROI', '样本量', '止损线'],
  },
  business: {
    name: '业务分析师',
    title: '渠道协同 · 用户链路',
    color: '#a78bfa',
    focus: ['渠道组合', '复购链路', '品牌资产', '合作方关系'],
  },
  cost: {
    name: '成本官',
    title: '预算效率 · 财务安全',
    color: '#fbbf24',
    focus: ['预算占用', '单客成本', '机动预算', '熔断机制'],
  },
  risk: {
    name: '风险官',
    title: '合规 · 舆情 · 执行风险',
    color: '#fb7185',
    focus: ['合规审查', '舆情连带', '合同条款', '执行链路'],
  },
  judge: {
    name: '裁决者',
    title: '独立裁决 · 汇总分歧',
    color: '#34d399',
    focus: ['证据强度', '分歧收敛', '可执行性', '少数意见'],
  },
};

export const ROUND_LABEL: Record<string, string> = {
  opening: '第一轮 · 独立开局',
  cross_exam_1: '第二轮 · 交叉质询',
  cross_exam_2: '第三轮 · 回应与立场调整',
  verdict: '第四轮 · 裁决',
};

export const ROUND_HINT: Record<string, string> = {
  opening: '4 位角色互不可见，各自独立给出立场',
  cross_exam_1: '看到他人观点后，每人提出 1 条质询',
  cross_exam_2: '被质询者回应，可调整或维持立场',
  verdict: '裁决者汇总证据，给出选择、理由、置信度与少数意见',
};

export const STANCE_LABEL: Record<StanceId, string> = {
  A: 'A · 全域增长投放',
  B: 'B · 渠道协同联营',
  C: 'C · 预算收敛 + 私域深耕',
};

export const STANCE_SHORT: Record<StanceId, string> = { A: 'A 方案', B: 'B 方案', C: 'C 方案' };

export const STANCE_COLOR: Record<StanceId, string> = {
  A: '#38bdf8',
  B: '#a78bfa',
  C: '#fbbf24',
};

export const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  awaiting_review: '等待人工确认',
  completed: '已完成',
  failed: '失败',
};
