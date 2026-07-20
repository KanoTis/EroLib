import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  AuthorPublic,
  LiveMediaPublic,
  WorkPublic,
} from "@erolib/shared";
import { api } from "../api";
import { AuthorAvatar } from "../components/AuthorAvatar";
import { IconBack, IconPlay } from "../components/Icons";
import { WorkCover } from "../components/WorkCover";
import { usePlayer } from "../player/PlayerContext";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载",
  queued: "队列中",
  downloading: "下载中",
  failed: "失败",
  discovered: "已发现",
};

const PAGE_SIZE = 50;

export function AuthorPage() {
  // React Router already decodes path params; do not decodeURIComponent again
  // (a literal "%" in authorId would throw URIError).
  const { provider: providerParam = "", authorId: authorIdParam = "" } =
    useParams();
  const provider = providerParam;
  const authorId = authorIdParam;
  const { play } = usePlayer();

  const [author, setAuthor] = useState<AuthorPublic | null>(null);
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>([]);
  const [worksOffset, setWorksOffset] = useState(0);
  const [liveOffset, setLiveOffset] = useState(0);
  const [worksHasMore, setWorksHasMore] = useState(false);
  const [liveHasMore, setLiveHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAuthor = useCallback(async (): Promise<void> => {
    const data = await api.getAuthor(provider, authorId);
    setAuthor(data);
  }, [provider, authorId]);

  const loadLists = useCallback(async (): Promise<void> => {
    const [vodBatch, liveBatch] = await Promise.all([
      api.works({
        provider,
        authorId,
        limit: PAGE_SIZE,
        offset: 0,
      }),
      api.liveMedia({
        provider,
        authorId,
        limit: PAGE_SIZE,
        offset: 0,
      }),
    ]);
    setWorks(vodBatch);
    setLiveItems(liveBatch);
    setWorksOffset(vodBatch.length);
    setLiveOffset(liveBatch.length);
    setWorksHasMore(vodBatch.length === PAGE_SIZE);
    setLiveHasMore(liveBatch.length === PAGE_SIZE);
  }, [provider, authorId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMsg(null);
    void (async () => {
      try {
        await Promise.all([loadAuthor(), loadLists()]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAuthor, loadLists]);

  async function loadMoreWorks(): Promise<void> {
    const batch = await api.works({
      provider,
      authorId,
      limit: PAGE_SIZE,
      offset: worksOffset,
    });
    setWorks((prev) => [...prev, ...batch]);
    setWorksOffset((o) => o + batch.length);
    setWorksHasMore(batch.length === PAGE_SIZE);
  }

  async function loadMoreLive(): Promise<void> {
    const batch = await api.liveMedia({
      provider,
      authorId,
      limit: PAGE_SIZE,
      offset: liveOffset,
    });
    setLiveItems((prev) => [...prev, ...batch]);
    setLiveOffset((o) => o + batch.length);
    setLiveHasMore(batch.length === PAGE_SIZE);
  }

  async function onAddSubscription(): Promise<void> {
    if (!author) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.addLiveSubscription({
        provider: author.provider,
        authorId: author.authorId,
        username: author.username,
        displayName: author.displayName,
        enabled: false,
        syncWorks: false,
      });
      setMsg("已添加订阅（默认同步作品与自动录制均为关）");
      await loadAuthor();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleSyncWorks(next: boolean): Promise<void> {
    if (!author?.subscription) return;
    setBusy(true);
    setError(null);
    try {
      await api.patchLiveSubscription(author.subscription.id, {
        syncWorks: next,
      });
      await loadAuthor();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleLiveRecord(next: boolean): Promise<void> {
    if (!author?.subscription) return;
    setBusy(true);
    setError(null);
    try {
      await api.patchLiveSubscription(author.subscription.id, {
        enabled: next,
      });
      await loadAuthor();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function playVod(w: WorkPublic): void {
    play({
      id: `vod:${w.provider}:${w.workId}`,
      kind: "vod",
      title: w.title,
      subtitle: w.authorName ?? w.authorId ?? undefined,
      src: api.audioUrl(w.provider, w.workId),
      artworkUrl: w.coverPath ? api.coverUrl(w.provider, w.workId) : null,
    });
  }

  function playLive(m: LiveMediaPublic, title: string): void {
    play({
      id: `live:${m.provider}:${m.roomId}`,
      kind: "live",
      title,
      subtitle: m.authorName ?? m.authorId ?? undefined,
      src: api.liveAudioUrl(m.provider, m.roomId),
      artworkUrl: null,
    });
  }

  if (loading && !author) {
    return (
      <div className="page">
        <div className="loading-block" role="status">
          <span className="spinner" />
          加载作者页…
        </div>
      </div>
    );
  }

  if (error && !author) {
    return (
      <div className="page">
        <Link className="back-link" to="/">
          <IconBack width={16} height={16} />
          返回媒体库
        </Link>
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!author) {
    return (
      <div className="page">
        <Link className="back-link" to="/">
          <IconBack width={16} height={16} />
          返回媒体库
        </Link>
        <p className="muted">未找到作者</p>
      </div>
    );
  }

  const displayName =
    author.displayName || author.username || author.authorId;

  return (
    <div className="page">
      <Link className="back-link" to="/">
        <IconBack width={16} height={16} />
        返回媒体库
      </Link>

      <section className="card author-header">
        <div className="author-hero">
          <AuthorAvatar
            provider={author.provider}
            authorId={author.authorId}
            displayName={displayName}
            hasAvatar={author.hasAvatar}
            size="lg"
          />
          <div>
            <p className="page-kicker">{author.provider}</p>
            <h1 className="detail-title">{displayName}</h1>
            <div className="author-ids muted small">
              {author.username ? (
                <span>@{author.username}</span>
              ) : null}
              <span className="author-id-raw">{author.authorId}</span>
            </div>
          </div>
        </div>

        <div className="author-subscribe">
          <h2 className="section-title">订阅</h2>
          {author.subscription ? (
            <div className="author-subscribe-row">
              <span className="badge soft">已订阅</span>
              <label className="author-toggle">
                <span>同步作品</span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void onToggleSyncWorks(!author.subscription!.syncWorks);
                  }}
                >
                  {author.subscription.syncWorks ? "开" : "关"}
                </button>
              </label>
              {author.provider === "otobanana" ? (
                <label className="author-toggle">
                  <span>自动录制</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      void onToggleLiveRecord(!author.subscription!.enabled);
                    }}
                  >
                    {author.subscription.enabled ? "开" : "关"}
                  </button>
                </label>
              ) : (
                <span className="muted small">自动录制仅支持 otobanana</span>
              )}
            </div>
          ) : (
            <div className="author-subscribe-row">
              <span className="muted">未订阅</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void onAddSubscription();
                }}
              >
                添加订阅
              </button>
            </div>
          )}
        </div>

        <div className="alert-stack" style={{ marginTop: "0.75rem" }}>
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
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 className="section-title">点播作品</h2>
        {works.length === 0 ? (
          <p className="muted">暂无该作者的本地点播作品</p>
        ) : (
          <div className="library-grid">
            {works.map((w) => (
              <article className="work-card" key={`vod:${w.id}`}>
                <WorkCover
                  provider={w.provider}
                  workId={w.workId}
                  title={w.title}
                  authorName={w.authorName}
                  coverPath={w.coverPath}
                  size="card"
                  badge={
                    <span className={`badge ${w.status}`}>
                      {STATUS_LABEL[w.status] ?? w.status}
                    </span>
                  }
                />
                <div className="work-body">
                  <Link
                    className="work-title"
                    to={`/works/${w.provider}/${w.workId}`}
                  >
                    {w.title}
                  </Link>
                  <div className="work-meta">
                    {w.authorName ?? w.authorId} · {w.provider}
                  </div>
                  <div className="work-actions">
                    <span className="badge soft">点播</span>
                    {w.status === "downloaded" ? (
                      <button type="button" onClick={() => playVod(w)}>
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
        {worksHasMore ? (
          <div className="form-actions" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void loadMoreWorks();
              }}
            >
              加载更多点播
            </button>
          </div>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 className="section-title">直播回放</h2>
        {liveItems.length === 0 ? (
          <p className="muted">暂无该作者的本地直播回放</p>
        ) : (
          <div className="library-grid">
            {liveItems.map((m) => {
              const title = m.title || m.roomId;
              return (
                <article className="work-card" key={`live:${m.id}`}>
                  <WorkCover
                    provider={m.provider}
                    workId={m.roomId}
                    title={title}
                    authorName={m.authorName}
                    coverPath={null}
                    size="card"
                    badge={<span className="badge queued">直播</span>}
                  />
                  <div className="work-body">
                    <div className="work-title">{title}</div>
                    <div className="work-meta">
                      {m.authorName ?? m.authorId} · {m.provider}
                    </div>
                    <div className="work-meta">
                      录制完成：{m.recordedAt || m.updatedAt}
                    </div>
                    <div className="work-actions">
                      <span className="badge soft">直播</span>
                      <button
                        type="button"
                        onClick={() => playLive(m, title)}
                      >
                        <IconPlay width={14} height={14} />
                        播放
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {liveHasMore ? (
          <div className="form-actions" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void loadMoreLive();
              }}
            >
              加载更多回放
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
