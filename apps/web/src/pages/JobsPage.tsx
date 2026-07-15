import { useEffect, useState } from "react";
import type { DownloadJobPublic } from "@erolib/shared";
import { api } from "../api";
import { IconRefresh } from "../components/Icons";

export function JobsPage() {
  const [jobs, setJobs] = useState<DownloadJobPublic[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setJobs(await api.jobs());
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
          <p className="page-kicker">Downloads</p>
          <h1>下载任务</h1>
          <p className="page-desc">查看下载队列进度与失败信息。同步请前往「同步」页。</p>
        </div>
        <div className="toolbar">
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
      </div>

      <div className="alert-stack">
        {error ? (
          <p className="error" role="alert">
            {error}
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
                              background:
                                "linear-gradient(90deg,#fb923c,#f97316)",
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
    </div>
  );
}
