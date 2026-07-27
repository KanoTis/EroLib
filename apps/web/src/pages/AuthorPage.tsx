import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Box, Card, CardContent, CardActions, Typography, Button, Alert, Chip, CircularProgress,
  ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { ArrowBack, OpenInNew, PlayArrow, GridView, ViewList, ViewModule } from "@mui/icons-material";
import type { AuthorPublic, LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { authorSourceUrl } from "../authorSourceUrl";
import { AuthorAvatar } from "../components/AuthorAvatar";
import { CoverImage } from "../components/CoverImage";
import { AuthorLink } from "../components/AuthorLink";
import { formatDuration, libraryLayoutSx, liveToTrack, MetaRow, providerLabel, workToTrack } from "../components/LibraryMeta";
import { InfiniteScrollSentinel } from "../components/InfiniteScrollSentinel";
import { usePlayer } from "../player/PlayerContext";
import { ASMR } from "../theme";
import { useThemeMode } from "../ThemeContext";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载", queued: "队列中", downloading: "下载中", failed: "失败", discovered: "已发现",
};
const PAGE_SIZE = 50;
type AuthorViewMode = "small" | "standard" | "list";
const VIEW_MODE_KEY = "erolib.library.viewMode";

function readViewMode(): AuthorViewMode {
  try { const raw = localStorage.getItem(VIEW_MODE_KEY); if (raw === "small" || raw === "standard" || raw === "list") return raw; } catch {}
  return "standard";
}

export function AuthorPage() {
  const { provider = "", authorId = "" } = useParams();
  const { play } = usePlayer();
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [author, setAuthor] = useState<AuthorPublic | null>(null);
  const [works, setWorks] = useState<WorkPublic[]>([]);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>([]);
  const [worksOffset, setWorksOffset] = useState(0);
  const [liveOffset, setLiveOffset] = useState(0);
  const [worksHasMore, setWorksHasMore] = useState(false);
  const [liveHasMore, setLiveHasMore] = useState(false);
  const [worksLoadingMore, setWorksLoadingMore] = useState(false);
  const [liveLoadingMore, setLiveLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<AuthorViewMode>(readViewMode);
  const worksReqIdRef = useRef(0);
  const liveReqIdRef = useRef(0);

  const loadAuthor = useCallback(async () => { setAuthor(await api.getAuthor(provider, authorId)); }, [provider, authorId]);
  const loadLists = useCallback(async () => {
    const [vodBatch, liveBatch] = await Promise.all([
      api.works({ provider, authorId, limit: PAGE_SIZE, offset: 0 }),
      api.liveMedia({ provider, authorId, limit: PAGE_SIZE, offset: 0 }),
    ]);
    setWorks(vodBatch); setLiveItems(liveBatch);
    setWorksOffset(vodBatch.length); setLiveOffset(liveBatch.length);
    setWorksHasMore(vodBatch.length === PAGE_SIZE); setLiveHasMore(liveBatch.length === PAGE_SIZE);
  }, [provider, authorId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setMsg(null);
    void (async () => { try { await Promise.all([loadAuthor(), loadLists()]); } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [loadAuthor, loadLists]);

  async function loadMoreWorks(): Promise<void> {
    if (worksLoadingMore) return;
    const reqId = ++worksReqIdRef.current;
    setWorksLoadingMore(true);
    try {
      const batch = await api.works({ provider, authorId, limit: PAGE_SIZE, offset: worksOffset });
      if (reqId !== worksReqIdRef.current) return;
      setWorks((prev) => [...prev, ...batch]); setWorksOffset((o) => o + batch.length); setWorksHasMore(batch.length === PAGE_SIZE);
    } catch (e) {
      if (reqId === worksReqIdRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqId === worksReqIdRef.current) setWorksLoadingMore(false);
    }
  }
  async function loadMoreLive(): Promise<void> {
    if (liveLoadingMore) return;
    const reqId = ++liveReqIdRef.current;
    setLiveLoadingMore(true);
    try {
      const batch = await api.liveMedia({ provider, authorId, limit: PAGE_SIZE, offset: liveOffset });
      if (reqId !== liveReqIdRef.current) return;
      setLiveItems((prev) => [...prev, ...batch]); setLiveOffset((o) => o + batch.length); setLiveHasMore(batch.length === PAGE_SIZE);
    } catch (e) {
      if (reqId === liveReqIdRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqId === liveReqIdRef.current) setLiveLoadingMore(false);
    }
  }
  async function onAddSubscription(): Promise<void> {
    if (!author) return; setBusy(true); setError(null); setMsg(null);
    try { await api.addLiveSubscription({ provider: author.provider, authorId: author.authorId, username: author.username, displayName: author.displayName, enabled: false, syncWorks: false }); setMsg("已添加订阅"); await loadAuthor(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function onToggle(key: "enabled" | "syncWorks", next: boolean): Promise<void> {
    if (!author?.subscription) return; setBusy(true); setError(null);
    try { await api.patchLiveSubscription(author.subscription.id, { [key]: next }); await loadAuthor(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function playVod(w: WorkPublic): void {
    const queue = works.filter((x) => x.status === "downloaded").map(workToTrack);
    play(workToTrack(w), queue);
  }
  function playLive(m: LiveMediaPublic, title: string): void {
    const queue = liveItems.map((x) => liveToTrack(x, x.title || x.roomId));
    play(liveToTrack(m, title), queue);
  }

  if (loading && !author) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.disabled" }}>
        <CircularProgress size={18} /><Typography variant="body2">加载作者页…</Typography>
      </Box>
    );
  }
  if (error && !author) {
    return <Box><Button component={Link} to="/" startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回媒体库</Button><Alert severity="error">{error}</Alert></Box>;
  }
  if (!author) {
    return <Box><Button component={Link} to="/" startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回媒体库</Button><Typography color="text.disabled">未找到作者</Typography></Box>;
  }

  const displayName = author.displayName || author.username || author.authorId;
  const sourceUrl = authorSourceUrl(author.provider, author.authorId);
  const isList = viewMode === "list";
  const isSmall = viewMode === "small" && !isList;
  const listSurface = isLight ? "#fff" : ASMR.drawerDark;

  return (
    <Box>
      <Button component={Link} to="/" startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回媒体库</Button>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
            <AuthorAvatar provider={author.provider} authorId={author.authorId} displayName={displayName} hasAvatar={author.hasAvatar} size="lg" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="overline" color="text.disabled">{providerLabel(author.provider)}</Typography>
              <Typography variant="h4">{displayName}</Typography>
              <Box sx={{ display: "flex", gap: 1.5, mt: 0.5, flexWrap: "wrap" }}>
                {author.username && <Typography variant="body2" color="text.disabled">@{author.username}</Typography>}
                <Typography variant="body2" color="text.disabled" sx={{ wordBreak: "break-all" }}>{author.authorId}</Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", ml: "auto" }}>
              {sourceUrl ? (
                <Button
                  size="small"
                  variant="outlined"
                  component="a"
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={<OpenInNew />}
                >
                  打开源站
                </Button>
              ) : null}
              {author.subscription ? (
                <>
                  <Chip label="已订阅" size="small" variant="outlined" color="success" />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2">同步作品</Typography>
                    <Button size="small" variant="outlined" disabled={busy} onClick={() => { void onToggle("syncWorks", !author.subscription!.syncWorks); }}>{author.subscription.syncWorks ? "开" : "关"}</Button>
                  </Box>
                  {author.provider === "otobanana" ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2">自动录制</Typography>
                      <Button size="small" variant="outlined" disabled={busy} onClick={() => { void onToggle("enabled", !author.subscription!.enabled); }}>{author.subscription.enabled ? "开" : "关"}</Button>
                    </Box>
                  ) : null}
                </>
              ) : (
                <Button variant="contained" color="primary" size="small" disabled={busy} onClick={() => { void onAddSubscription(); }}>添加订阅</Button>
              )}
            </Box>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {msg && <Alert severity="success">{msg}</Alert>}
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <ToggleButtonGroup value={viewMode} exclusive size="small" onChange={(_, v) => { if (v) { setViewMode(v); localStorage.setItem(VIEW_MODE_KEY, v); } }}>
          <ToggleButton value="small" aria-label="小尺寸"><ViewModule fontSize="small" /></ToggleButton>
          <ToggleButton value="standard" aria-label="标准尺寸"><GridView fontSize="small" /></ToggleButton>
          <ToggleButton value="list" aria-label="列表"><ViewList fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>点播作品</Typography>
        {works.length === 0 ? (
          <Typography color="text.disabled">暂无该作者的本地点播作品</Typography>
        ) : (
          <>
            <Box sx={libraryLayoutSx(isList, viewMode, listSurface)}>
              {works.map((w, index) => {
                const sc = w.status === "downloaded" ? "success" as const : w.status === "failed" ? "error" as const : w.status === "downloading" || w.status === "queued" ? "warning" as const : "default" as const;
                if (isList) {
                  return (
                    <Box
                      key={`vod:${w.id}`}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        pl: 0,
                        pr: 2,
                        py: 0,
                        borderBottom: index < works.length - 1 ? "1px solid" : "none",
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
                          <Chip label={STATUS_LABEL[w.status] ?? w.status} size="small" color={sc} />
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
                return (
                  <Card key={`vod:${w.id}`} sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <CoverImage provider={w.provider} workId={w.workId} title={w.title} authorName={w.authorName} coverPath={w.coverPath} size="card" />
                    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <CardContent sx={{ flex: 1, py: 1 }}>
                        <Typography
                          component={Link}
                          to={`/works/${w.provider}/${w.workId}`}
                          sx={{
                            fontWeight: 600,
                            fontSize: "0.95rem",
                            color: "text.primary",
                            textDecoration: "none",
                            "&:hover": { color: "primary.main" },
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {w.title}
                        </Typography>
                        <Typography variant="body2" color="text.disabled" noWrap>
                          <AuthorLink provider={w.provider} authorId={w.authorId}>{w.authorName ?? w.authorId ?? "未知作者"}</AuthorLink>
                          {" · "}{providerLabel(w.provider)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">时长 {formatDuration(w.durationSeconds)}</Typography>
                      </CardContent>
                      <CardActions sx={{ pt: 0, flexWrap: "wrap", gap: 0.5 }}>
                        <Chip label={STATUS_LABEL[w.status] ?? w.status} size="small" color={sc} />
                        {w.status === "downloaded" ? (
                          <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playVod(w)}>{isSmall ? "" : "播放"}</Button>
                        ) : (
                          <Typography variant="caption" color="text.disabled">不可播</Typography>
                        )}
                      </CardActions>
                    </Box>
                  </Card>
                );
              })}
            </Box>
            <InfiniteScrollSentinel active={worksHasMore} loading={worksLoadingMore} onVisible={loadMoreWorks} />
          </>
        )}
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>直播回放</Typography>
        {liveItems.length === 0 ? (
          <Typography color="text.disabled">暂无该作者的本地直播回放</Typography>
        ) : (
          <>
            <Box sx={libraryLayoutSx(isList, viewMode, listSurface)}>
              {liveItems.map((m, index) => {
                const title = m.title || m.roomId;
                if (isList) {
                  return (
                    <Box
                      key={`live:${m.id}`}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        pl: 0,
                        pr: 2,
                        py: 0,
                        borderBottom: index < liveItems.length - 1 ? "1px solid" : "none",
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
                      <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playLive(m, title)}>播放</Button>
                      </Box>
                    </Box>
                  );
                }
                return (
                  <Card key={`live:${m.id}`} sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                        <Chip label="直播" size="small" color="warning" />
                        <Button size="small" variant="contained" color="primary" startIcon={<PlayArrow />} onClick={() => playLive(m, title)}>{isSmall ? "" : "播放"}</Button>
                      </CardActions>
                    </Box>
                  </Card>
                );
              })}
            </Box>
            <InfiniteScrollSentinel active={liveHasMore} loading={liveLoadingMore} onVisible={loadMoreLive} />
          </>
        )}
      </Box>
    </Box>
  );
}
