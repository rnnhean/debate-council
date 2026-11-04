import { ROLE_META, STANCE_COLOR, STANCE_SHORT } from '../meta';
import type { UiRoleState } from '../derive';

interface Props {
  roles: UiRoleState[];
  activeRole?: string | null;
  eventCount: number;
}

export function RolePanel({ roles, activeRole, eventCount }: Props) {
  return (
    <aside className="role-panel">
      <div className="panel-head">
        <h2>角色状态</h2>
        <span className="panel-count">已产生 {eventCount} 条事件</span>
      </div>

      <ul className="role-list">
        {roles.map((role) => {
          const meta = ROLE_META[role.id];
          const changed = role.changedCount > 0;
          return (
            <li
              key={role.id}
              className={`role-item ${activeRole === role.id ? 'role-item-active' : ''}`}
              style={{ '--role-color': meta.color } as React.CSSProperties}
            >
              <div className="role-item-top">
                <span className="role-dot" style={{ background: meta.color }} />
                <span className="role-name">{meta.name}</span>
                {role.stance ? (
                  <span
                    className="stance-badge"
                    style={{
                      color: STANCE_COLOR[role.stance],
                      borderColor: STANCE_COLOR[role.stance],
                    }}
                  >
                    {STANCE_SHORT[role.stance]}
                  </span>
                ) : (
                  <span className="stance-badge stance-badge-pending">待定</span>
                )}
              </div>
              <div className="role-item-sub">{meta.title}</div>

              <div className="role-metrics">
                <span>质询 {role.questions}</span>
                <span>回应 {role.replies}</span>
                <span>被质询 {role.challengesReceived}</span>
              </div>

              <div className={`role-change ${changed ? 'role-change-on' : ''}`}>
                {changed ? (
                  <>
                    立场已改变 {role.changedCount} 次 · 初始 {role.initialStance}
                  </>
                ) : role.initialStance ? (
                  <>立场未改变 · 初始 {role.initialStance}</>
                ) : (
                  <>尚未发言</>
                )}
              </div>

              <div className="role-focus">
                {meta.focus.map((f) => (
                  <span key={f} className="focus-tag">
                    {f}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="panel-foot">
        <span className="legend-dot" style={{ background: ROLE_META.judge.color }} />
        裁决者不参与前两轮，最后汇总证据
      </div>
    </aside>
  );
}
