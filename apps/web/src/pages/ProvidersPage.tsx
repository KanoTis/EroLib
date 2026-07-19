import { useEffect, useState } from "react";
import type {
  AuthMode,
  ProviderAccountPublic,
  ProviderId,
} from "@erolib/shared";
import { api } from "../api";

export function ProvidersPage() {
  const [list, setList] = useState<ProviderAccountPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [provider, setProvider] = useState<ProviderId>("otobanana");
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cookieHeader, setCookieHeader] = useState("");

  async function load(): Promise<void> {
    setList(await api.providers());
  }

  useEffect(() => {
    void load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Accounts</p>
          <h1>Providers</h1>
          <p className="page-desc">
            配置各站账号。凭证加密存储；支持账密或 Cookie/Token。删除绑定不会删除已下载媒体。
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

      <section className="card">
        <div className="card-header">
          <h2>添加绑定</h2>
        </div>
        <div className="form-grid">
          <label className="field">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
            >
              <option value="otobanana">Otobanana</option>
              <option value="koekoe">Koe-koe</option>
              <option value="erovoice">Erovoice</option>
            </select>
          </label>
          <label className="field">
            认证方式
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as AuthMode)}
            >
              <option value="password">账密</option>
              <option value="cookie">Cookie / Token</option>
            </select>
          </label>
          {authMode === "password" ? (
            <>
              <label className="field">
                用户名 / Email
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="field">
                密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label className="field full">
              Cookie / JWT
              <textarea
                rows={3}
                value={cookieHeader}
                onChange={(e) => setCookieHeader(e.target.value)}
                placeholder="Otobanana: 粘贴 JWT；Koe-koe: PHPSESSID=...; login_token=..."
              />
              <span className="field-hint">
                Cookie 过期后需重新导入；账密模式可在同步时自动重登。
              </span>
            </label>
          )}
        </div>
        <div className="form-actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setError(null);
              setMsg(null);
              setSaving(true);
              void api
                .createProvider({
                  provider,
                  authMode,
                  username: username || undefined,
                  password: password || undefined,
                  cookieHeader: cookieHeader || undefined,
                })
                .then(async () => {
                  setMsg("已保存并验证通过");
                  setPassword("");
                  setCookieHeader("");
                  await load();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setSaving(false));
            }}
          >
            {saving ? <span className="spinner" /> : null}
            {saving ? "验证中…" : "保存"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>已配置</h2>
          <span className="badge soft">{list.length} 个</span>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">
            <strong>尚未配置 Provider</strong>
            <p>添加 Otobanana 或 Koe-koe 账号后即可同步收藏。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>模式</th>
                  <th>用户</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.provider}</strong>
                    </td>
                    <td>
                      <span className="badge soft">{p.authMode}</span>
                    </td>
                    <td>{p.username ?? "—"}</td>
                    <td>
                      <span className="badge soft">{p.status}</span>
                      {p.statusMessage ? (
                        <div className="muted small">{p.statusMessage}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busyId === p.id}
                          onClick={() => {
                            setBusyId(p.id);
                            setError(null);
                            setMsg(null);
                            void api
                              .testProvider(p.id)
                              .then(async (r) => {
                                setMsg(
                                  r.ok ? `${p.provider} 测试成功` : "测试失败",
                                );
                                if (!r.ok && r.error) setError(r.error);
                                await load();
                              })
                              .catch((e: unknown) =>
                                setError(
                                  e instanceof Error ? e.message : String(e),
                                ),
                              )
                              .finally(() => setBusyId(null));
                          }}
                        >
                          测试
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={busyId === p.id}
                          onClick={() => {
                            if (
                              !confirm(
                                "删除绑定不会删除已下载媒体。确认删除？",
                              )
                            ) {
                              return;
                            }
                            setBusyId(p.id);
                            void api
                              .deleteProvider(p.id)
                              .then(load)
                              .catch((e: unknown) =>
                                setError(
                                  e instanceof Error ? e.message : String(e),
                                ),
                              )
                              .finally(() => setBusyId(null));
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
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
