interface Props {
  durationMs: number;
  eventCount: number;
  stanceChanges: number;
  confidence: number;
  llmCalls?: number;
  mode?: string;
  stageDurations?: Array<{ stage: string; durationMs: number }>;
}

const STAGE_LABEL: Record<string, string> = {
  opening: '开局',
  cross_exam_1: '质询',
  cross_exam_2: '回应',
  verdict: '裁决',
};

export function MetricsBar({
  durationMs,
  eventCount,
  stanceChanges,
  confidence,
  llmCalls,
  mode,
  stageDurations,
}: Props) {
  return (
    <div className="metrics">
      <div className="metric">
        <div className="metric-label">总耗时</div>
        <div className="metric-value">{formatMs(durationMs)}</div>
      </div>
      <div className="metric">
        <div className="metric-label">事件数</div>
        <div className="metric-value">{eventCount}</div>
      </div>
      <div className={`metric ${stanceChanges > 0 ? 'metric-hot' : ''}`}>
        <div className="metric-label">立场改变</div>
        <div className="metric-value">{stanceChanges} 次</div>
      </div>
      <div className="metric">
        <div className="metric-label">裁决置信度</div>
        <div className="metric-value">{confidence ? `${Math.round(confidence * 100)}%` : '—'}</div>
      </div>
      {typeof llmCalls === 'number' ? (
        <div className="metric">
          <div className="metric-label">LLM 调用</div>
          <div className="metric-value">{llmCalls}</div>
        </div>
      ) : null}
      {mode ? (
        <div className="metric">
          <div className="metric-label">模型模式</div>
          <div className="metric-value metric-value-sm">{mode === 'mock' ? 'Mock' : '真实模型'}</div>
        </div>
      ) : null}

      {stageDurations && stageDurations.length > 0 ? (
        <div className="metric-stages">
          {stageDurations.map((s) => (
            <span key={s.stage} className="stage-chip">
              {STAGE_LABEL[s.stage] ?? s.stage} {formatMs(s.durationMs)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function formatMs(ms: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}
