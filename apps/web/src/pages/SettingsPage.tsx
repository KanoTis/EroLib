import { useEffect, useState } from "react";
import type { SettingsPublic } from "@erolib/shared";
import { api } from "../api";
import { IconRefresh } from "../components/Icons";

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [hours, setHours] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [historyMeta, setHistoryMeta] = useState<{
    syncedAt: string | null;
    lastError: string | null;
    syncing: boolean;
  } | null>(null);

  useEffect(() => {
    void api
      .settings()
      .then((s) => {
        setSettings(s);
        setHours(s.syncIntervalHours);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    void api
      .liveFolloweeHistory()
      .then((h) =>
        setHistoryMeta({
          syncedAt: h.syncedAt,
          lastError: h.lastError,
          syncing: h.syncing,
        }),
      )
      .catch(() => undefined);
  }, []);

  async function onSyncHistory(): Promise<void> {
    setHistorySyncing(true);
    setError(null);
    setMsg(null);
    try {
      await api.syncLiveFolloweeHistory();
      setMsg("已请求后台同步关注作者直播历史（不阻塞，稍后可在直播页查看）");
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const data = await api.liveFolloweeHistory();
        setHistoryMeta({
          syncedAt: data.syncedAt,
          lastError: data.lastError,
          syncing: data.syncing,
        });
        if (!data.syncing) break;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistorySyncing(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">System</p>
          <h1>设置</h1>
          <p className="page-desc">
            同步节奏、关注历史后台同步与路径信息。路径由 Docker / 环境变量注入，只读展示。
          </p>
        </div>
      </header>

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

      {!settings && !error ? (
        <div className="loading-block" role="status">
          <span className="spinner" />
          加载设置…
        </div>
      ) : null}

      {settings ? (
        <section className="card">
          <div className="card-header">
            <h2>同步</h2>
          </div>
          <div className="form-grid">
            <label className="field">
              同步间隔（小时）
              <input
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
              <span className="field-hint">
                默认 4 小时。保存后重启服务定时器按新值生效。
              </span>
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                setError(null);
                setMsg(null);
                void api
                  .updateSettings({ syncIntervalHours: hours })
                  .then(() => setMsg("已保存"))
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? <span className="spinner" /> : null}
              保存
            </button>
          </div>
        </section>
      ) : null}

      {/* Independent of settings load — AC7 entry must stay available. */}
      <section className="card">
        <div className="card-header">
          <h2>直播关注历史</h2>
        </div>
        <p className="muted small" style={{ marginBottom: "0.75rem" }}>
          从 Otobanana 后台拉取关注作者与近期场次到本地缓存，供直播页只读展示。
        </p>
        {historyMeta ? (
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            上次同步：{historyMeta.syncedAt || "尚未同步"}
            {historyMeta.syncing || historySyncing ? " · 同步进行中" : ""}
            {historyMeta.lastError
              ? ` · 上次错误：${historyMeta.lastError}`
              : ""}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={historySyncing || historyMeta?.syncing}
            onClick={() => {
              void onSyncHistory();
            }}
          >
            {historySyncing || historyMeta?.syncing ? (
              <span className="spinner" />
            ) : (
              <IconRefresh width={16} height={16} />
            )}
            同步关注作者直播历史
          </button>
        </div>
      </section>

      {settings ? (
        <section className="card">
          <div className="card-header">
            <h2>路径（只读）</h2>
          </div>
          <ul className="paths">
            <li>
              <code>DATA_DIR</code>
              <span>{settings.dataDir}</span>
            </li>
            <li>
              <code>MEDIA_DIR</code>
              <span>{settings.mediaDir}</span>
            </li>
            <li>
              <code>CACHE_DIR</code>
              <span>{settings.cacheDir}</span>
            </li>
          </ul>

          <div className="stat-pills">
            <span className="badge soft">
              鉴权：{settings.authEnabled ? "已启用" : "未启用"}
            </span>
            <span className="badge soft">
              下载并发：{settings.maxDownloadConcurrency}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
