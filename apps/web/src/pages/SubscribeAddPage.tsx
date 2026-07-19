import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  AuthorSearchHit,
  ProviderAccountPublic,
  ProviderId,
} from "@erolib/shared";
import { api } from "../api";

export function SubscribeAddPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderAccountPublic[]>([]);
  const [addProvider, setAddProvider] = useState<ProviderId>("otobanana");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AuthorSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const configuredProviders = useMemo(
    () => providers.map((p) => p.provider as ProviderId),
    [providers],
  );

  useEffect(() => {
    void api
      .providers()
      .then(setProviders)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  useEffect(() => {
    if (configuredProviders.length === 0) return;
    if (!configuredProviders.includes(addProvider)) {
      setAddProvider(configuredProviders[0]!);
    }
  }, [configuredProviders, addProvider]);

  async function onSearch(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setSearched(true);
    try {
      const rows = await api.searchAuthors(addProvider, q);
      setHits(rows);
    } catch (e: unknown) {
      setHits([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function onAddHit(hit: AuthorSearchHit): Promise<void> {
    if (addingId) return;
    setAddingId(hit.authorId);
    setError(null);
    try {
      await api.addLiveSubscription({
        provider: hit.provider,
        authorId: hit.authorId,
        username: hit.username,
        displayName: hit.displayName,
        syncWorks: false,
        enabled: false,
      });
      void navigate("/sync");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingId(null);
    }
  }

  function hitLabel(hit: AuthorSearchHit): string {
    const primary =
      hit.displayName?.trim() ||
      hit.username?.trim() ||
      hit.authorId;
    return primary;
  }

  function hitSecondary(hit: AuthorSearchHit): string | null {
    const parts: string[] = [];
    if (
      hit.username &&
      hit.username !== hit.displayName &&
      hit.username !== hit.authorId
    ) {
      parts.push(`@${hit.username}`);
    }
    if (hit.authorId && hit.authorId !== hit.displayName) {
      if (!parts.includes(`@${hit.authorId}`)) {
        parts.push(hit.authorId);
      }
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Sync</p>
          <h1>手动添加作者</h1>
          <p className="page-desc">
            搜索并选择作者加入订阅名单；默认关闭「同步作品」与「自动录制」，请在同步页自行开启。
          </p>
        </div>
        <div className="toolbar">
          <Link to="/sync" className="button secondary">
            返回订阅列表
          </Link>
        </div>
      </header>

      <div className="alert-stack">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <section className="card">
        <div className="form-grid" style={{ marginBottom: "1rem" }}>
          <label className="field">
            渠道
            <select
              value={addProvider}
              onChange={(e) => {
                setAddProvider(e.target.value as ProviderId);
                setHits([]);
                setSearched(false);
                setError(null);
              }}
            >
              {(configuredProviders.length > 0
                ? configuredProviders
                : (["otobanana", "koekoe", "erovoice"] as ProviderId[])
              ).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ gridColumn: "span 2" }}>
            关键词
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                addProvider === "otobanana"
                  ? "username 或 UUID"
                  : addProvider === "koekoe"
                    ? "作者显示名"
                    : "作者 slug（主页 URL 最后一段，如 noah0217all）"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSearch();
                }
              }}
            />
          </label>
        </div>
        <div className="toolbar">
          <button
            type="button"
            disabled={searching || !query.trim()}
            onClick={() => {
              void onSearch();
            }}
          >
            {searching ? <span className="spinner" /> : null}
            搜索
          </button>
          <Link to="/sync" className="button secondary">
            取消
          </Link>
        </div>
      </section>

      {searched ? (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>搜索结果</h2>
          {searching ? (
            <p className="page-desc">搜索中…</p>
          ) : hits.length === 0 ? (
            <p className="page-desc">未找到匹配作者，请换关键词重试。</p>
          ) : (
            <ul className="list-plain" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {hits.map((hit) => {
                const secondary = hitSecondary(hit);
                const busy = addingId === hit.authorId;
                return (
                  <li
                    key={`${hit.provider}:${hit.authorId}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      padding: "0.65rem 0",
                      borderBottom: "1px solid var(--border, #333)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{hitLabel(hit)}</div>
                      {secondary ? (
                        <div className="page-desc" style={{ margin: 0 }}>
                          {secondary}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="button"
                      disabled={Boolean(addingId)}
                      onClick={() => {
                        void onAddHit(hit);
                      }}
                    >
                      {busy ? <span className="spinner" /> : null}
                      添加
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
