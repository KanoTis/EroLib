import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Box, Button, Card, CardContent, CardActions,
  Typography, TextField, Chip, Alert, CircularProgress,
  ToggleButtonGroup, ToggleButton,
  FormControl, Select, MenuItem,
} from "@mui/material";
import { PlayArrow, Search, GridView, ViewList, ViewModule, Mic } from "@mui/icons-material";
import type { LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { CoverImage } from "../components/CoverImage";
import { AuthorLink } from "../components/AuthorLink";
import { EmptyState } from "../components/EmptyState";
import { usePlayer } from "../player/PlayerContext";
import { ASMR } from "../theme";
import { useThemeMode } from "../ThemeContext";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载", queued: "队列中", downloading: "下载中", failed: "失败", discovered: "已发现",
};

const PROVIDER_LABEL: Record<string, string> = {
  otobanana: "Otobanana",
  koekoe: "Koe-koe",
  erovoice: "Erovoice",
};

type LibraryViewMode = "small" | "standard" | "list";
type KindFilter = "all" | "vod" | "live";
type LibraryItem =
  | { kind: "vod"; key: string; sortAt: string; work: WorkPublic }
  | { kind: "live"; key: string; sortAt: string; media: LiveMediaPublic };

const VIEW_MODE_KEY = "erolib.library.viewMode";
const PAGE_SIZE = 50;
const API_MAX_LIMIT = 200;

function readViewMode(): LibraryViewMode {
  try { const raw = localStorage.getItem(VIEW_MODE_KEY); if (raw === "small" || raw === "standard" || raw === "list") return raw; } catch {}
  return "standard";
}
function parseKind(raw: string | null): KindFilter { if (raw === "vod" || raw === "live" || raw === "all") return raw; return "all"; }

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
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

/** asmr.one-style meta: value / value / value */
function MetaRow({ parts }: { parts: ReactNode[] }) {
  const items = parts.filter((p) => p != null && p !== false && p !== "");
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 1,
        rowGap: 0.25,
        color: "text.secondary",
        fontSize: "0.8125rem",
        lineHeight: 1.4,
        minWidth: 0,
      }}
    >
      {items.map((part, i) => (
        <Box key={i} component="span" sx={{ display: "contents" }}>
          {i > 0 && (
            <Box component="span" sx={{ opacity: 0.55, flexShrink: 0 }}>/</Box>
          )}
          <Box
            component="span"
            sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {part}
          </Box>
        </Box>
      ))}
    </Box>
  );
}


export function LibraryPage() {
  const { play } = usePlayer();
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [searchParams, setSearchParams] = useSearchParams();
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState<KindFilter>(() => parseKind(searchParams.get("type")));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [vodOffset, setVodOffset] = useState(0);
  const [liveOffset, setLiveOffset] = useState(0);
  const [vodHasMore, setVodHasMore] = useState(false);
  const [liveHasMore, setLiveHasMore] = useState(false);
  const [viewMode, setViewMode] = useState<LibraryViewMode>(readViewMode);
  const requestIdRef = useRef(0);

  const wantVod = kind === "all" || kind === "vod";
  const wantLive = kind === "all" || kind === "live";
  const showLoadMore = (wantVod && vodHasMore) || (wantLive && liveHasMore);

  function playVod(w: WorkPublic): void {
    play({ id: `vod:${w.provider}:${w.workId}`, kind: "vod", provider: w.provider, mediaId: w.workId, title: w.title, subtitle: w.authorName ?? w.authorId ?? undefined, src: api.audioUrl(w.provider, w.workId), artworkUrl: w.coverPath ? api.coverUrl(w.provider, w.workId) : null });
  }
  function playLive(m: LiveMediaPublic, title: string): void {
    play({ id: `live:${m.provider}:${m.roomId}`, kind: "live", provider: m.provider, mediaId: m.roomId, title, subtitle: m.authorName ?? m.authorId ?? undefined, src: api.liveAudioUrl(m.provider, m.roomId) });
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
      const [vodResult, liveResult] = await Promise.all([
        fetchVod ? fetchUpToCount((l, o) => api.works({ q: q || undefined, status: status || undefined, provider: provider || undefined, limit: l, offset: o }), PAGE_SIZE) : Promise.resolve({ items: [] as WorkPublic[], hasMore: false }),
        fetchLive ? fetchUpToCount((l, o) => api.liveMedia({ q: q || undefined, provider: provider || undefined, limit: l, offset: o }), PAGE_SIZE) : Promise.resolve({ items: [] as LiveMediaPublic[], hasMore: false }),
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
      const [vod, live] = await Promise.all([
        fetchVod ? api.works({ q: q || undefined, status: status || undefined, provider: provider || undefined, limit: PAGE_SIZE, offset: vodOffset }) : Promise.resolve([] as WorkPublic[]),
        fetchLive ? api.liveMedia({ q: q || undefined, provider: provider || undefined, limit: PAGE_SIZE, offset: liveOffset }) : Promise.resolve([] as LiveMediaPublic[]),
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

  useEffect(() => { void loadInitial(); }, [kind]);
  useEffect(() => { const next = parseKind(searchParams.get("type")); if (next !== kind) setKind(next); }, [searchParams, kind]);

  const items = useMemo((): LibraryItem[] => {
    const v: LibraryItem[] = works.map((w) => ({ kind: "vod", key: `vod:${w.provider}:${w.workId}`, sortAt: w.updatedAt || w.createdAt, work: w }));
    const l: LibraryItem[] = liveItems.map((m) => ({ kind: "live", key: `live:${m.provider}:${m.roomId}`, sortAt: m.updatedAt || m.recordedAt || m.createdAt, media: m }));
    return [...v, ...l].sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  }, [works, liveItems]);

  const isList = viewMode === "list";
  const listSurface = isLight ? "#fff" : ASMR.drawerDark;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">Library</Typography>
        <Typography variant="h4">媒体库</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>浏览已备份点播与直播录制。</Typography>
      </Box>

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
        {kind !== "live" && (
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} displayEmpty>
              <MenuItem value="">全部状态</MenuItem><MenuItem value="downloaded">已下载</MenuItem><MenuItem value="queued">队列中</MenuItem><MenuItem value="downloading">下载中</MenuItem><MenuItem value="failed">失败</MenuItem><MenuItem value="discovered">已发现</MenuItem>
            </Select>
          </FormControl>
        )}
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
          action={<Box sx={{ display: "flex", gap: 1 }}><Button variant="contained" color="primary" component={Link} to="/providers">配置 Provider</Button><Button variant="outlined" component={Link} to="/live">直播录制</Button></Box>} />
      ) : (
        <>
          <Box
            sx={
              isList
                ? {
                    display: "flex",
                    flexDirection: "column",
                    bgcolor: listSurface,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 0,
                    overflow: "hidden",
                  }
                : {
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${viewMode === "small" ? 148 : 220}px, 1fr))`,
                    gap: 2,
                  }
            }
          >
            {items.map((item, index) => {
              const isSmall = viewMode === "small" && !isList;

              if (isList) {
                if (item.kind === "live") {
                  const m = item.media;
                  const title = m.title || m.roomId;
                  return (
                    <Box
                      key={item.key}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        pl: 0,
                        pr: 2,
                        py: 0,
                        borderBottom: index < items.length - 1 ? "1px solid" : "none",
                        borderColor: "divider",
                        "&:hover": { bgcolor: isLight ? "rgba(25,118,210,0.04)" : "rgba(255,255,255,0.04)" },
                      }}
                    >
                      <CoverImage provider={m.provider} workId={m.roomId} title={title} authorName={m.authorName} coverPath={null} size="list" />
                      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5, py: 1.25 }}>
                        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</Typography>
                        <MetaRow parts={[
                          <AuthorLink key="a" provider={m.provider} authorId={m.authorId}>{m.authorName ?? m.authorId ?? "未知"}</AuthorLink>,
                          providerLabel(m.provider),
                          formatDuration(m.durationSeconds),
                        ]} />
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                          <Chip label="直播" size="small" color="warning" />
                        </Box>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playLive(m, title)}>播放</Button>
                        <Button size="small" color="error" variant="outlined" onClick={() => { void deleteLive(m); }}>删除</Button>
                      </Box>
                    </Box>
                  );
                }

                const w = item.work;
                const statusColor = w.status === "downloaded" ? "success" as const : w.status === "failed" ? "error" as const : w.status === "downloading" || w.status === "queued" ? "warning" as const : "default" as const;
                return (
                  <Box
                    key={item.key}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      pl: 0,
                      pr: 2,
                      py: 0,
                      borderBottom: index < items.length - 1 ? "1px solid" : "none",
                      borderColor: "divider",
                      "&:hover": { bgcolor: isLight ? "rgba(25,118,210,0.04)" : "rgba(255,255,255,0.04)" },
                    }}
                  >
                    <CoverImage provider={w.provider} workId={w.workId} title={w.title} authorName={w.authorName} coverPath={w.coverPath} size="list" />
                    <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5, py: 1.25 }}>
                      <Typography
                        component={Link}
                        to={`/works/${w.provider}/${w.workId}`}
                        noWrap
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.95rem",
                          color: "text.primary",
                          textDecoration: "none",
                          "&:hover": { color: "primary.main" },
                        }}
                      >
                        {w.title}
                      </Typography>
                      <MetaRow parts={[
                        <AuthorLink key="a" provider={w.provider} authorId={w.authorId}>{w.authorName ?? w.authorId ?? "未知作者"}</AuthorLink>,
                        providerLabel(w.provider),
                        formatDuration(w.durationSeconds),
                      ]} />
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                        <Chip label="点播" size="small" variant="outlined" />
                        <Chip label={STATUS_LABEL[w.status] ?? w.status} size="small" color={statusColor} />
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                      {w.status === "downloaded" ? (
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playVod(w)}>播放</Button>
                      ) : (
                        <Typography variant="caption" color="text.disabled">不可播</Typography>
                      )}
                    </Box>
                  </Box>
                );
              }

              // ---- Grid / card views ----
              if (item.kind === "live") {
                const m = item.media; const title = m.title || m.roomId;
                return (
                  <Card key={item.key} sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <CoverImage provider={m.provider} workId={m.roomId} title={title} authorName={m.authorName} coverPath={null} size="card" />
                    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <CardContent sx={{ flex: 1, py: 1 }}>
                        <Typography sx={{ fontWeight: 600, fontSize: "0.95rem", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{title}</Typography>
                        <Typography variant="body2" color="text.disabled" noWrap>
                          {m.authorName ?? m.authorId} · {providerLabel(m.provider)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">时长 {formatDuration(m.durationSeconds)}</Typography>
                      </CardContent>
                      <CardActions sx={{ pt: 0, flexWrap: "wrap", gap: 0.5 }}>
                        <Chip label={providerLabel(m.provider)} size="small" variant="outlined" />
                        <Chip label="直播" size="small" color="warning" />
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playLive(m, title)}>{isSmall ? "" : "播放"}</Button>
                        <Button size="small" color="error" variant="outlined" onClick={() => { void deleteLive(m); }}>{isSmall ? "×" : "删除"}</Button>
                      </CardActions>
                    </Box>
                  </Card>
                );
              }
              const w = item.work;
              const statusColor = w.status === "downloaded" ? "success" as const : w.status === "failed" ? "error" as const : w.status === "downloading" || w.status === "queued" ? "warning" as const : "default" as const;
              return (
                <Card key={item.key} sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <CoverImage provider={w.provider} workId={w.workId} title={w.title} authorName={w.authorName} coverPath={w.coverPath} size="card" />
                  <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <CardContent sx={{ flex: 1, py: 1 }}>
                      <Typography component={Link} to={`/works/${w.provider}/${w.workId}`}
                        sx={{ fontWeight: 600, fontSize: "0.95rem", color: "text.primary", textDecoration: "none", "&:hover": { color: "primary.main" }, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{w.title}</Typography>
                      <Typography variant="body2" color="text.disabled" noWrap>
                        <AuthorLink provider={w.provider} authorId={w.authorId}>{w.authorName ?? w.authorId ?? "未知作者"}</AuthorLink>
                        {" · "}{providerLabel(w.provider)}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">时长 {formatDuration(w.durationSeconds)}</Typography>
                    </CardContent>
                    <CardActions sx={{ pt: 0, flexWrap: "wrap", gap: 0.5 }}>
                      <Chip label={providerLabel(w.provider)} size="small" variant="outlined" />
                      <Chip label={STATUS_LABEL[w.status] ?? w.status} size="small" color={statusColor} />
                      {w.status === "downloaded" ? (
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playVod(w)}>{isSmall ? "" : "播放"}</Button>
                      ) : <Typography variant="caption" color="text.disabled">不可播</Typography>}
                    </CardActions>
                  </Box>
                </Card>
              );
            })}
          </Box>
          {showLoadMore && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
              <Button variant="outlined" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "加载中…" : "加载更多"}</Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

