// 前后端共享类型统一来自 shared/types.ts，前端只额外补 UI 用到的元信息
export * from '../shared/types.js';

import type { RoleId, StanceId } from '../shared/types.js';

export interface RoleMeta {
  id: RoleId;
  name: string;
  title: string;
  color: string;
  focus: string[];
  style: string;
}

export interface ScenarioMeta {
  topic: string;
  brief: string;
  options: Record<StanceId, { title: string; summary: string; budget: string }>;
  roles: RoleMeta[];
}
