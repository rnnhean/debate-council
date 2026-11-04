import type { DebateEvent } from '../types';
import { ROLE_META, STANCE_COLOR, STANCE_SHORT } from '../meta';

interface Props {
  event: DebateEvent;
  reveal?: boolean;
}

export function EventCard({ event }: Props) {
  const meta = ROLE_META[event.actor];
  const style = { '--role-color': meta.color } as React.CSSProperties;

  if (event.type === 'system') {
    return (
      <div className="event-system">
        <span className="event-system-dot" />
        <span>{event.text}</span>
      </div>
    );
  }

  if (event.type === 'stance_change') {
    return (
      <div className="stance-change" style={style}>
        <div className="stance-change-track">
          <span className="stance-chip" style={{ borderColor: STANCE_COLOR[event.fromStance ?? 'A'] }}>
            {STANCE_SHORT[event.fromStance ?? 'A']}
          </span>
          <span className="stance-arrow">→</span>
          <span
            className="stance-chip stance-chip-new"
            style={{ borderColor: STANCE_COLOR[event.toStance ?? 'A'] }}
          >
            {STANCE_SHORT[event.toStance ?? 'A']}
          </span>
        </div>
        <div className="stance-change-body">
          <strong>{meta.name}</strong> 改变立场
          {event.reason ? <span className="stance-change-reason">触发：{event.reason}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <article className={`event-card event-${event.type}`} style={style}>
      <header className="event-head">
        <span className="role-avatar" style={{ background: meta.color }} aria-hidden>
          {meta.name.slice(0, 1)}
        </span>
        <div className="event-ident">
          <span className="event-role">{meta.name}</span>
          <span className="event-role-title">{meta.title}</span>
        </div>
        {event.stance ? (
          <span
            className="event-stance"
            style={{ color: STANCE_COLOR[event.stance], borderColor: STANCE_COLOR[event.stance] }}
          >
            {STANCE_SHORT[event.stance]}
          </span>
        ) : null}
        <span className="event-type-tag">{typeLabel(event.type)}</span>
      </header>

      {event.type === 'question' && event.target ? (
        <div className="question-target">
          <span className="question-arrow">↳ 质询</span>
          <span
            className="question-target-name"
            style={{ color: ROLE_META[event.target].color }}
          >
            {ROLE_META[event.target].name}
          </span>
          {event.reason ? <span className="question-focus">核心假设：{event.reason}</span> : null}
        </div>
      ) : null}

      <blockquote className={event.type === 'question' ? 'quote quote-question' : 'quote'}>
        {event.text}
      </blockquote>

      {event.type === 'verdict' ? (
        <div className="verdict-inline">
          <span>裁决 → {event.stance ?? '-'}</span>
          <span>{event.reason}</span>
        </div>
      ) : null}
    </article>
  );
}

function typeLabel(type: DebateEvent['type']) {
  switch (type) {
    case 'opening':
      return '开局观点';
    case 'question':
      return '交叉质询';
    case 'reply':
      return '回应';
    case 'verdict':
      return '裁决';
    case 'stance_change':
      return '立场变化';
    default:
      return '系统';
  }
}
