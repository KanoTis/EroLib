import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { AuthorLink } from "../components/AuthorLink";
import { WorkCover } from "../components/WorkCover";
import {
  IconPlay,
  IconSearch,
  IconViewList,
  IconViewSmall,
  IconViewStandard,
  IconWave,
} from "../components/Icons";
import { usePlayer } from "../player/PlayerContext";
import type { PlayableTrack } from "../player/types";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载",
  queued: "队列中",
  downloading: "下载中",
  failed: "失败",
  discovered: "已发现",
};

type LibraryViewMode = "small" | "standard" | "list";
type KindFilter = "all" | "vod" | "live";

type LibraryItem =
  | {
      kind: "vod";
      key: string;
      sortAt: string;
      work: WorkPublic;
    }
  | {
      kind: "live";
      key: string;
      sortAt: string;
      media: LiveMediaPublic;
    };

const VIEW_MODE_KEY = "erolib.library.viewMode";
const PAGE_SIZE = 50;
/** Must match server max on GET /api/works and /api/live/media. */
const API_MAX_LIMIT = 200;
const SCROLL_RESTORE_KEY = "erolib.library.scrollRestore";
/** Legacy keys from the first scroll-restore implementation. */
const LEGACY_SCROLL_KEYS = [
  "erolib.library.scrollY",
  "erolib.library.vodOffset",
  "erolib.library.liveOffset",
] as const;

type LibraryScrollRestore = {
  v: 1;
  scrollY: number;
  vodCount: number;
  liveCount: number;
  q: string;
  status: string;
  provider: string;
};

const VIEW_MODE_OPTIONS: {
  id: LibraryViewMode;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "small",
    label: "小尺寸",
    icon: <IconViewSmall width={16} height={16} />,
  },
  {
    id: "standard",
    label: "标准尺寸",
    icon: <IconViewStandard width={16} height={16} />,
  },
  {
    id: "list",
    label: "列表",
    icon: <IconViewList width={16} height={16} />,
  },
];

function readViewMode(): LibraryViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === "small" || raw === "standard" || raw === "list") return raw;
  } catch {
    // ignore private mode / blocked storage
  }
  return "standard";
}

function writeViewMode(mode: LibraryViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // ignore private mode / blocked storage
  }
}

function parseKind(raw: string | null): KindFilter {
  if (raw === "vod" || raw === "live" || raw === "all") return raw;
  return "all";
}

function normalizeCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return PAGE_SIZE;
  return Math.max(PAGE_SIZE, Math.floor(v));
}

function readScrollRestore(): LibraryScrollRestore | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_RESTORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<LibraryScrollRestore>;
    if (data.v !== 1) return null;
    const scrollY = Number(data.scrollY);
    return {
      v: 1,
      scrollY: Number.isFinite(scrollY) && scrollY > 0 ? scrollY : 0,
      vodCount: normalizeCount(data.vodCount),
      liveCount: normalizeCount(data.liveCount),
      q: typeof data.q === "string" ? data.q : "",
      status: typeof data.status === "string" ? data.status : "",
      provider: typeof data.provider === "string" ? data.provider : "",
    };
  } catch {
    return null;
  }
}

function writeScrollRestore(data: LibraryScrollRestore): void {
  try {
    sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify(data));
  } catch {
    // ignore private mode / blocked storage
  }
}

function clearScrollRestore(): void {
  try {
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    for (const key of LEGACY_SCROLL_KEYS) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore private mode / blocked storage
  }
}

async function fetchUpToCount<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
  targetCount: number,
): Promise<{ items: T[]; hasMore: boolean }> {
  const target = normalizeCount(targetCount);
  const items: T[] = [];
  let offset = 0;
  let hasMore = false;

  while (items.length < target) {
    const limit = Math.min(API_MAX_LIMIT, target - items.length);
    const page = await fetchPage(limit, offset);
    items.push(...page);
    offset += page.length;
    if (page.length < limit) {
      hasMore = false;
      break;
    }
    if (items.length >= target) {
      hasMore = true;
      break;
    }
  }

  return { items, hasMore };
}

export function LibraryPage() {
  const { play } = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();
  const restoreRef = useRef(readScrollRestore());
  const needsRestoreRef = useRef(restoreRef.current != null);
  const readyToSaveRef = useRef(false);
  const persistRef = useRef({
    q: "",
    status: "",
    provider: "",
    vodOffset: 0,
    liveOffset: 0,
  });
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>([]);
  const [q, setQ] = useState(() => restoreRef.current?.q ?? "");
  const [status, setStatus] = useState(() => restoreRef.current?.status ?? "");
  const [provider, setProvider] = useState(
    () => restoreRef.current?.provider ?? "",
  );
  const [kind, setKind] = useState<KindFilter>(() =>
    parseKind(searchParams.get("type")),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [vodOffset, setVodOffset] = useState(0);
  const [liveOffset, setLiveOffset] = useState(0);
  const [vodHasMore, setVodHasMore] = useState(false);
  const [liveHasMore, setLiveHasMore] = useState(false);
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() =>
    readViewMode(),
  );
  const requestIdRef = useRef(0);

  persistRef.current = { q, status, provider, vodOffset, liveOffset };

  const wantVod = kind === "all" || kind === "vod";
  const wantLive = kind === "all" || kind === "live";
  const showLoadMore =
    (wantVod && vodHasMore) || (wantLive && liveHasMore);

  function playVod(w: WorkPublic): void {
    const track: PlayableTrack = {
      id: `vod:${w.provider}:${w.workId}`,
      kind: "vod",
      title: w.title,
      subtitle: w.authorName ?? w.authorId ?? undefined,
      src: api.audioUrl(w.provider, w.workId),
      artworkUrl: w.coverPath ? api.coverUrl(w.provider, w.workId) : null,
    };
    play(track);
  }

  function playLive(m: LiveMediaPublic, title: string): void {
    const track: PlayableTrack = {
      id: `live:${m.provider}:${m.roomId}`,
      kind: "live",
      title,
      subtitle: m.authorName ?? m.authorId ?? undefined,
      src: api.liveAudioUrl(m.provider, m.roomId),
    };
    play(track);
  }

  async function deleteLive(m: LiveMediaPublic): Promise<void> {
    const title = m.title || m.roomId;
    if (
      !confirm(
        `删除直播录制「${title}」？将同时删除本地音频与关联录制任务，不可恢复。`,
      )
    ) {
      return;
    }
    try {
      setError(null);
      await api.deleteLiveMedia(m.provider, m.roomId);
      setLiveItems((prev) =>
        prev.filter(
          (x) => !(x.provider === m.provider && x.roomId === m.roomId),
        ),
      );
      setLiveOffset((prev) => Math.max(0, prev - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function vodKey(w: WorkPublic): string {
    return `${w.provider}:${w.workId}`;
  }

  function liveKey(m: LiveMediaPublic): string {
    return `${m.provider}:${m.roomId}`;
  }

  async function loadInitial(): Promise<void> {
    const reqId = ++requestIdRef.current;
    readyToSaveRef.current = false;
    try {
      setError(null);
      setLoading(true);
      setLoadingMore(false);
      // Drop pagination until this replace succeeds so load-more cannot
      // append with a new filter against a previous page window.
      setVodOffset(0);
      setLiveOffset(0);
      setVodHasMore(false);
      setLiveHasMore(false);
      const fetchVod = kind === "all" || kind === "vod";
      const fetchLive = kind === "all" || kind === "live";
      const restore =
        needsRestoreRef.current && restoreRef.current
          ? restoreRef.current
          : null;
      const vodTarget = restore?.vodCount ?? PAGE_SIZE;
      const liveTarget = restore?.liveCount ?? PAGE_SIZE;
      const [vodResult, liveResult] = await Promise.all([
        fetchVod
          ? fetchUpToCount(
              (limit, offset) =>
                api.works({
                  q: q || undefined,
                  status: status || undefined,
                  provider: provider || undefined,
                  limit,
                  offset,
                }),
              vodTarget,
            )
          : Promise.resolve({ items: [] as WorkPublic[], hasMore: false }),
        fetchLive
          ? fetchUpToCount(
              (limit, offset) =>
                api.liveMedia({
                  q: q || undefined,
                  provider: provider || undefined,
                  limit,
                  offset,
                }),
              liveTarget,
            )
          : Promise.resolve({
              items: [] as LiveMediaPublic[],
              hasMore: false,
            }),
      ]);
      if (reqId !== requestIdRef.current) return;
      setWorks(vodResult.items);
      setLiveItems(liveResult.items);
      setVodOffset(vodResult.items.length);
      setLiveOffset(liveResult.items.length);
      setVodHasMore(fetchVod && vodResult.hasMore);
      setLiveHasMore(fetchLive && liveResult.hasMore);
    } catch (e) {
      if (reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadMore(): Promise<void> {
    if (loading || loadingMore) return;
    const fetchVod = (kind === "all" || kind === "vod") && vodHasMore;
    const fetchLive = (kind === "all" || kind === "live") && liveHasMore;
    if (!fetchVod && !fetchLive) return;

    const reqId = ++requestIdRef.current;
    try {
      setError(null);
      setLoadingMore(true);
      const [vod, live] = await Promise.all([
        fetchVod
          ? api.works({
              q: q || undefined,
              status: status || undefined,
              provider: provider || undefined,
              limit: PAGE_SIZE,
              offset: vodOffset,
            })
          : Promise.resolve([] as WorkPublic[]),
        fetchLive
          ? api.liveMedia({
              q: q || undefined,
              provider: provider || undefined,
              limit: PAGE_SIZE,
              offset: liveOffset,
            })
          : Promise.resolve([] as LiveMediaPublic[]),
      ]);
      if (reqId !== requestIdRef.current) return;

      if (fetchVod) {
        setWorks((prev) => {
          const seen = new Set(prev.map(vodKey));
          const next = [...prev];
          for (const w of vod) {
            const k = vodKey(w);
            if (!seen.has(k)) {
              seen.add(k);
              next.push(w);
            }
          }
          return next;
        });
        setVodOffset((prev) => prev + vod.length);
        setVodHasMore(vod.length === PAGE_SIZE);
      }
      if (fetchLive) {
        setLiveItems((prev) => {
          const seen = new Set(prev.map(liveKey));
          const next = [...prev];
          for (const m of live) {
            const k = liveKey(m);
            if (!seen.has(k)) {
              seen.add(k);
              next.push(m);
            }
          }
          return next;
        });
        setLiveOffset((prev) => prev + live.length);
        setLiveHasMore(live.length === PAGE_SIZE);
      }
    } catch (e) {
      if (reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + type query
  }, [kind]);

  useEffect(() => {
    const scrollYRef = { current: window.scrollY };

    const persist = (scrollY: number): void => {
      if (!readyToSaveRef.current) return;
      const s = persistRef.current;
      writeScrollRestore({
        v: 1,
        scrollY: Math.max(0, scrollY),
        vodCount: Math.max(PAGE_SIZE, s.vodOffset),
        liveCount: Math.max(PAGE_SIZE, s.liveOffset),
        q: s.q,
        status: s.status,
        provider: s.provider,
      });
    };

    // Keep last known position. Router often resets window.scrollY to 0
    // before unmount, so unmount must not trust window.scrollY alone.
    const onScroll = (): void => {
      scrollYRef.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Save *before* navigation so scrollY is still correct (click/keyboard).
    const onLeaveViaLink = (e: Event): void => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      const anchor = el.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      persist(window.scrollY);
    };
    document.addEventListener("click", onLeaveViaLink, true);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onLeaveViaLink, true);
      // Prefer live scrollY; if router already reset to 0, keep click-saved
      // value or the last non-reset ref value.
      const live = window.scrollY;
      if (live > 0) {
        persist(live);
        return;
      }
      const existing = readScrollRestore();
      if (existing && existing.scrollY > 0) {
        persist(existing.scrollY);
        return;
      }
      if (scrollYRef.current > 0) {
        persist(scrollYRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    readyToSaveRef.current = true;
    if (!needsRestoreRef.current) return;
    needsRestoreRef.current = false;
    const y = restoreRef.current?.scrollY ?? 0;
    clearScrollRestore();
    restoreRef.current = null;
    if (!(y > 0)) return;

    const apply = (): void => {
      window.scrollTo(0, y);
    };
    // Double rAF: wait for list paint after loading → content swap.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        apply();
        // Covers late layout (covers/fonts) once more on next frame.
        requestAnimationFrame(apply);
      });
    });
  }, [loading]);

  useEffect(() => {
    const next = parseKind(searchParams.get("type"));
    if (next !== kind) setKind(next);
  }, [searchParams, kind]);

  function changeKind(next: KindFilter): void {
    setKind(next);
    const sp = new URLSearchParams(searchParams);
    if (next === "all") sp.delete("type");
    else sp.set("type", next);
    setSearchParams(sp, { replace: true });
  }

  function changeViewMode(mode: LibraryViewMode): void {
    setViewMode(mode);
    writeViewMode(mode);
  }

  const items = useMemo((): LibraryItem[] => {
    const vodItems: LibraryItem[] = works.map((w) => ({
      kind: "vod" as const,
      key: `vod:${w.provider}:${w.workId}`,
      sortAt: w.updatedAt || w.createdAt,
      work: w,
    }));
    const liveMapped: LibraryItem[] = liveItems.map((m) => ({
      kind: "live" as const,
      key: `live:${m.provider}:${m.roomId}`,
      sortAt: m.updatedAt || m.recordedAt || m.createdAt,
      media: m,
    }));
    return [...vodItems, ...liveMapped].sort((a, b) =>
      b.sortAt.localeCompare(a.sortAt),
    );
  }, [works, liveItems]);

  const listClassName =
    viewMode === "list"
      ? "library-list"
      : viewMode === "small"
        ? "library-grid library-grid--small"
        : "library-grid";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Library</p>
          <h1>媒体库</h1>
          <p className="page-desc">
            浏览已备份点播与直播录制。点播「已下载」与直播成品可播放。
          </p>
        </div>
        <div className="toolbar">
          <label className="field toolbar-search">
            <span className="sr-only">搜索</span>
            <input
              placeholder="搜索标题 / 作者"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadInitial();
              }}
              aria-label="搜索标题或作者"
            />
          </label>
          <select
            value={kind}
            onChange={(e) => changeKind(parseKind(e.target.value))}
            aria-label="按类型筛选"
            className="toolbar-select"
          >
            <option value="all">全部类型</option>
            <option value="vod">点播</option>
            <option value="live">直播</option>
          </select>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="按渠道筛选"
            className="toolbar-select toolbar-select--md"
          >
            <option value="">全部渠道</option>
            <option value="otobanana">Otobanana</option>
            <option value="koekoe">Koe-koe</option>
            <option value="erovoice">Erovoice</option>
          </select>
          {kind !== "live" ? (
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="按状态筛选"
              className="toolbar-select toolbar-select--md"
            >
              <option value="">全部状态</option>
              <option value="downloaded">已下载</option>
              <option value="queued">队列中</option>
              <option value="downloading">下载中</option>
              <option value="failed">失败</option>
              <option value="discovered">已发现</option>
            </select>
          ) : null}
          <button type="button" onClick={() => void loadInitial()}>
            <IconSearch width={16} height={16} />
            搜索
          </button>
          <div
            className="view-mode-toggle"
            role="group"
            aria-label="视图模式"
          >
            {VIEW_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="view-mode-btn"
                aria-label={opt.label}
                title={opt.label}
                aria-pressed={viewMode === opt.id}
                onClick={() => changeViewMode(opt.id)}
              >
                {opt.icon}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error ? (
        <div className="alert-stack">
          <p className="error" role="alert">
            {error}
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="loading-block" role="status">
          <span className="spinner" />
          正在加载媒体库…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <IconWave width={36} height={36} />
          <strong>暂无条目</strong>
          <p>
            点播：Providers 绑定后同步收藏。直播：在「同步」页订阅作者并完成录制。
          </p>
          <div className="row">
            <Link to="/providers">
              <button type="button">配置 Provider</button>
            </Link>
            <Link to="/live">
              <button type="button" className="secondary">
                直播录制
              </button>
            </Link>
          </div>
        </div>
      ) : (
        <div className={listClassName}>
          {items.map((item) => {
            const isList = viewMode === "list";
            if (item.kind === "live") {
              const m = item.media;
              const title = m.title || m.roomId;
              return (
                <article
                  className={isList ? "work-card work-card--list" : "work-card"}
                  key={item.key}
                >
                  <WorkCover
                    provider={m.provider}
                    workId={m.roomId}
                    title={title}
                    authorName={m.authorName}
                    coverPath={null}
                    size={isList ? "list" : "card"}
                    badge={
                      isList ? undefined : (
                        <span className="badge queued">直播</span>
                      )
                    }
                  />
                  {isList ? (
                    <div className="work-body">
                      <div className="work-main">
                        <div className="work-title">{title}</div>
                        <div className="work-meta">
                          {m.authorName ?? m.authorId}
                        </div>
                      </div>
                      <div className="work-actions">
                        <span className="badge soft">{m.provider}</span>
                        <span className="badge queued">直播</span>
                        <button
                          type="button"
                          onClick={() => playLive(m, title)}
                        >
                          <IconPlay width={14} height={14} />
                          播放
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            void deleteLive(m);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="work-body">
                      <div className="work-title">{title}</div>
                      <div className="work-meta">
                        {m.authorName ?? m.authorId} · {m.provider}
                      </div>
                      <div className="work-meta">
                        录制完成：{m.recordedAt || m.updatedAt}
                      </div>
                      <div className="work-actions">
                        <span className="badge soft">{m.provider}</span>
                        <span className="badge queued">直播</span>
                        <button
                          type="button"
                          className={
                            viewMode === "small"
                              ? "play-icon-btn icon-btn"
                              : undefined
                          }
                          aria-label={
                            viewMode === "small" ? `播放 ${title}` : undefined
                          }
                          onClick={() => playLive(m, title)}
                        >
                          <IconPlay width={14} height={14} />
                          {viewMode === "small" ? null : "播放"}
                        </button>
                        <button
                          type="button"
                          className={
                            viewMode === "small" ? "danger icon-btn" : "danger"
                          }
                          aria-label={
                            viewMode === "small" ? `删除 ${title}` : undefined
                          }
                          onClick={() => {
                            void deleteLive(m);
                          }}
                        >
                          {viewMode === "small" ? "×" : "删除"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            }

            const w = item.work;
            return (
              <article
                className={isList ? "work-card work-card--list" : "work-card"}
                key={item.key}
              >
                <WorkCover
                  provider={w.provider}
                  workId={w.workId}
                  title={w.title}
                  authorName={w.authorName}
                  coverPath={w.coverPath}
                  size={isList ? "list" : "card"}
                  badge={
                    isList ? undefined : (
                      <span className={`badge ${w.status}`}>
                        {STATUS_LABEL[w.status] ?? w.status}
                      </span>
                    )
                  }
                />
                {isList ? (
                  <div className="work-body">
                    <div className="work-main">
                      <Link
                        className="work-title"
                        to={`/works/${w.provider}/${w.workId}`}
                      >
                        {w.title}
                      </Link>
                      <div className="work-meta">
                        <AuthorLink
                          provider={w.provider}
                          authorId={w.authorId}
                        >
                          {w.authorName ?? w.authorId ?? "未知作者"}
                        </AuthorLink>
                      </div>
                    </div>
                    <div className="work-actions">
                      <span className="badge soft">{w.provider}</span>
                      <span className="badge soft">点播</span>
                      <span className={`badge ${w.status}`}>
                        {STATUS_LABEL[w.status] ?? w.status}
                      </span>
                      {w.status === "downloaded" ? (
                        <button
                          type="button"
                          onClick={() => playVod(w)}
                        >
                          <IconPlay width={14} height={14} />
                          播放
                        </button>
                      ) : (
                        <span className="muted small">不可播</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="work-body">
                    <Link
                      className="work-title"
                      to={`/works/${w.provider}/${w.workId}`}
                    >
                      {w.title}
                    </Link>
                    <div className="work-meta">
                      <AuthorLink
                        provider={w.provider}
                        authorId={w.authorId}
                      >
                        {w.authorName ?? w.authorId ?? "未知作者"}
                      </AuthorLink>
                      {" · "}
                      {w.provider}
                    </div>
                    <div className="work-meta">
                      远端收藏：{w.remoteInFavorites ? "是" : "否（本地保留）"}
                    </div>
                    <div className="work-actions">
                      <span className="badge soft">{w.provider}</span>
                      <span className="badge soft">点播</span>
                      {w.status === "downloaded" ? (
                        <button
                          type="button"
                          className={
                            viewMode === "small"
                              ? "play-icon-btn icon-btn"
                              : undefined
                          }
                          aria-label={
                            viewMode === "small" ? `播放 ${w.title}` : undefined
                          }
                          onClick={() => playVod(w)}
                        >
                          <IconPlay width={14} height={14} />
                          {viewMode === "small" ? null : "播放"}
                        </button>
                      ) : (
                        <span className="muted small">不可播</span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!loading && items.length > 0 && showLoadMore ? (
        <div className="library-load-more">
          <button
            type="button"
            className="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
