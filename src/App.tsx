import { useCallback, useEffect, useMemo, useState } from 'react';
import { DebateStream } from './components/DebateStream';
import { MetricsBar } from './components/MetricsBar';
import { PlaybackBar } from './components/PlaybackBar';
import { RolePanel } from './components/RolePanel';
import { VerdictCard } from './components/VerdictCard';
import { deriveRoles, stanceChanges } from './derive';
import { STATUS_LABEL, STANCE_SHORT } from './meta';
import { useDebateStream } from './useDebateStream';
import type { SessionSummary } from './types';

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 回放
  const [replayMode, setReplayMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // 人工确认
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const live = useDebateStream(activeId);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const data = (await res.json()) as { items: SessionSummary[] };
      setSessions(data.items);
      setActiveId((current) => current ?? data.items[0]?.id ?? null);
    } catch {
      /* 网络异常时保持当前界面 */
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // 状态推进后刷新侧栏列表，避免显示创建时的旧状态
  const statusKey = `${live.session?.id ?? ''}:${live.status ?? ''}`;
  useEffect(() => {
    if (!live.session?.id) return;
    void loadSessions();
  }, [statusKey, live.session?.id, loadSessions]);

  const session = live.session;
  const allEvents = live.events;
  const totalEvents = allEvents.length;

  const isAwaiting = live.screenState === 'awaiting';

  // 回放与实时共用同一事件源，回放时只渲染 cursor 之前的事件
  const visibleCount = replayMode ? cursor : totalEvents;
  const visibleEvents = useMemo(
    () => allEvents.filter((e) => e.seq <= visibleCount),
    [allEvents, visibleCount],
  );

  const roles = useMemo(() => deriveRoles(visibleEvents), [visibleEvents]);
  const changes = useMemo(() => stanceChanges(visibleEvents), [visibleEvents]);
  const activeRole = visibleEvents.length
    ? visibleEvents[visibleEvents.length - 1].actor
    : null;

  // 播放定时器：每次前进一步，走完自动暂停
  useEffect(() => {
    if (!replayMode || !playing) return;
    const id = setInterval(() => {
      setCursor((c) => {
        if (c >= totalEvents) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 520 / speed);
    return () => clearInterval(id);
  }, [replayMode, playing, speed, totalEvents]);

  // 切换会话 / 新建时重置回放
  const resetPlayback = () => {
    setReplayMode(false);
    setPlaying(false);
    setCursor(0);
    setReviewNote('');
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { id: string };
      resetPlayback();
      setActiveId(data.id);
      await loadSessions();
    } catch {
      /* 创建失败时保持当前界面 */
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      await fetch(`/api/sessions/${session.id}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: reviewNote }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectSession = (id: string) => {
    resetPlayback();
    setActiveId(id);
  };

  const startReplay = () => {
    setReplayMode(true);
    setCursor(0);
    setPlaying(true);
  };

  const stageDurations = session?.stages?.map((s) => ({
    stage: s.stage,
    durationMs: s.durationMs,
  }));

  const verdictRevealed =
    Boolean(session?.verdict) &&
    (!replayMode || allEvents.some((e) => e.type === 'verdict' && e.seq <= visibleCount));

  const canReplay = Boolean(session) && allEvents.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DC</div>
          <div>
            <h1>Debate Council</h1>
            <p>多 Agent 辩论决策系统 · Q4 市场活动方案选型</p>
          </div>
        </div>

        <div className="topbar-actions">
          <span className={`conn conn-${live.connection}`}>
            {live.connection === 'live'
              ? '● 事件流已连接'
              : live.connection === 'connecting'
                ? '○ 连接中'
                : live.connection === 'error'
                  ? '● 连接异常'
                  : '○ 未连接'}
          </span>
          {canReplay && !replayMode ? (
            <button className="btn" onClick={startReplay}>
              ↺ 回放本次
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? '创建中…' : '发起辩论'}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-head">历史会话</div>
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  className={`session-item ${s.id === activeId ? 'session-item-active' : ''}`}
                  onClick={() => selectSession(s.id)}
                >
                  <div className="session-item-top">
                    <span className={`status status-${s.status}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                    {s.decision ? (
                      <span className="session-decision">{STANCE_SHORT[s.decision]}</span>
                    ) : null}
                  </div>
                  <div className="session-item-meta">
                    <span>{s.eventCount} 事件</span>
                    <span>{s.stanceChanges} 次变立场</span>
                    <span>{s.llmMode === 'mock' ? 'Mock' : '真实'}</span>
                  </div>
                  <div className="session-item-time">
                    {new Date(s.createdAt).toLocaleString('zh-CN')}
                  </div>
                </button>
              </li>
            ))}
            {sessions.length === 0 ? <li className="session-empty">暂无会话</li> : null}
          </ul>
        </aside>

        <main className="main">
          <div className="topic-card">
            <div className="topic-eyebrow">业务场景</div>
            <h2>{session?.topic ?? 'Q4 季度市场活动方案该选哪个？'}</h2>
            {session ? (
              <div className="option-grid">
                {(Object.keys(session.options) as Array<'A' | 'B' | 'C'>).map((key) => (
                  <div className="option" key={key}>
                    <span className="option-id">{key}</span>
                    <div>
                      <div className="option-title">{session.options[key].title}</div>
                      <div className="option-sub">{session.options[key].summary}</div>
                      <div className="option-budget">预算 {session.options[key].budget}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <MetricsBar
            durationMs={session?.metrics.durationMs ?? 0}
            eventCount={visibleEvents.length}
            stanceChanges={changes}
            confidence={verdictRevealed ? (session?.verdict?.confidence ?? 0) : 0}
            llmCalls={session?.metrics.llmCalls}
            mode={session?.llmMode}
            stageDurations={stageDurations}
          />

          {canReplay ? (
            <PlaybackBar
              replayMode={replayMode}
              total={totalEvents}
              cursor={Math.min(cursor, totalEvents)}
              playing={playing}
              speed={speed}
              onToggle={() => {
                if (!replayMode) {
                  startReplay();
                  return;
                }
                if (cursor >= totalEvents) setCursor(0);
                setPlaying((p) => !p);
              }}
              onStep={(delta) => {
                if (!replayMode) setReplayMode(true);
                setPlaying(false);
                setCursor((c) => Math.max(0, Math.min(totalEvents, c + delta)));
              }}
              onSeek={(value) => {
                if (!replayMode) setReplayMode(true);
                setPlaying(false);
                setCursor(value);
              }}
              onSpeed={setSpeed}
              onLive={() => {
                setPlaying(false);
                setReplayMode(false);
              }}
            />
          ) : null}

          {isAwaiting ? (
            <section className="review-card">
              <div className="review-head">
                <span className="review-badge">人工介入</span>
                <h3>辩论记录已就绪，确认后进入裁决</h3>
              </div>
              <p className="review-hint">
                这是流程中的审批点：可以补充一条纠偏意见（会注入裁决上下文），也可以直接确认。
              </p>
              <textarea
                className="review-note"
                placeholder="可选：给裁决者的纠偏意见，例如「请说明风险官的意见如何被处理」"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={2}
              />
              <div className="review-actions">
                <button className="btn btn-primary" onClick={handleApprove} disabled={submitting}>
                  {submitting ? '提交中…' : '确认并裁决'}
                </button>
                <span className="review-meta">{live.statusMessage || '辩论记录已封存'}</span>
              </div>
            </section>
          ) : null}

          {live.screenState === 'running' ? (
            <div className="running-banner">
              <span className="pulse" />
              正在生成辩论事件…
            </div>
          ) : null}

          {live.screenState === 'error' ? (
            <div className="error-banner">
              会话失败：{session?.error ?? '未知错误'}
              <button className="btn btn-ghost" onClick={handleCreate}>
                重试
              </button>
            </div>
          ) : null}

          <DebateStream events={allEvents} visibleCount={visibleCount} />

          <div className="verdict-wrapper">
            <VerdictCard
              verdict={
                session?.verdict ?? { decision: 'A', reasons: [], confidence: 0, minority: null }
              }
              options={session?.options}
              hidden={!verdictRevealed}
            />
          </div>
        </main>

        <RolePanel roles={roles} activeRole={activeRole} eventCount={visibleEvents.length} />
      </div>
    </div>
  );
}
