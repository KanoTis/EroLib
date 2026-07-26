import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip,
  Table, TableHead, TableRow, TableCell, TableBody,
  LinearProgress, ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { Refresh } from "@mui/icons-material";
import type {
  DownloadJobPublic, LiveJobState, LiveOnairPublic, LiveRecordJobPublic, LiveSubscriptionPublic, SyncRunPublic,
} from "@erolib/shared";
import { api } from "../api";

function jobBadgeColor(state: string | LiveJobState): "warning" | "success" | "error" | "default" {
  if (state === "recording" || state === "pending_media" || state === "running") return "warning";
  if (state === "completed" || state === "done") return "success";
  if (state === "failed" || state === "blocked") return "error";
  return "default";
}

function messageOf(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function settled<T>(r: PromiseSettledResult<T>, fallback: T): T { return r.status === "fulfilled" ? r.value : fallback; }

const PANELS = ["downloads", "live", "sync"] as const;
type Panel = typeof PANELS[number];

export function StatusPage() {
  const [panel, setPanel] = useState<Panel>("downloads");
  const [jobs, setJobs] = useState<DownloadJobPublic[]>([]);
  const [liveJobs, setLiveJobs] = useState<LiveRecordJobPublic[]>([]);
  const [followees, setFollowees] = useState<LiveOnairPublic[]>([]);
  const [subs, setSubs] = useState<LiveSubscriptionPublic[]>([]);
  const [runs, setRuns] = useState<SyncRunPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll(): Promise<void> {
    const [j, lj, f, s, r] = await Promise.allSettled([
      api.jobs(), api.liveJobs(), api.liveFollowees(), api.liveSubscriptions(), api.syncRuns(),
    ]);
    setJobs(settled(j, []));
    setLiveJobs(settled(lj, []));
    setFollowees(settled(f, []));
    setSubs(settled(s, []));
    setRuns(settled(r, []));

    // Missing provider accounts (e.g. Otobanana not configured) are an expected, non-error state.
    const failure = [j, lj, f, s, r].find(
      (x): x is PromiseRejectedResult => x.status === "rejected" && !messageOf(x.reason).includes("not configured"),
    );
    setError(failure ? messageOf(failure.reason) : null);
  }

  useEffect(() => {
    void loadAll();
    const t = setInterval(() => { void loadAll(); }, 4000);
    return () => clearInterval(t);
  }, []);

  async function onPoll(): Promise<void> {
    setBusy(true); setError(null);
    try { await api.livePoll(); await loadAll(); setMsg("已触发一轮检测"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onDeleteLiveJob(job: LiveRecordJobPublic): Promise<void> {
    if (!confirm(`删除录制任务「${job.title || job.roomId}」？`)) return;
    setBusy(true); setError(null);
    try { await api.deleteLiveJob(job.id); setLiveJobs((prev) => prev.filter((j) => j.id !== job.id)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const runningDownloads = jobs.filter((j) => j.state === "running");
  const queuedDownloads = jobs.filter((j) => j.state === "queued");
  const failedDownloads = jobs.filter((j) => j.state === "failed");

  const runningLive = liveJobs.filter((j) => j.state === "recording" || j.state === "pending_media");
  const queuedLive = liveJobs.filter((j) => j.state === "discovered" || j.state === "blocked");
  const failedLive = liveJobs.filter((j) => j.state === "failed");

  const index = PANELS.indexOf(panel);

  return (
    <Box>
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.disabled">Status</Typography>
          <Typography variant="h4">运行状态</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
            查看下载、直播录制与同步的运行情况。配置请前往「同步」页。
          </Typography>
        </Box>
        <Button variant="outlined" size="small" disabled={busy} onClick={() => { void onPoll(); }} startIcon={<Refresh />}>立即检测直播</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      <ToggleButtonGroup value={panel} exclusive onChange={(_, v) => v && setPanel(v)} size="small" sx={{ mb: 2 }}>
        <ToggleButton value="downloads">下载队列</ToggleButton>
        <ToggleButton value="live">直播录制</ToggleButton>
        <ToggleButton value="sync">同步状态</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            display: "flex",
            width: `${PANELS.length * 100}%`,
            transform: `translateX(-${index * (100 / PANELS.length)}%)`,
            transition: "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0, pr: 2 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>下载队列</Typography>

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>正在下载（{runningDownloads.length}）</Typography>
                {runningDownloads.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>暂无正在下载的任务。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                    {runningDownloads.map((j) => (
                      <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 200 }}>[{j.provider}] {j.title ?? j.workId}</Typography>
                        <LinearProgress variant="determinate" value={Math.round(j.progress * 100)} sx={{ flex: 1, height: 6, borderRadius: 999 }} />
                        <Typography variant="caption" color="text.disabled">{Math.round(j.progress * 100)}%</Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>队列中（{queuedDownloads.length}）</Typography>
                {queuedDownloads.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>队列为空。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 2 }}>
                    {queuedDownloads.map((j) => (
                      <Typography key={j.id} variant="body2">[{j.provider}] {j.title ?? j.workId}</Typography>
                    ))}
                  </Box>
                )}

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>失败（{failedDownloads.length}）</Typography>
                {failedDownloads.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">暂无失败任务。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {failedDownloads.map((j) => (
                      <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Chip label="失败" size="small" color="error" />
                        <Typography variant="body2">[{j.provider}] {j.title ?? j.workId}</Typography>
                        <Typography variant="caption" color="text.disabled">{j.error ?? "—"}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0, pr: 2 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>直播录制</Typography>

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>录制中（{runningLive.length}）</Typography>
                {runningLive.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>暂无正在录制的任务。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 2 }}>
                    {runningLive.map((j) => (
                      <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Chip label={j.state} size="small" color={jobBadgeColor(j.state)} />
                        <Typography variant="body2">{j.authorDisplayName || j.authorUsername || j.authorId} · {j.title || j.roomId}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>队列中（{queuedLive.length}）</Typography>
                {queuedLive.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>暂无排队任务。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 2 }}>
                    {queuedLive.map((j) => (
                      <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Chip label={j.state} size="small" color={jobBadgeColor(j.state)} />
                        <Typography variant="body2">{j.authorDisplayName || j.authorUsername || j.authorId} · {j.title || j.roomId}</Typography>
                        <Button size="small" color="error" variant="outlined" disabled={busy} onClick={() => { void onDeleteLiveJob(j); }}>删除</Button>
                      </Box>
                    ))}
                  </Box>
                )}

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>失败（{failedLive.length}）</Typography>
                {failedLive.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>暂无失败任务。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 2 }}>
                    {failedLive.map((j) => (
                      <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Chip label="失败" size="small" color="error" />
                        <Typography variant="body2">{j.authorDisplayName || j.authorUsername || j.authorId} · {j.title || j.roomId}</Typography>
                        <Typography variant="caption" color="text.disabled">{j.error || "—"}</Typography>
                        <Button size="small" color="error" variant="outlined" disabled={busy} onClick={() => { void onDeleteLiveJob(j); }}>删除</Button>
                      </Box>
                    ))}
                  </Box>
                )}

                <Typography variant="subtitle2" color="text.disabled" gutterBottom>关注在播（{followees.length}）</Typography>
                {followees.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">当前无关注在播。</Typography>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {followees.map((f) => (
                      <Box key={f.roomId} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.displayName || f.username || f.authorId}</Typography>
                        <Typography variant="caption" color="text.disabled">{f.title || "—"} · 听众 {f.listenerCount ?? "—"}</Typography>
                        {f.recordState && <Chip label={f.recordState} size="small" color={jobBadgeColor(f.recordState)} />}
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>

          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0 }}>
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>作者同步状态</Typography>
                {subs.length === 0 ? (
                  <Typography color="text.disabled">暂无订阅。</Typography>
                ) : (
                  <Box sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead><TableRow><TableCell>作者</TableCell><TableCell>渠道</TableCell><TableCell>最近在播</TableCell><TableCell>错误</TableCell></TableRow></TableHead>
                      <TableBody>
                        {subs.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.displayName || s.username || s.authorId}</TableCell>
                            <TableCell><Chip label={s.provider} size="small" variant="outlined" /></TableCell>
                            <TableCell><Typography variant="caption" color="text.disabled">{s.lastOnairAt || "—"}</Typography></TableCell>
                            <TableCell><Typography variant="caption" color="text.disabled">{s.lastError || "—"}</Typography></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>收藏夹同步历史</Typography>
                {runs.length === 0 ? (
                  <Typography color="text.disabled">还没有同步记录。</Typography>
                ) : (
                  <Box sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead><TableRow><TableCell>Provider</TableCell><TableCell>开始</TableCell><TableCell>结束</TableCell><TableCell>发现</TableCell><TableCell>入队</TableCell><TableCell>错误</TableCell></TableRow></TableHead>
                      <TableBody>{runs.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.provider ?? "—"}</TableCell>
                          <TableCell><Typography variant="caption">{r.startedAt}</Typography></TableCell>
                          <TableCell><Typography variant="caption">{r.finishedAt ?? "…"}</Typography></TableCell>
                          <TableCell>{r.discovered}</TableCell><TableCell>{r.enqueued}</TableCell>
                          <TableCell><Typography variant="caption" color="text.disabled">{r.error ?? "—"}</Typography></TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
