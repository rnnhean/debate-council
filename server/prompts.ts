import type { RoleId, StanceId } from '../shared/types.js';
import { DEBATER_IDS, ROLE_MAP, ROLES } from './roles.js';
import { SCENARIO } from './scenario.js';

const OPTION_LINES = (Object.keys(SCENARIO.options) as StanceId[])
  .map((id) => {
    const o = SCENARIO.options[id];
    return `- ${id}：${o.title}。${o.summary}（预算 ${o.budget}）`;
  })
  .join('\n');

export function scenarioBlock(): string {
  return [
    `议题：${SCENARIO.topic}`,
    `背景：${SCENARIO.brief}`,
    '候选方案：',
    OPTION_LINES,
  ].join('\n');
}

export function rosterBlock(): string {
  return ROLES.filter((r) => r.id !== 'judge')
    .map((r) => `${r.id}（${r.name}）：${r.persona} 关注：${r.focus.join('、')}；风格：${r.style}。`)
    .join('\n');
}

export function openingSystem(roleId: RoleId): string {
  const role = ROLE_MAP[roleId];
  return [
    `你是「${role.name}」（${role.title}）。`,
    role.persona,
    `你的说话风格：${role.style}。`,
    '你正在参加一场多角色决策辩论，现在是第一轮：独立陈述立场。你看不到其他人的观点。',
    '要求：先给判断，再给证据，最后给一个你愿意为之负责的止损条件。不要超过 160 字。',
  ].join('\n');
}

export function openingUser(roleId: RoleId): string {
  return [
    'STAGE=opening',
    scenarioBlock(),
    '',
    `请以 role="${roleId}" 的身份，从 A / B / C 中选一个方案作为你的开局立场，并给出 2~3 条理由。`,
    '严格输出 JSON：{"role":"<roleId>","stance":"A|B|C","confidence":0.0-1.0,"text":"<观点原文>","reasons":["<理由1>","<理由2>","<理由3>"]}',
  ].join('\n');
}

export function batchOpeningSystem(): string {
  return [
    '你是一个多角色辩论模拟器。现在需要一次性生成 4 位辩论者的开局观点，他们互相看不到对方。',
    rosterBlock(),
    '要求：4 位角色的立场可以相同也可以不同，但每个角色都必须从自己关注点的角度给出独立判断，',
    '并且每位角色的观点要能被后面的人质疑（留出可攻击的假设）。每人不超过 160 字。',
  ].join('\n');
}

export function batchOpeningUser(): string {
  return [
    'STAGE=opening',
    scenarioBlock(),
    '',
    '请为以下 4 个角色各写一段开局观点：analyst（数据分析师）、business（业务分析师）、cost（成本官）、risk（风险官）。',
    '严格输出 JSON：',
    '{"items":[{"role":"analyst","stance":"A|B|C","confidence":0.0-1.0,"text":"...","reasons":["...","..."]}, ... 共 4 项]}',
  ].join('\n');
}

export interface OpeningItem {
  role: RoleId;
  stance: StanceId;
  confidence: number;
  text: string;
  reasons: string[];
}

export interface QuestionItem {
  role: RoleId;
  target: RoleId;
  text: string;
  focus: string;
}

export interface ReplyItem {
  role: RoleId;
  stance: StanceId;
  confidence: number;
  changed: boolean;
  fromStance: StanceId;
  text: string;
  reason: string;
}

export function transcriptBlock(
  openings: OpeningItem[],
  extra?: string,
): string {
  const lines = openings.map(
    (o) =>
      `【${ROLE_MAP[o.role].name} / ${o.role}】立场=${o.stance} 置信度=${o.confidence}：${o.text}`,
  );
  return [scenarioBlock(), '', '第一轮开局观点：', ...lines, extra ?? ''].join('\n');
}

export function questionsSystem(): string {
  return [
    '你是多角色辩论的主持人，负责生成第一轮交叉质询。',
    rosterBlock(),
    '规则：每位辩论者看到其他三人的开局观点后，向其中一位提出恰好 1 条质询。',
    '质询必须针对对方观点里一个具体的、可被验证或推翻的假设，不能是泛泛而谈。每条不超过 90 字。',
    '4 位辩手每人 1 条，不允许质询自己，4 条质询应尽量分散指向不同对象。',
  ].join('\n');
}

export function questionsUser(openings: OpeningItem[]): string {
  return [
    'STAGE=cross_exam_1',
    transcriptBlock(openings),
    '',
    '请输出第一轮质询。strict JSON：',
    '{"items":[{"role":"<提问者 roleId>","target":"<被质询者 roleId>","text":"<质询原文>","focus":"<质询的核心假设，6 字以内>"}, ... 共 4 项]}',
  ].join('\n');
}

export function repliesSystem(): string {
  return [
    '你是多角色辩论的主持人，负责生成本轮回应。',
    rosterBlock(),
    '规则：每位辩论者面对针对自己的质询，必须正面回应。',
    '如果质询击穿了你开局观点的关键假设，你必须调整立场并说明触发原因；如果没有击穿，维持立场并说明为什么。',
    '本轮允许且鼓励出现立场变化，但每次变化都必须写出「哪条质询 + 哪个数字/事实」导致的。每人不超过 150 字。',
  ].join('\n');
}

export function repliesUser(
  openings: OpeningItem[],
  questions: QuestionItem[],
): string {
  const qLines = questions.map(
    (q) =>
      `【${ROLE_MAP[q.role].name} → ${ROLE_MAP[q.target].name}】质询（核心假设：${q.focus}）：${q.text}`,
  );
  return [
    'STAGE=cross_exam_2',
    transcriptBlock(openings, ['', '第一轮质询：', ...qLines].join('\n')),
    '',
    '请输出 4 位辩手各自的回应。strict JSON：',
    '{"items":[{"role":"<回应者 roleId>","stance":"A|B|C","confidence":0.0-1.0,"changed":true|false,"fromStance":"A|B|C","text":"<回应原文>","reason":"<若 changed 为 true，写明触发变化的质询与原因；否则写维持理由>"}, ... 共 4 项]}',
  ].join('\n');
}

export function verdictSystem(): string {
  return [
    '你是这场决策辩论的独立裁决者，不参与前面的发言。',
    ROLE_MAP['judge'].persona,
    '你必须只使用辩论记录里出现过的证据与数字，不得引入新数据。',
    '输出要求：一个选择（A/B/C）、恰好 3 条理由、0~1 的置信度、以及少数意见（必须点名持有该意见的角色）。',
  ].join('\n');
}

export function verdictUser(
  openings: OpeningItem[],
  questions: QuestionItem[],
  replies: ReplyItem[],
  reviewNote?: string,
): string {
  const qLines = questions.map(
    (q) => `【${ROLE_MAP[q.role].name} → ${ROLE_MAP[q.target].name}】${q.text}`,
  );
  const rLines = replies.map(
    (r) =>
      `【${ROLE_MAP[r.role].name}】${r.fromStance}${r.changed ? ` → ${r.stance}（立场变化）` : '（维持）'}：${r.text}`,
  );
  return [
    'STAGE=verdict',
    transcriptBlock(openings, ['', '第一轮质询：', ...qLines, '', '第二轮回应：', ...rLines].join('\n')),
    reviewNote ? `\n人工纠偏意见（必须正面回应，但不得据此编造证据）：${reviewNote}` : '',
    '',
    '请输出裁决。strict JSON：',
    '{"decision":"A|B|C","confidence":0.0-1.0,"reasons":["<理由1>","<理由2>","<理由3>"],"minority":{"role":"<roleId>","text":"<少数意见原文>"}}',
  ]
    .filter(Boolean)
    .join('\n');
}

export const DEBATER_ROLE_IDS = DEBATER_IDS;
