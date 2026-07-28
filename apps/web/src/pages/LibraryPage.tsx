import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Box, Button, Typography, TextField, Alert, CircularProgress,
  ToggleButtonGroup, ToggleButton,
  FormControl, Select, MenuItem,
} from "@mui/material";
import { Search, GridView, ViewList, ViewModule, Mic } from "@mui/icons-material";
import type { LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { EmptyState } from "../components/EmptyState";
import { InfiniteScrollSentinel } from "../components/InfiniteScrollSentinel";
import { libraryLayoutSx, liveToTrack, publishTimestamp, workToTrack } from "../components/LibraryMeta";
import { MediaItem, type LibraryItem } from "../components/MediaItem";
import { RecentlyAddedRail, type RecentRailItem } from "../components/RecentlyAddedRail";
import { usePlayer } from "../player/PlayerContext";
import { ASMR } from "../theme";
import { useThemeMode } from "../ThemeContext";

type LibraryViewMode = "small" | "standard" | "list";
type KindFilter = "all" | "vod" | "live";

const VIEW_MODE_KEY = "erolib.library.viewMode";
const PAGE_SIZE = 50;
const API_MAX_LIMIT = 200;
const RECENT_FETCH_LIMIT = 200;
const RECENT_RAIL_SIZE = 60;
const DEFAULT_RECENT_DAYS = 7;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "updated_desc", label: "最近发布" },
  { value: "title_asc", label: "标题" },
  { value: "title_desc", label: "标题 Z-A" },
  { value: "duration_desc", label: "时长" },
  { value: "duration_asc", label: "时长 ↑" },
];

function readViewMode(): LibraryViewMode {
  try { const raw = localStorage.getItem(VIEW_MODE_KEY); if (raw === "small" || raw === "standard" || raw === "list") return raw; } catch {}
  return "standard";
}
function parseKind(raw: string | null): KindFilter { if (raw === "vod" || raw === "live" || raw === "all") return raw; return "all"; }

function compareLibraryItems(a: LibraryItem, b: LibraryItem, sort: string): number {
  const dir = sort.endsWith("_asc") ? 1 : -1;
  if (sort.startsWith("title")) {
    const ta = a.kind === "vod" ? a.work.title : (a.media.title || a.media.roomId);
    const tb = b.kind === "vod" ? b.work.title : (b.media.title || b.media.roomId);
    return dir * ta.localeCompare(tb);
  }
  if (sort.startsWith("duration")) {
    const da = a.kind === "vod" ? a.work.durationSeconds : a.media.durationSeconds;
    const db = b.kind === "vod" ? b.work.durationSeconds : b.media.durationSeconds;
    return dir * ((da ?? 0) - (db ?? 0));
  }
  // default: source publish date
  const pa = a.kind === "vod" ? a.work.publishedAt : a.media.recordedAt;
  const pb = b.kind === "vod" ? b.work.publishedAt : b.media.recordedAt;
  return dir * (pa ?? "").localeCompare(pb ?? "");
}

async function fetchUpToCount<T>(fetchPage: (limit: number, offset: number) => Promise<T[]>, targetCount: number): Promise<{ items: T[]; hasMore: boolean }> {
  const target = Math.max(PAGE_SIZE, targetCount);
  const items: T[] = [];
  let offset = 0;
  while (items.length < target) {
    const limit = Math.min(API_MAX_LIMIT, target - items.length);
    const page = await fetchPage(limit, offset);
    items.push(...page);
    offset += page.length;
    if (page.length < limit) return { items, hasMore: false };
    if (items.length >= target) return { items, hasMore: true };
  }
  return { items, hasMore: false };
}

export function LibraryPage({ active = true }: { active?: boolean }) {
  const { play } = usePlayer();
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [searchParams, setSearchParams] = useSearchParams();
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>([]);
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState<KindFilter>(() => parseKind(searchParams.get("type")));
  const [sort, setSort] = useState("updated_desc");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [vodOffset, setVodOffset] = useState(0);
  const [liveOffset, setLiveOffset] = useState(0);
  const [vodHasMore, setVodHasMore] = useState(false);
  const [liveHasMore, setLiveHasMore] = useState(false);
  const [viewMode, setViewMode] = useState<LibraryViewMode>(readViewMode);
  const [recentWorks, setRecentWorks] = useState<WorkPublic[]>([]);
  const [recentLive, setRecentLive] = useState<LiveMediaPublic[]>([]);
  const [recentDays, setRecentDays] = useState(DEFAULT_RECENT_DAYS);
  const requestIdRef = useRef(0);

  const wantVod = kind === "all" || kind === "vod";
  const wantLive = kind === "all" || kind === "live";
  const hasMore = (wantVod && vodHasMore) || (wantLive && liveHasMore);

  function playVod(w: WorkPublic): void {
    const queue = works.map(workToTrack);
    play(workToTrack(w), queue);
  }
  function playLive(m: LiveMediaPublic, title: string): void {
    const queue = liveItems.map((x) => liveToTrack(x, x.title || x.roomId));
    play(liveToTrack(m, title), queue);
  }
  async function deleteLive(m: LiveMediaPublic): Promise<void> {
    if (!confirm(`删除直播录制「${m.title || m.roomId}」？`)) return;
    try { setError(null); await api.deleteLiveMedia(m.provider, m.roomId); setLiveItems((prev) => prev.filter((x) => !(x.provider === m.provider && x.roomId === m.roomId))); setLiveOffset((prev) => Math.max(0, prev - 1)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function loadInitial(): Promise<void> {
    const reqId = ++requestIdRef.current;
    try {
      setError(null); setLoading(true); setLoadingMore(false);
      setVodOffset(0); setLiveOffset(0); setVodHasMore(false); setLiveHasMore(false);
      const fetchVod = kind === "all" || kind === "vod";
      const fetchLive = kind === "all" || kind === "live";
      const sortParam = sort === "updated_desc" ? undefined : sort;
      const [vodResult, liveResult] = await Promise.all([
        fetchVod ? fetchUpToCount((l, o) => api.works({ q: q || undefined, status: "downloaded", provider: provider || undefined, sort: sortParam, limit: l, offset: o }), PAGE_SIZE) : Promise.resolve({ items: [] as WorkPublic[], hasMore: false }),
        fetchLive ? fetchUpToCount((l, o) => api.liveMedia({ q: q || undefined, provider: provider || undefined, sort: sortParam, limit: l, offset: o }), PAGE_SIZE) : Promise.resolve({ items: [] as LiveMediaPublic[], hasMore: false }),
      ]);
      if (reqId !== requestIdRef.current) return;
      setWorks(vodResult.items); setLiveItems(liveResult.items);
      setVodOffset(vodResult.items.length); setLiveOffset(liveResult.items.length);
      setVodHasMore(fetchVod && vodResult.hasMore); setLiveHasMore(fetchLive && liveResult.hasMore);
    } catch (e) { if (reqId === requestIdRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (reqId === requestIdRef.current) setLoading(false); }
  }

  async function loadMore(): Promise<void> {
    if (loading || loadingMore) return;
    const fetchVod = (kind === "all" || kind === "vod") && vodHasMore;
    const fetchLive = (kind === "all" || kind === "live") && liveHasMore;
    if (!fetchVod && !fetchLive) return;
    const reqId = ++requestIdRef.current;
    try {
      setError(null); setLoadingMore(true);
      const sortParam = sort === "updated_desc" ? undefined : sort;
      const [vod, live] = await Promise.all([
        fetchVod ? api.works({ q: q || undefined, status: "downloaded", provider: provider || undefined, sort: sortParam, limit: PAGE_SIZE, offset: vodOffset }) : Promise.resolve([] as WorkPublic[]),
        fetchLive ? api.liveMedia({ q: q || undefined, provider: provider || undefined, sort: sortParam, limit: PAGE_SIZE, offset: liveOffset }) : Promise.resolve([] as LiveMediaPublic[]),
      ]);
      if (reqId !== requestIdRef.current) return;
      if (fetchVod) {
        setWorks((prev) => { const seen = new Set(prev.map((w) => `${w.provider}:${w.workId}`)); return [...prev, ...vod.filter((w) => !seen.has(`${w.provider}:${w.workId}`))]; });
        setVodOffset((prev) => prev + vod.length); setVodHasMore(vod.length === PAGE_SIZE);
      }
      if (fetchLive) {
        setLiveItems((prev) => { const seen = new Set(prev.map((m) => `${m.provider}:${m.roomId}`)); return [...prev, ...live.filter((m) => !seen.has(`${m.provider}:${m.roomId}`))]; });
        setLiveOffset((prev) => prev + live.length); setLiveHasMore(live.length === PAGE_SIZE);
      }
    } catch (e) { if (reqId === requestIdRef.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (reqId === requestIdRef.current) setLoadingMore(false); }
  }

  useEffect(() => { void loadInitial(); }, [kind, provider, sort]);

  // Keep-alive: ignore URL changes from other routes (e.g. /works/...) while hidden.
  useEffect(() => {
    if (!active) return;
    const next = parseKind(searchParams.get("type"));
    if (next !== kind) setKind(next);
  }, [active, searchParams, kind]);

  // Independent of filters — always reflects the whole library's newest arrivals.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [w, l, s] = await Promise.all([
          api.works({ status: "downloaded", limit: RECENT_FETCH_LIMIT }),
          api.liveMedia({ limit: RECENT_FETCH_LIMIT }),
          api.settings().catch(() => null),
        ]);
        if (!cancelled) {
          setRecentWorks(w); setRecentLive(l);
          if (s) setRecentDays(s.recentDays);
        }
      } catch { /* decorative widget only */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const items = useMemo((): LibraryItem[] => {
    const v: LibraryItem[] = works.map((w) => ({ kind: "vod", key: `vod:${w.provider}:${w.workId}`, work: w }));
    const l: LibraryItem[] = liveItems.map((m) => ({ kind: "live", key: `live:${m.provider}:${m.roomId}`, media: m }));
    return [...v, ...l].sort((a, b) => compareLibraryItems(a, b, sort));
  }, [works, liveItems, sort]);

  const recentItems = useMemo((): RecentRailItem[] => {
    const merged: { at: string; item: RecentRailItem }[] = [
      ...recentWorks.map((w) => ({
        at: w.downloadedAt ?? w.createdAt,
        item: {
          key: `vod:${w.provider}:${w.workId}`, kind: "vod" as const, provider: w.provider, mediaId: w.workId,
          title: w.title, authorName: w.authorName, coverPath: w.coverPath, publishedAt: w.publishedAt,
          onPlay: () => play(workToTrack(w), recentWorks.map(workToTrack)),
        },
      })),
      ...recentLive.map((m) => {
        const title = m.title || m.roomId;
        return {
          at: m.createdAt,
          item: {
            key: `live:${m.provider}:${m.roomId}`, kind: "live" as const, provider: m.provider, mediaId: m.roomId,
            title, authorName: m.authorName, coverPath: null, publishedAt: m.recordedAt,
            onPlay: () => play(liveToTrack(m, title), recentLive.map((x) => liveToTrack(x, x.title || x.roomId))),
          },
        };
      }),
    ];
    const cutoff = recentDays > 0 ? Date.now() - recentDays * 86_400_000 : null;
    const inRange = cutoff === null ? merged : merged.filter(({ item }) => {
      const t = publishTimestamp(item.publishedAt);
      return t !== null && t >= cutoff;
    });
    return inRange.sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_RAIL_SIZE).map((e) => e.item);
  }, [recentWorks, recentLive, recentDays, play]);

  const isList = viewMode === "list";
  const listSurface = isLight ? "#fff" : ASMR.drawerDark;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">Library</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>浏览已备份下载的点播与直播录制。</Typography>
      </Box>

      <RecentlyAddedRail items={recentItems} days={recentDays} />

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <TextField size="small" placeholder="搜索标题 / 作者" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void loadInitial(); }} sx={{ minWidth: 180 }} />
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <Select value={kind} onChange={(e) => { const next = parseKind(e.target.value as string); setKind(next); const sp = new URLSearchParams(searchParams); if (next === "all") sp.delete("type"); else sp.set("type", next); setSearchParams(sp, { replace: true }); }}>
            <MenuItem value="all">全部类型</MenuItem><MenuItem value="vod">点播</MenuItem><MenuItem value="live">直播</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} displayEmpty>
            <MenuItem value="">全部渠道</MenuItem><MenuItem value="otobanana">Otobanana</MenuItem><MenuItem value="koekoe">Koe-koe</MenuItem><MenuItem value="erovoice">Erovoice</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" color="primary" startIcon={<Search />} onClick={() => { void loadInitial(); }}>搜索</Button>
        <ToggleButtonGroup value={viewMode} exclusive size="small" onChange={(_, v) => { if (v) { setViewMode(v); localStorage.setItem(VIEW_MODE_KEY, v); } }}>
          <ToggleButton value="small" aria-label="小尺寸"><ViewModule fontSize="small" /></ToggleButton>
          <ToggleButton value="standard" aria-label="标准尺寸"><GridView fontSize="small" /></ToggleButton>
          <ToggleButton value="list" aria-label="列表"><ViewList fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.disabled", py: 4 }}>
          <CircularProgress size={18} /><Typography variant="body2">正在加载媒体库…</Typography>
        </Box>
      ) : items.length === 0 ? (
        <EmptyState icon={<Mic sx={{ width: 36, height: 36 }} />} title="暂无条目"
          description="点播：Providers 绑定后同步收藏。直播：在「同步」页订阅作者并完成录制。"
          action={<Box sx={{ display: "flex", gap: 1 }}><Button variant="contained" color="primary" component={Link} to="/settings">配置 Provider</Button><Button variant="outlined" component={Link} to="/sync">直播录制</Button></Box>} />
      ) : (
        <>
          <Box sx={libraryLayoutSx(isList, viewMode, listSurface)}>
            {items.map((item, index) => (
              <MediaItem
                key={item.key}
                item={item}
                viewMode={viewMode}
                index={index}
                total={items.length}
                onPlay={
                  item.kind === "vod"
                    ? () => playVod(item.work)
                    : () => playLive(item.media, item.media.title || item.media.roomId)
                }
                titleHref={item.kind === "vod" ? `/works/${item.work.provider}/${item.work.workId}` : undefined}
                showDelete={item.kind === "live"}
                onDelete={item.kind === "live" ? () => { void deleteLive(item.media); } : undefined}
                providerClickable
                onProviderClick={setProvider}
              />
            ))}
          </Box>
          <InfiniteScrollSentinel active={active && hasMore} loading={loadingMore} onVisible={loadMore} />
        </>
      )}
    </Box>
  );
}
