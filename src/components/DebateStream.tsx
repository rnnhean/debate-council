import { ROUND_HINT, ROUND_LABEL } from '../meta';
import type { DebateEvent, RoundId } from '../types';
import { EventCard } from './EventCard';

const ROUNDS: RoundId[] = ['opening', 'cross_exam_1', 'cross_exam_2'];

interface Props {
  events: DebateEvent[];
  visibleCount?: number;
}

export function DebateStream({ events, visibleCount }: Props) {
  const visible =
    typeof visibleCount === 'number' ? events.filter((e) => e.seq <= visibleCount) : events;

  const systemVerdictEvents = visible.filter((e) => e.round === 'verdict' && e.type === 'system');

  return (
    <section className="stream">
      {ROUNDS.map((round) => {
        const roundEvents = visible.filter((e) => e.round === round);
        if (roundEvents.length === 0) return null;
        return (
          <div className="round" key={round}>
            <div className="round-head">
              <span className="round-label">{ROUND_LABEL[round]}</span>
              <span className="round-hint">{ROUND_HINT[round]}</span>
            </div>
            <div className="round-body">
              {roundEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        );
      })}

      {systemVerdictEvents.length > 0 ? (
        <div className="round">
          <div className="round-head">
            <span className="round-label">{ROUND_LABEL.verdict}</span>
            <span className="round-hint">{ROUND_HINT.verdict}</span>
          </div>
          <div className="round-body">
            {systemVerdictEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="stream-empty">
          还没有事件。点击「发起辩论」开始一场新的多角色决策。
        </div>
      ) : null}
    </section>
  );
}
