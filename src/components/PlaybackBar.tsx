interface Props {
  replayMode: boolean;
  total: number;
  cursor: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onStep: (delta: number) => void;
  onSeek: (value: number) => void;
  onSpeed: (value: number) => void;
  onLive: () => void;
}

export function PlaybackBar({
  replayMode,
  total,
  cursor,
  playing,
  speed,
  onToggle,
  onStep,
  onSeek,
  onSpeed,
  onLive,
}: Props) {
  const atEnd = cursor >= total;
  const label = replayMode ? (atEnd ? '回放结束' : `回放 ${cursor}/${total}`) : `实时视图 · 共 ${total} 条`;

  return (
    <div className={`playback ${replayMode ? 'playback-replay' : ''}`}>
      <div className="playback-left">
        <button className="pb-btn" onClick={() => onStep(-1)} disabled={cursor <= 0} title="上一步">
          ◀
        </button>
        <button
          className="pb-btn pb-play"
          onClick={onToggle}
          title={playing ? '暂停' : replayMode ? '播放' : '开始回放'}
        >
          {playing ? '⏸' : atEnd && replayMode ? '↺' : '▶'}
        </button>
        <button className="pb-btn" onClick={() => onStep(1)} disabled={atEnd} title="下一步">
          ▶
        </button>
        <span className="playback-label">{label}</span>
      </div>

      <input
        className="playback-range"
        type="range"
        min={0}
        max={Math.max(total, 1)}
        value={cursor}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="回放进度"
      />

      <div className="playback-right">
        <div className="speed-group">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={`speed-btn ${speed === s ? 'speed-btn-on' : ''}`}
              onClick={() => onSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        <button className="pb-exit" onClick={onLive} disabled={!replayMode}>
          查看最新
        </button>
      </div>
    </div>
  );
}
