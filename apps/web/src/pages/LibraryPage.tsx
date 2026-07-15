import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { IconClose, IconPlay, IconSearch, IconWave } from "../components/Icons";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载",
  queued: "队列中",
  downloading: "下载中",
  failed: "失败",
  discovered: "已发现",
};

export function LibraryPage() {
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<WorkPublic | null>(null);

  async function load(): Promise<void> {
    try {
      setError(null);
      setLoading(true);
      const data = await api.works({
        q: q || undefined,
        status: status || undefined,
      });
      setWorks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Library</p>
          <h1>媒体库</h1>
          <p className="page-desc">浏览已备份作品。仅「已下载」状态可播放。</p>
        </div>
        <div className="toolbar">
          <label className="field" style={{ minWidth: 220 }}>
            <span className="sr-only">搜索</span>
            <input
              placeholder="搜索标题 / 作者"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              aria-label="搜索标题或作者"
            />
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="按状态筛选"
            style={{ width: "auto", minWidth: 140 }}
          >
            <option value="">全部状态</option>
            <option value="downloaded">已下载</option>
            <option value="queued">队列中</option>
            <option value="downloading">下载中</option>
            <option value="failed">失败</option>
            <option value="discovered">已发现</option>
          </select>
          <button type="button" onClick={() => void load()}>
            <IconSearch width={16} height={16} />
            搜索
          </button>
        </div>
      </header>

      {error ? (
        <div className="alert-stack">
          <p className="error" role="alert">
            {error}
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="loading-block" role="status">
          <span className="spinner" />
          正在加载媒体库…
        </div>
      ) : works.length === 0 ? (
        <div className="empty-state">
          <IconWave width={36} height={36} />
          <strong>暂无作品</strong>
          <p>先去 Providers 绑定账号，再在「同步 / 任务」触发同步。</p>
          <div className="row">
            <Link to="/providers">
              <button type="button">配置 Provider</button>
            </Link>
            <Link to="/jobs">
              <button type="button" className="secondary">
                去同步
              </button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {works.map((w) => (
            <article className="work-card" key={`${w.provider}:${w.workId}`}>
              <div className="work-cover" aria-hidden>
                <span className="work-cover-badge">
                  <span className={`badge ${w.status}`}>
                    {STATUS_LABEL[w.status] ?? w.status}
                  </span>
                </span>
                <IconWave />
              </div>
              <div className="work-body">
                <Link
                  className="work-title"
                  to={`/works/${w.provider}/${w.workId}`}
                >
                  {w.title}
                </Link>
                <div className="work-meta">
                  {w.authorName ?? w.authorId ?? "未知作者"} · {w.provider}
                </div>
                <div className="work-meta">
                  远端收藏：{w.remoteInFavorites ? "是" : "否（本地保留）"}
                </div>
                <div className="work-actions">
                  <span className="badge soft">{w.provider}</span>
                  {w.status === "downloaded" ? (
                    <button type="button" onClick={() => setPlaying(w)}>
                      <IconPlay width={14} height={14} />
                      播放
                    </button>
                  ) : (
                    <span className="muted small">不可播</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {playing && playing.status === "downloaded" ? (
        <div className="player" role="region" aria-label="播放器">
          <div className="player-top">
            <div className="player-title">正在播放：{playing.title}</div>
            <button
              type="button"
              className="ghost icon-btn"
              aria-label="关闭播放器"
              onClick={() => setPlaying(null)}
            >
              <IconClose width={16} height={16} />
            </button>
          </div>
          <audio
            controls
            autoPlay
            src={api.audioUrl(playing.provider, playing.workId)}
          />
        </div>
      ) : null}
    </div>
  );
}
