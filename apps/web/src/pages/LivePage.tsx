import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  LiveFolloweeAuthorPublic,
  LiveFolloweeHistoryPublic,
  LiveJobState,
  LiveOnairPublic,
  LiveRecordJobPublic,
} from "@erolib/shared";
import { api } from "../api";
import { IconPlay, IconRefresh } from "../components/Icons";
import { usePlayer } from "../player/PlayerContext";

export function LivePage() {
  const { play } = usePlayer();
  const [followees, setFollowees] = useState<LiveOnairPublic[]>([]);
  const [history, setHistory] = useState<LiveFolloweeAuthorPublic[]>([]);
  const [historyMeta, setHistoryMeta] = useState<
    Pick<LiveFolloweeHistoryPublic, "syncedAt" | "lastError" | "syncing">
  >({ syncedAt: null, lastError: null, syncing: false });
  const [jobs, setJobs] = useState<LiveRecordJobPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [followeeError, setFolloweeError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadJobs(): Promise<void> {
    setJobs(await api.liveJobs());
  }

  async function loadFollowees(): Promise<void> {
    try {
      setFollowees(await api.liveFollowees());
      setFolloweeError(null);
    } catch (e: unknown) {
      setFollowees([]);
      setFolloweeError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadHistory(): Promise<void> {
    setHistoryLoading(true);
    try {
      const data = await api.liveFolloweeHistory();
      setHistory(data.authors);
      setHistoryMeta({
        syncedAt: data.syncedAt,
        lastError: data.lastError,
        syncing: data.syncing,
      });
      setHistoryError(null);
    } catch (e: unknown) {
      setHistory([]);
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function refreshAll(): Promise<void> {
    await loadJobs();
    await Promise.all([loadFollowees(), loadHistory()]);
  }

  useEffect(() => {
    void refreshAll().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    const t = setInterval(() => {
      void loadJobs().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  async function onPoll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.livePoll();
      await loadJobs();
      await loadHistory();
      setMsg("已触发一轮检测");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteJob(job: LiveRecordJobPublic): Promise<void> {
    const label = job.title || job.roomId;
    if (
      !confirm(
        `删除录制任务「${label}」？进行中任务会先停止；关联媒体与音频一并删除，不可恢复。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.deleteLiveJob(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      setMsg("已删除录制任务");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const openJobs = jobs.filter((j) =>
    ["pending_media", "blocked", "recording", "discovered"].includes(j.state),
  ).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Otobanana Live</p>
          <h1>直播自动录制</h1>
          <p className="page-desc">
            查看关注在播与近期历史（只读），并管理录制任务。订阅作者请到「同步」页维护。
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void onPoll();
            }}
          >
            <IconRefresh width={16} height={16} />
            立即检测
          </button>
        </div>
      </header>

      <div className="stat-pills" style={{ marginBottom: "1rem" }}>
        <span className="badge queued">进行中任务 {openJobs}</span>
        <span className="badge soft">任务总计 {jobs.length}</span>
        <span className="badge soft">关注作者 {history.length}</span>
      </div>

      <div className="alert-stack">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {msg ? (
          <p className="ok" role="status">
            {msg}
          </p>
        ) : null}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>关注的人在播</h2>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void loadFollowees();
            }}
          >
            <IconRefresh width={14} height={14} />
            刷新
          </button>
        </div>
        {followeeError ? (
          <p className="muted small" role="status">
            无法加载关注直播：{followeeError}
            （请在 Providers 配置并测试 Otobanana 登录）
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>主播</th>
                <th>标题</th>
                <th>听众</th>
                <th>录制</th>
              </tr>
            </thead>
            <tbody>
              {followees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    当前无关注在播，或未登录
                  </td>
                </tr>
              ) : (
                followees.map((f) => (
                  <tr key={f.roomId}>
                    <td>
                      <div>
                        <strong>
                          {f.displayName || f.username || f.authorId}
                        </strong>
                      </div>
                      <div className="muted small">
                        {f.username ? `@${f.username}` : f.authorId}
                      </div>
                    </td>
                    <td>{f.title || "—"}</td>
                    <td>{f.listenerCount ?? "—"}</td>
                    <td>
                      {f.recordState ? (
                        <span
                          className={`badge ${jobBadgeClass(f.recordState)}`}
                          title={f.recordError || undefined}
                        >
                          {f.recordState}
                        </span>
                      ) : (
                        <span className="muted small">未录制</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>关注作者近期直播</h2>
        </div>
        <p className="muted small" style={{ marginBottom: "0.5rem" }}>
          数据来自本地缓存（后台约每 30 分钟同步官网关注列表与近期场次）。
          手动触发后台同步请到「设置」页。录制状态对照本地任务。
        </p>
        <p className="muted small" style={{ marginBottom: "0.75rem" }}>
          上次同步：{historyMeta.syncedAt || "尚未同步"}
          {historyMeta.syncing ? " · 同步进行中" : ""}
          {historyMeta.lastError
            ? ` · 上次错误：${historyMeta.lastError}`
            : ""}
        </p>
        {historyError ? (
          <p className="muted small" role="status">
            无法读取本地关注历史：{historyError}
            （请确认 server 已迁移数据库；可在设置页触发后台同步）
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>作者</th>
                <th>状态</th>
                <th>近期场次 / 录制</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    {historyLoading
                      ? "加载中…"
                      : "暂无关注作者数据，或未登录"}
                  </td>
                </tr>
              ) : (
                history.map((a) => (
                  <tr key={a.authorId}>
                    <td>
                      <div>
                        <strong>
                          {a.displayName || a.username || a.authorId}
                        </strong>
                      </div>
                      <div className="muted small">
                        {a.username ? `@${a.username}` : a.authorId}
                      </div>
                    </td>
                    <td>
                      {a.liveNow ? (
                        <span className="badge queued">直播中</span>
                      ) : (
                        <span className="badge soft">离线</span>
                      )}
                    </td>
                    <td>
                      {a.sessions.length === 0 ? (
                        <span className="muted small">暂无近期场次</span>
                      ) : (
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: "1.1rem",
                            listStyle: "disc",
                          }}
                        >
                          {a.sessions.map((s) => (
                            <li key={s.roomId} style={{ marginBottom: "0.35rem" }}>
                              <div>
                                {s.isOpen ? (
                                  <span className="badge queued">LIVE</span>
                                ) : null}{" "}
                                {s.title || "无标题"}
                                {s.isAdult ? (
                                  <span className="badge soft">R18</span>
                                ) : null}
                              </div>
                              <div className="muted small">
                                {formatRange(s.roomOpenAt, s.roomCloseAt)}
                                {" · "}
                                听众 {s.listenerCount ?? "—"}
                                {" · "}
                                {s.recordState ? (
                                  <span
                                    className={`badge ${jobBadgeClass(s.recordState)}`}
                                    title={s.recordError || undefined}
                                  >
                                    {s.recordState}
                                  </span>
                                ) : (
                                  "未录制"
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>录制任务</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>作者</th>
                <th>标题 / Room</th>
                <th>时间</th>
                <th>说明</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无任务
                  </td>
                </tr>
              ) : (
                jobs.map((j) => {
                  const canPlay =
                    j.state === "completed" && Boolean(j.mediaRelPath);
                  return (
                    <tr key={j.id}>
                      <td>
                        <span className={`badge ${jobBadgeClass(j.state)}`}>
                          {j.state}
                        </span>
                      </td>
                      <td>
                        <div>
                          {j.authorDisplayName ||
                            j.authorUsername ||
                            j.authorId}
                        </div>
                        <div className="muted small">{j.authorId}</div>
                      </td>
                      <td>
                        <div>{j.title || "—"}</div>
                        <div className="muted small" title={j.roomId}>
                          {j.roomId}
                        </div>
                      </td>
                      <td className="muted small">
                        <div>开始 {j.startedAt || j.createdAt}</div>
                        <div>更新 {j.updatedAt}</div>
                      </td>
                      <td className="muted small">{j.error || "—"}</td>
                      <td>
                        <div className="row" style={{ gap: "0.35rem" }}>
                          {canPlay ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  play({
                                    id: `live:${j.provider}:${j.roomId}`,
                                    kind: "live",
                                    title: j.title || j.roomId,
                                    subtitle:
                                      j.authorDisplayName ||
                                      j.authorUsername ||
                                      j.authorId ||
                                      undefined,
                                    src: api.liveAudioUrl(
                                      j.provider,
                                      j.roomId,
                                    ),
                                  })
                                }
                              >
                                <IconPlay width={14} height={14} />
                                播放
                              </button>
                              <Link to="/?type=live">
                                <button type="button" className="secondary">
                                  媒体库
                                </button>
                              </Link>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => {
                              void onDeleteJob(j);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function jobBadgeClass(state: string | LiveJobState): string {
  if (state === "recording" || state === "pending_media") return "queued";
  if (state === "completed") return "ok";
  if (state === "failed" || state === "blocked") return "error";
  return "soft";
}

function formatRange(
  openAt: string | null,
  closeAt: string | null,
): string {
  const open = openAt ? openAt.replace("T", " ").slice(0, 16) : "—";
  const close = closeAt ? closeAt.replace("T", " ").slice(0, 16) : "—";
  return `${open} → ${close}`;
}
