import { useEffect, useState } from "react";
import type { SyncRunPublic } from "@erolib/shared";
import { api } from "../api";
import { IconRefresh } from "../components/Icons";

export function SyncPage() {
  const [runs, setRuns] = useState<SyncRunPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load(): Promise<void> {
    setRuns(await api.syncRuns());
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Sync</p>
          <h1>同步</h1>
          <p className="page-desc">
            默认每 4 小时自动同步各渠道收藏。可手动触发并查看同步历史。
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
          <h2>同步历史</h2>
          <span className="muted small">约 4 秒自动刷新</span>
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
