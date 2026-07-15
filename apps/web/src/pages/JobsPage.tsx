import { useEffect, useState } from "react";
import type { DownloadJobPublic, SyncRunPublic } from "@erolib/shared";
import { api } from "../api";
import { IconRefresh } from "../components/Icons";

export function JobsPage() {
  const [jobs, setJobs] = useState<DownloadJobPublic[]>([]);
  const [runs, setRuns] = useState<SyncRunPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load(): Promise<void> {
    const [j, r] = await Promise.all([api.jobs(), api.syncRuns()]);
    setJobs(j);
    setRuns(r);
  }

  useEffect(() => {
    void load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    const t = setInterval(() => {
      void load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const activeJobs = jobs.filter(
    (j) => j.state === "queued" || j.state === "running",
  ).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Operations</p>
          <h1>同步 / 下载任务</h1>
          <p className="page-desc">
            默认每 4 小时自动同步收藏。此处可手动触发并查看队列与历史。
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            disabled={syncing}
            onClick={() => {
              setMsg(null);
              setError(null);
              setSyncing(true);
              void api
                .sync()
                .then(() => {
                  setMsg("已触发全量同步");
                  return load();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setSyncing(false));
            }}
          >
            {syncing ? <span className="spinner" /> : null}
            立即同步全部
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void load()}
          >
            <IconRefresh width={16} height={16} />
            刷新
          </button>
        </div>
      </header>

      <div className="stat-pills" style={{ marginBottom: "1rem" }}>
        <span className="badge soft">队列 {jobs.length}</span>
        <span className="badge queued">进行中 {activeJobs}</span>
        <span className="badge soft">同步记录 {runs.length}</span>
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
          <h2>下载队列</h2>
          <span className="muted small">约 4 秒自动刷新</span>
        </div>
        {jobs.length === 0 ? (
          <div className="empty-state">
            <strong>队列为空</strong>
            <p>同步发现新收藏后，下载任务会出现在这里。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>作品</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>尝试</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.id}</td>
                    <td>
                      <strong>
                        [{j.provider}] {j.title ?? j.workId}
                      </strong>
                    </td>
                    <td>
                      <span className={`badge ${j.state}`}>{j.state}</span>
                    </td>
                    <td>
                      <div className="row">
                        <div
                          style={{
                            width: 80,
                            height: 6,
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            overflow: "hidden",
                          }}
                          aria-hidden
                        >
                          <div
                            style={{
                              width: `${Math.round(j.progress * 100)}%`,
                              height: "100%",
                              background: "linear-gradient(90deg,#fb923c,#f97316)",
                            }}
                          />
                        </div>
                        <span className="small muted">
                          {Math.round(j.progress * 100)}%
                        </span>
                      </div>
                    </td>
                    <td>{j.attempts}</td>
                    <td className="muted small">{j.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>同步历史</h2>
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">
            <strong>还没有同步记录</strong>
            <p>点击「立即同步全部」开始第一次收藏对账。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Provider</th>
                  <th>开始</th>
                  <th>结束</th>
                  <th>发现</th>
                  <th>入队</th>
                  <th>取消收藏标记</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.provider ?? "—"}</td>
                    <td className="small">{r.startedAt}</td>
                    <td className="small">{r.finishedAt ?? "…"}</td>
                    <td>{r.discovered}</td>
                    <td>{r.enqueued}</td>
                    <td>{r.markedNotFavorite}</td>
                    <td className="muted small">{r.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
