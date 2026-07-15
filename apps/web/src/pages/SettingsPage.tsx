import { useEffect, useState } from "react";
import type { SettingsPublic } from "@erolib/shared";
import { api } from "../api";

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [hours, setHours] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  }, []);

  if (!settings && !error) {
    return (
      <div className="page">
        <div className="loading-block" role="status">
          <span className="spinner" />
          加载设置…
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">System</p>
          <h1>设置</h1>
          <p className="page-desc">同步节奏与路径信息。路径由 Docker / 环境变量注入，只读展示。</p>
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
              <span className="field-hint">默认 4 小时。保存后重启服务定时器按新值生效。</span>
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

          <div className="card-header" style={{ marginTop: "1.5rem" }}>
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
