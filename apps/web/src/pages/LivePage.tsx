import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress,
} from "@mui/material";
import { Refresh, PlayArrow } from "@mui/icons-material";
import type { LiveFolloweeAuthorPublic, LiveFolloweeHistoryPublic, LiveJobState, LiveOnairPublic, LiveRecordJobPublic } from "@erolib/shared";
import { api } from "../api";
import { usePlayer } from "../player/PlayerContext";

function jobBadgeColor(state: string | LiveJobState): "warning" | "success" | "error" | "default" {
  if (state === "recording" || state === "pending_media") return "warning";
  if (state === "completed") return "success";
  if (state === "failed" || state === "blocked") return "error";
  return "default";
}

function formatRange(openAt: string | null, closeAt: string | null): string {
  const open = openAt ? openAt.replace("T", " ").slice(0, 16) : "—";
  const close = closeAt ? closeAt.replace("T", " ").slice(0, 16) : "—";
  return `${open} → ${close}`;
}

export function LivePage() {
  const { play } = usePlayer();
  const [followees, setFollowees] = useState<LiveOnairPublic[]>([]);
  const [history, setHistory] = useState<LiveFolloweeAuthorPublic[]>([]);
  const [historyMeta, setHistoryMeta] = useState<Pick<LiveFolloweeHistoryPublic, "syncedAt" | "lastError" | "syncing">>({ syncedAt: null, lastError: null, syncing: false });
  const [jobs, setJobs] = useState<LiveRecordJobPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [followeeError, setFolloweeError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadJobs(): Promise<void> { setJobs(await api.liveJobs()); }
  async function loadFollowees(): Promise<void> {
    try { setFollowees(await api.liveFollowees()); setFolloweeError(null); }
    catch (e: unknown) { setFollowees([]); setFolloweeError(e instanceof Error ? e.message : String(e)); }
  }
  async function loadHistory(): Promise<void> {
    try {
      const data = await api.liveFolloweeHistory();
      setHistory(data.authors);
      setHistoryMeta({ syncedAt: data.syncedAt, lastError: data.lastError, syncing: data.syncing });
      setHistoryError(null);
    } catch (e: unknown) { setHistory([]); setHistoryError(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    void Promise.all([loadJobs(), loadFollowees(), loadHistory()]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => { void loadJobs().catch(() => undefined); }, 4000);
    return () => clearInterval(t);
  }, []);

  async function onPoll(): Promise<void> {
    setBusy(true); setError(null);
    try { await api.livePoll(); await loadJobs(); await loadHistory(); setMsg("已触发一轮检测"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onDeleteJob(job: LiveRecordJobPublic): Promise<void> {
    if (!confirm(`删除录制任务「${job.title || job.roomId}」？`)) return;
    setBusy(true); setError(null); setMsg(null);
    try { await api.deleteLiveJob(job.id); setJobs((prev) => prev.filter((j) => j.id !== job.id)); setMsg("已删除"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const openJobs = jobs.filter((j) => ["pending_media", "blocked", "recording", "discovered"].includes(j.state)).length;

  return (
    <Box>
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.disabled">Otobanana Live</Typography>
          <Typography variant="h4">直播自动录制</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>查看关注在播与近期历史，管理录制任务。</Typography>
        </Box>
        <Button variant="outlined" disabled={busy} onClick={() => { void onPoll(); }} startIcon={<Refresh />}>立即检测</Button>
      </Box>

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Chip label={`进行中任务 ${openJobs}`} color="warning" size="small" />
        <Chip label={`任务总计 ${jobs.length}`} size="small" variant="outlined" />
        <Chip label={`关注作者 ${history.length}`} size="small" variant="outlined" />
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography variant="h6">关注的人在播</Typography>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => { void loadFollowees(); }} startIcon={<Refresh />}>刷新</Button>
          </Box>
          {followeeError && <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>无法加载：{followeeError}</Typography>}
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>主播</TableCell><TableCell>标题</TableCell><TableCell>听众</TableCell><TableCell>录制</TableCell></TableRow></TableHead>
              <TableBody>
                {followees.length === 0 ? (
                  <TableRow><TableCell colSpan={4} sx={{ color: "text.disabled" }}>当前无关注在播</TableCell></TableRow>
                ) : followees.map((f) => (
                  <TableRow key={f.roomId}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }} variant="body2">{f.displayName || f.username || f.authorId}</Typography>
                      <Typography variant="caption" color="text.disabled">{f.username ? `@${f.username}` : f.authorId}</Typography>
                    </TableCell>
                    <TableCell>{f.title || "—"}</TableCell>
                    <TableCell>{f.listenerCount ?? "—"}</TableCell>
                    <TableCell>{f.recordState ? <Chip label={f.recordState} size="small" color={jobBadgeColor(f.recordState)} /> : <Typography variant="caption" color="text.disabled">未录制</Typography>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>关注作者近期直播</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>
            上次同步：{historyMeta.syncedAt || "尚未同步"}{historyMeta.syncing ? " · 同步中" : ""}{historyMeta.lastError ? ` · 错误：${historyMeta.lastError}` : ""}
          </Typography>
          {historyError && <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>无法读取：{historyError}</Typography>}
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>作者</TableCell><TableCell>状态</TableCell><TableCell>近期场次 / 录制</TableCell></TableRow></TableHead>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow><TableCell colSpan={3} sx={{ color: "text.disabled" }}>暂无关注作者数据</TableCell></TableRow>
                ) : history.map((a) => (
                  <TableRow key={a.authorId}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }} variant="body2">{a.displayName || a.username || a.authorId}</Typography>
                      <Typography variant="caption" color="text.disabled">{a.username ? `@${a.username}` : a.authorId}</Typography>
                    </TableCell>
                    <TableCell>{a.liveNow ? <Chip label="直播中" color="warning" size="small" /> : <Chip label="离线" size="small" variant="outlined" />}</TableCell>
                    <TableCell>
                      {a.sessions.length === 0 ? <Typography variant="caption" color="text.disabled">暂无近期场次</Typography> : (
                        <Box component="ul" sx={{ m: 0, pl: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
                          {a.sessions.map((s) => (
                            <Box component="li" key={s.roomId}>
                              <Typography variant="body2">
                                {s.isOpen && <Chip label="LIVE" color="warning" size="small" sx={{ mr: 0.5 }} />}
                                {s.title || "无标题"}
                                {s.isAdult && <Chip label="R18" size="small" variant="outlined" sx={{ ml: 0.5 }} />}
                              </Typography>
                              <Typography variant="caption" color="text.disabled">
                                {formatRange(s.roomOpenAt, s.roomCloseAt)} · 听众 {s.listenerCount ?? "—"} ·{" "}
                                {s.recordState ? <Chip label={s.recordState} size="small" color={jobBadgeColor(s.recordState)} /> : "未录制"}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>录制任务</Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>状态</TableCell><TableCell>作者</TableCell><TableCell>标题 / Room</TableCell><TableCell>时间</TableCell><TableCell>说明</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {jobs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} sx={{ color: "text.disabled" }}>暂无任务</TableCell></TableRow>
                ) : jobs.map((j) => {
                  const canPlay = j.state === "completed" && Boolean(j.mediaRelPath);
                  return (
                    <TableRow key={j.id}>
                      <TableCell><Chip label={j.state} size="small" color={jobBadgeColor(j.state)} /></TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }} variant="body2">{j.authorDisplayName || j.authorUsername || j.authorId}</Typography>
                        <Typography variant="caption" color="text.disabled">{j.authorId}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{j.title || "—"}</Typography>
                        <Typography variant="caption" color="text.disabled" title={j.roomId}>{j.roomId}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.disabled">开始 {j.startedAt || j.createdAt}</Typography>
                      </TableCell>
                      <TableCell><Typography variant="caption" color="text.disabled">{j.error || "—"}</Typography></TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                          {canPlay && <>
                            <Button size="small" variant="contained" color="primary"
                              onClick={() => play({ id: `live:${j.provider}:${j.roomId}`, kind: "live", provider: j.provider, mediaId: j.roomId, title: j.title || j.roomId, subtitle: j.authorDisplayName || j.authorUsername || j.authorId || undefined, src: api.liveAudioUrl(j.provider, j.roomId) })}>
                              <PlayArrow fontSize="small" />播放
                            </Button>
                            <Button size="small" variant="outlined" component={Link} to="/?type=live">媒体库</Button>
                          </>}
                          <Button size="small" color="error" variant="outlined" disabled={busy} onClick={() => { void onDeleteJob(j); }}>删除</Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
