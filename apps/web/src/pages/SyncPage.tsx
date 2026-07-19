import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  LiveSubscriptionPublic,
  ProviderAccountPublic,
  SyncRunPublic,
} from "@erolib/shared";
import { api } from "../api";
import { IconRefresh } from "../components/Icons";

type SyncTab = "subscribe" | "vod";

export function SyncPage() {
  const [tab, setTab] = useState<SyncTab>("subscribe");
  const [runs, setRuns] = useState<SyncRunPublic[]>([]);
  const [providers, setProviders] = useState<ProviderAccountPublic[]>([]);
  const [subs, setSubs] = useState<LiveSubscriptionPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toggleId, setToggleId] = useState<number | null>(null);

  async function loadRuns(): Promise<void> {
    setRuns(await api.syncRuns());
  }

  async function loadProviders(): Promise<void> {
    setProviders(await api.providers());
  }

  async function loadSubs(): Promise<void> {
    setSubs(await api.liveSubscriptions());
  }

  async function loadVod(): Promise<void> {
    await Promise.all([loadRuns(), loadProviders()]);
  }

  useEffect(() => {
    void loadSubs().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    void loadVod().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
    const t = setInterval(() => {
      if (tab === "vod") {
        void loadRuns().catch(() => undefined);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [tab]);

  async function onImportFollowees(): Promise<void> {
    setImporting(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.importFolloweeSubscriptions();
      await loadSubs();
      const parts = r.providers.map((p) => {
        if (p.skipped) return `${p.provider}: ${p.skipped}`;
        if (p.error) return `${p.provider}: 失败 ${p.error}`;
        return `${p.provider}: 新增 ${p.imported} / 已有 ${p.existing} / 拉取 ${p.fetched}`;
      });
      setMsg(
        `已从关注列表导入（默认双关）。合计新增 ${r.totalImported}。${parts.join("；")}`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  async function onDelete(id: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.deleteLiveSubscription(id);
      await loadSubs();
      setMsg("已移除订阅");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleLiveRecord(
    id: number,
    enabled: boolean,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.patchLiveSubscription(id, { enabled });
      await loadSubs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleSyncWorks(
    id: number,
    syncWorks: boolean,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.patchLiveSubscription(id, { syncWorks });
      await loadSubs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleFavoriteSync(
    p: ProviderAccountPublic,
  ): Promise<void> {
    setToggleId(p.id);
    setError(null);
    setMsg(null);
    try {
      await api.patchProvider(p.id, {
        favoriteSyncEnabled: !p.favoriteSyncEnabled,
      });
      await loadProviders();
      setMsg(
        p.favoriteSyncEnabled
          ? `已关闭 ${p.provider} 收藏同步`
          : `已开启 ${p.provider} 收藏同步`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggleId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Sync</p>
          <h1>同步</h1>
          <p className="page-desc">
            管理作者订阅（同步作品 / 自动录制），并按渠道控制 VOD
            收藏夹同步。
          </p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="同步分区">
        <button
          type="button"
          role="tab"
          className={`tab${tab === "subscribe" ? " active" : ""}`}
          aria-selected={tab === "subscribe"}
          onClick={() => setTab("subscribe")}
        >
          订阅作者
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === "vod" ? " active" : ""}`}
          aria-selected={tab === "vod"}
          onClick={() => setTab("vod")}
        >
          VOD 同步
        </button>
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

      {tab === "subscribe" ? (
        <section className="card">
          <div className="card-header">
            <h2>订阅作者</h2>
            <span className="badge soft">{subs.length} 位</span>
          </div>
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            可从各渠道「关注」导入到本机名单（默认关闭同步作品与自动录制）。
            自动录制仅 otobanana 可开。koekoe 无平台关注列表，请手动添加。
          </p>
          <div className="toolbar" style={{ marginBottom: "1rem" }}>
            <button
              type="button"
              disabled={importing || busy}
              onClick={() => {
                void onImportFollowees();
              }}
            >
              {importing ? <span className="spinner" /> : null}
              从关注导入
            </button>
            <Link to="/sync/add" className="button secondary">
              手动添加
            </Link>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                void loadSubs().catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                );
              }}
            >
              <IconRefresh width={16} height={16} />
              刷新
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>作者</th>
                  <th>渠道</th>
                  <th>同步作品</th>
                  <th>自动录制</th>
                  <th>最近在播</th>
                  <th>错误</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {subs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      暂无订阅。可「从关注导入」或「手动添加」。
                    </td>
                  </tr>
                ) : (
                  subs.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div>
                          <strong>
                            {s.displayName || s.username || s.authorId}
                          </strong>
                        </div>
                        <div className="muted small">
                          {s.username ? `@${s.username}` : s.authorId}
                        </div>
                      </td>
                      <td>
                        <span className="badge soft">{s.provider}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            void onToggleSyncWorks(s.id, !s.syncWorks);
                          }}
                        >
                          {s.syncWorks ? "开" : "关"}
                        </button>
                      </td>
                      <td>
                        {s.provider === "otobanana" ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              void onToggleLiveRecord(s.id, !s.enabled);
                            }}
                          >
                            {s.enabled ? "开" : "关"}
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted small">
                        {s.lastOnairAt || s.lastRoomId ? (
                          <>
                            <div>{s.lastOnairAt || "—"}</div>
                            {s.lastRoomId ? (
                              <div title={s.lastRoomId}>
                                {s.lastRoomId.slice(0, 28)}…
                              </div>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="muted small">{s.lastError || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            void onDelete(s.id);
                          }}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <div className="page-header" style={{ marginBottom: "1rem" }}>
            <div className="stat-pills">
              <span className="badge soft">同步记录 {runs.length}</span>
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
                      setMsg(
                        "已触发全量同步（收藏关且无作者同步的渠道会跳过）",
                      );
                      return loadRuns();
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
                onClick={() => void loadVod()}
              >
                <IconRefresh width={16} height={16} />
                刷新
              </button>
            </div>
          </div>

          <section className="card" style={{ marginBottom: "1rem" }}>
            <div className="card-header">
              <h2>按渠道收藏同步</h2>
            </div>
            <p className="muted small" style={{ marginBottom: "0.75rem" }}>
              关闭后仅跳过该渠道的收藏夹同步；若「订阅作者」已开启「同步作品」，全量同步仍会拉取作者作品。不影响直播凭证与下载任务。
            </p>
            {providers.length === 0 ? (
              <p className="muted">尚未配置 Provider 账号。</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>渠道</th>
                      <th>收藏同步</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.provider}</strong>
                        </td>
                        <td>
                          <span
                            className={
                              p.favoriteSyncEnabled
                                ? "badge queued"
                                : "badge soft"
                            }
                          >
                            {p.favoriteSyncEnabled ? "开启" : "关闭"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={toggleId === p.id}
                            onClick={() => {
                              void onToggleFavoriteSync(p);
                            }}
                          >
                            {p.favoriteSyncEnabled ? "关闭" : "开启"}
                          </button>
                        </td>
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
        </>
      )}
    </div>
  );
}
