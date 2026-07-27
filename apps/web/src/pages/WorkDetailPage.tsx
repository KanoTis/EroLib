import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip, CircularProgress,
} from "@mui/material";
import { ArrowBack, PlayArrow, Refresh } from "@mui/icons-material";
import type { WorkPublic } from "@erolib/shared";
import { api } from "../api";
import { CoverImage } from "../components/CoverImage";
import { AuthorLink } from "../components/AuthorLink";
import { useGoBack } from "../navigation";
import { useThemeMode } from "../ThemeContext";
import { usePlayer } from "../player/PlayerContext";

const STATUS_LABEL: Record<string, string> = {
  downloaded: "已下载", queued: "队列中", downloading: "下载中", failed: "失败", discovered: "已发现",
};

export function WorkDetailPage() {
  const { provider = "", workId = "" } = useParams();
  const { mode } = useThemeMode();
  const goBack = useGoBack();
  const isLight = mode === "light";
  const { play, track, status } = usePlayer();
  const [work, setWork] = useState<WorkPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(): Promise<void> { try { setError(null); setWork(await api.work(provider, workId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  useEffect(() => { void load(); }, [provider, workId]);

  if (error && !work) {
    return (
      <Box>
        <Button onClick={goBack} startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回</Button>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!work) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.disabled" }}>
        <CircularProgress size={18} /><Typography variant="body2">加载作品详情…</Typography>
      </Box>
    );
  }

  const busy = work.status === "queued" || work.status === "downloading";
  const isCurrentTrack = track?.id === `vod:${work.provider}:${work.workId}`;
  const statusColor = work.status === "downloaded" ? "success" as const : work.status === "failed" ? "error" as const : work.status === "downloading" || work.status === "queued" ? "warning" as const : "default" as const;

  return (
    <Box>
      <Button onClick={goBack} startIcon={<ArrowBack />} sx={{ mb: 2 }}>返回</Button>

      <Card>
        <CardContent>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, gap: 3, alignItems: "start" }}>
            <CoverImage provider={work.provider} workId={work.workId} title={work.title} authorName={work.authorName} coverPath={work.coverPath} size="detail" durationSeconds={work.durationSeconds} />
            <Box>
              <Typography variant="overline" color="text.disabled">{work.provider}</Typography>
              <Typography variant="h4" sx={{ mb: 1 }}>{work.title}</Typography>

              <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
                <Chip label={STATUS_LABEL[work.status] ?? work.status} size="small" color={statusColor} />
                <Chip label={`远端收藏：${work.remoteInFavorites ? "是" : "否"}`} size="small" variant="outlined" />
              </Box>

              {/* Meta */}
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1.5, mb: 2 }}>
                {[
                  { label: "作者", value: <AuthorLink provider={work.provider} authorId={work.authorId}>{work.authorName ?? work.authorId ?? "—"}</AuthorLink> },
                  { label: "时长", value: work.durationSeconds != null ? `${Math.floor(work.durationSeconds / 60)}:${String(work.durationSeconds % 60).padStart(2, "0")}` : "—" },
                  { label: "发布日期", value: work.publishedAt ? (work.publishedAt.startsWith("20") ? work.publishedAt.slice(0, 10) : work.publishedAt) : "—" },
                  { label: "Provider", value: work.provider },
                  ...(work.sourceUrl ? [{ label: "原始链接", value: <a href={work.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>打开源站</a> }] : []),
                ].map((m) => (
                  <Box key={m.label} sx={{ bgcolor: isLight ? "#F4F4F0" : "rgba(15,15,35,0.45)", border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                    <Typography variant="caption" color="text.disabled" sx={{ textTransform: "uppercase" }}>{m.label}</Typography>
                    <Typography sx={{ fontWeight: 500 }} variant="body2">{m.value}</Typography>
                  </Box>
                ))}
              </Box>

              {work.description && (
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", mb: 2, lineHeight: 1.65 }}>{work.description}</Typography>
              )}

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                {work.error && <Alert severity="error">{work.error}</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
                {msg && <Alert severity="success">{msg}</Alert>}
              </Box>

              {work.status === "downloaded" ? (
                <Box sx={{ bgcolor: isLight ? "#F4F4F0" : "rgba(15,15,35,0.5)", border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2, mb: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600 }}>本地播放</Typography>
                    {isCurrentTrack && <Chip label={status === "playing" || status === "loading" ? "正在播放" : status === "paused" ? "已暂停" : status === "error" ? "播放出错" : "当前曲目"} size="small" color="warning" />}
                    <Button variant="contained" color="primary" startIcon={<PlayArrow />}
                      onClick={() => play({ id: `vod:${work.provider}:${work.workId}`, kind: "vod", provider: work.provider, mediaId: work.workId, title: work.title, subtitle: work.authorName ?? work.authorId ?? undefined, src: api.audioUrl(work.provider, work.workId), artworkUrl: work.coverPath ? api.coverUrl(work.provider, work.workId) : null })}>
                      播放
                    </Button>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>仅下载完成后可播放。当前状态：{STATUS_LABEL[work.status] ?? work.status}</Typography>
              )}

              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button variant="outlined" disabled={refreshing || busy} startIcon={refreshing ? <CircularProgress size={16} /> : <Refresh />}
                  onClick={() => { setRefreshing(true); setMsg(null); setError(null); void api.refreshMetadata(work.provider, work.workId).then((r) => { setMsg(r.warning ? `元数据已刷新（${r.warning}）` : "元数据已刷新"); return load(); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setRefreshing(false)); }}>
                  刷新元数据
                </Button>
                <Button variant="outlined" disabled={retrying} startIcon={retrying ? <CircularProgress size={16} /> : <Refresh />}
                  onClick={() => { setRetrying(true); setMsg(null); setError(null); void api.retryWork(work.provider, work.workId).then(() => { setMsg("已重新入队下载"); return load(); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setRetrying(false)); }}>
                  重试下载
                </Button>
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
