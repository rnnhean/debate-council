import { ROLE_META, STANCE_COLOR, STANCE_LABEL } from '../meta';
import type { Verdict } from '../types';

interface Props {
  verdict: Verdict;
  options?: Record<string, { title: string; summary: string; budget: string }>;
  hidden?: boolean;
}

export function VerdictCard({ verdict, options, hidden }: Props) {
  if (hidden) {
    return (
      <div className="verdict-card verdict-card-locked">
        <div className="verdict-locked-label">裁决尚未产生</div>
        <p>人工确认辩论记录后，裁决者会给出结论、理由、置信度与少数意见。</p>
      </div>
    );
  }

  const color = STANCE_COLOR[verdict.decision];
  const option = options?.[verdict.decision];
  const minorityMeta = verdict.minority ? ROLE_META[verdict.minority.roleId] : null;

  return (
    <div className="verdict-card" style={{ '--verdict-color': color } as React.CSSProperties}>
      <div className="verdict-top">
        <div>
          <div className="verdict-eyebrow">裁决结论</div>
          <div className="verdict-decision" style={{ color }}>
            {STANCE_LABEL[verdict.decision]}
          </div>
          {option ? (
            <div className="verdict-option-summary">
              {option.summary} · 预算 {option.budget}
            </div>
          ) : null}
        </div>
        <div className="confidence">
          <div className="confidence-head">
            <span>置信度</span>
            <strong>{Math.round(verdict.confidence * 100)}%</strong>
          </div>
          <div className="confidence-track">
            <div
              className="confidence-fill"
              style={{ width: `${Math.round(verdict.confidence * 100)}%`, background: color }}
            />
          </div>
        </div>
      </div>

      <ol className="verdict-reasons">
        {verdict.reasons.map((reason, i) => (
          <li key={i}>
            <span className="reason-index">{i + 1}</span>
            <span>{reason}</span>
          </li>
        ))}
      </ol>

      {verdict.minority && minorityMeta ? (
        <div
          className="minority"
          style={{ '--minority-color': minorityMeta.color } as React.CSSProperties}
        >
          <div className="minority-head">
            <span className="minority-tag">少数意见</span>
            <span className="minority-role">{minorityMeta.name}</span>
          </div>
          <p>{verdict.minority.text}</p>
        </div>
      ) : null}
    </div>
  );
}
