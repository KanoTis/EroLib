import { useState } from "react";
import { api } from "../api";
import { IconWave } from "../components/Icons";

export function LoginPage({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setLoading(true);
          void api
            .login(username, password)
            .then(() => onSuccess())
            .catch((err: unknown) =>
              setError(err instanceof Error ? err.message : String(err)),
            )
            .finally(() => setLoading(false));
        }}
      >
        <div className="login-brand">
          <div className="brand-mark" aria-hidden>
            <IconWave width={20} height={20} />
          </div>
          <div>
            <div className="brand-title">Erolib</div>
            <div className="brand-sub">自托管音声备份</div>
          </div>
        </div>
        <h1>登录</h1>
        <p className="muted small" style={{ margin: 0 }}>
          使用 Docker 环境变量中的管理员账号进入本地库。
        </p>
        <label className="field">
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : null}
          登录
        </button>
      </form>
    </div>
  );
}
