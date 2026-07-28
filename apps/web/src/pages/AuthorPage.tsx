import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip, CircularProgress,
  ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { ArrowBack, OpenInNew, GridView, ViewList, ViewModule } from "@mui/icons-material";
import type { AuthorPublic, LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { authorSourceUrl } from "../authorSourceUrl";
import { AuthorAvatar } from "../components/AuthorAvatar";
import { libraryLayoutSx, liveToTrack, providerLabel, workToTrack } from "../components/LibraryMeta";
import { MediaItem } from "../components/MediaItem";
import { InfiniteScrollSentinel } from "../components/InfiniteScrollSentinel";
import { useGoBack, usePageSnapshot } from "../navigation";
import { usePlayer } from "../player/PlayerContext";
import { ASMR } from "../theme";
import { useThemeMode } from "../ThemeContext";

const PAGE_SIZE = 50;
type AuthorViewMode = "small" | "standard" | "list";
const VIEW_MODE_KEY = "erolib.library.viewMode";

function readViewMode(): AuthorViewMode {
  try { const raw = localStorage.getItem(VIEW_MODE_KEY); if (raw === "small" || raw === "standard" || raw === "list") return raw; } catch {}
  return "standard";
}

interface AuthorSnapshot {
  author: AuthorPublic | null;
  works: WorkPublic[];
  liveItems: LiveMediaPublic[];
  worksOffset: number;
  liveOffset: number;
  worksHasMore: boolean;
  liveHasMore: boolean;
}

export function AuthorPage() {
  const { provider = "", authorId = "" } = useParams();
  const { play } = usePlayer();
  const { mode } = useThemeMode();
  const goBack = useGoBack();
  const isLight = mode === "light";
  const [restored, keepSnapshot] = usePageSnapshot<AuthorSnapshot>();
  const [author, setAuthor] = useState<AuthorPublic | null>(() => restored?.author ?? null);
  const [works, setWorks] = useState<WorkPublic[]>(() => restored?.works ?? []);
  const [liveItems, setLiveItems] = useState<LiveMediaPublic[]>(() => restored?.liveItems ?? []);
  const [worksOffset, setWorksOffset] = useState(() => restored?.worksOffset ?? 0);
  const [liveOffset, setLiveOffset] = useState(() => restored?.liveOffset ?? 0);
  const [worksHasMore, setWorksHasMore] = useState(() => restored?.worksHasMore ?? false);
  const [liveHasMore, setLiveHasMore] = useState(() => restored?.liveHasMore ?? false);
  const [worksLoadingMore, setWorksLoadingMore] = useState(false);
  const [liveLoadingMore, setLiveLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(!restored);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<AuthorViewMode>(readViewMode);
  const [mediaTab, setMediaTab] = useState<"vod" | "live">("vod");
  const worksReqIdRef = useRef(0);
  const liveReqIdRef = useRef(0);

  if (!loading) {
    if (!loading) {
    keepSnapshot({ author, works, liveItems, worksOffset, liveOffset, worksHasMore, liveHasMore });
  }
  }

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

  // A restored page already holds its lists; refetch only when we land on another author.
  const authorKey = `${provider}:${authorId}`;
  const loadedAuthorRef = useRef<string | null>(restored ? authorKey : null);
  useEffect(() => {
    if (loadedAuthorRef.current === authorKey) return;
    loadedAuthorRef.current = authorKey;
    let cancelled = false;
    setLoading(true); setError(null); setMsg(null);
    void (async () => { try { await Promise.all([loadAuthor(), loadLists()]); } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); } finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [authorKey, loadAuthor, loadLists]);

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
  async function deleteLiveMedia(m: LiveMediaPublic): Promise<void> {
    if (!confirm(`删除直播录制「${m.title || m.roomId}」？`)) return;
    try { setError(null); await api.deleteLiveMedia(m.provider, m.roomId); setLiveItems((prev) => prev.filter((x) => !(x.provider === m.provider && x.roomId === m.roomId))); setLiveOffset((prev) => Math.max(0, prev - 1)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
    return <Box><Button onClick={goBack} startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回</Button><Alert severity="error">{error}</Alert></Box>;
  }
  if (!author) {
    return <Box><Button onClick={goBack} startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回</Button><Typography color="text.disabled">未找到作者</Typography></Box>;
  }

  const displayName = author.displayName || author.username || author.authorId;
  const sourceUrl = authorSourceUrl(author.provider, author.authorId);
  const isList = viewMode === "list";
  const listSurface = isLight ? "#fff" : ASMR.drawerDark;

  return (
    <Box>
      <Button onClick={goBack} startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回</Button>

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

      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <ToggleButtonGroup value={mediaTab} exclusive size="small" onChange={(_, v) => { if (v) setMediaTab(v); }}>
          <ToggleButton value="vod">点播</ToggleButton>
          <ToggleButton value="live">直播</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup value={viewMode} exclusive size="small" onChange={(_, v) => { if (v) { setViewMode(v); localStorage.setItem(VIEW_MODE_KEY, v); } }}>
          <ToggleButton value="small" aria-label="小尺寸"><ViewModule fontSize="small" /></ToggleButton>
          <ToggleButton value="standard" aria-label="标准尺寸"><GridView fontSize="small" /></ToggleButton>
          <ToggleButton value="list" aria-label="列表"><ViewList fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {mediaTab === "vod" ? (
        <Box>
          {works.length === 0 ? (
            <Typography color="text.disabled">暂无该作者的本地点播作品</Typography>
          ) : (
            <>
              <Box sx={libraryLayoutSx(isList, viewMode, listSurface)}>
                {works.map((w, index) => (
                  <MediaItem
                    key={`vod:${w.id}`}
                    item={{ kind: "vod", key: `vod:${w.id}`, work: w }}
                    viewMode={viewMode}
                    index={index}
                    total={works.length}
                    onPlay={() => playVod(w)}
                    titleHref={`/works/${w.provider}/${w.workId}`}
                    playDisabled={w.status !== "downloaded"}
                  />
                ))}
              </Box>
              <InfiniteScrollSentinel active={worksHasMore} loading={worksLoadingMore} onVisible={loadMoreWorks} />
            </>
          )}
        </Box>
      ) : (
        <Box>
          {liveItems.length === 0 ? (
            <Typography color="text.disabled">暂无该作者的本地直播回放</Typography>
          ) : (
            <>
              <Box sx={libraryLayoutSx(isList, viewMode, listSurface)}>
                {liveItems.map((m, index) => {
                  const title = m.title || m.roomId;
                  return (
                    <MediaItem
                      key={`live:${m.id}`}
                      item={{ kind: "live", key: `live:${m.id}`, media: m }}
                      viewMode={viewMode}
                      index={index}
                      total={liveItems.length}
                      onPlay={() => playLive(m, title)}
                      showDelete
                      onDelete={() => { void deleteLiveMedia(m); }}
                    />
                  );
                })}
              </Box>
              <InfiniteScrollSentinel active={liveHasMore} loading={liveLoadingMore} onVisible={loadMoreLive} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
