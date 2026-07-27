import { useEffect, useState, useMemo } from "react";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip,
  Table, TableHead, TableRow, TableCell, TableBody,
  LinearProgress, ToggleButtonGroup, ToggleButton,
  Dialog, DialogTitle, DialogContent, IconButton,
} from "@mui/material";
import { Refresh, History, Close } from "@mui/icons-material";
import type {
  DownloadJobPublic, LiveJobState, LiveOnairPublic, LiveRecordJobPublic, LiveSubscriptionPublic, SyncRunPublic,
} from "@erolib/shared";
import { api } from "../api";
import { EmptyState } from "../components/EmptyState";

function jobBadgeColor(state: string | LiveJobState): "warning" | "success" | "error" | "default" {
  if (state === "recording" || state === "pending_media" || state === "running") return "warning";
  if (state === "completed" || state === "done") return "success";
  if (state === "failed" || state === "blocked") return "error";
  return "default";
}

function messageOf(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function settled<T>(r: PromiseSettledResult<T>, fallback: T): T { return r.status === "fulfilled" ? r.value : fallback; }

// Compact status chip: state label with color
function StateChip({ state }: { state: string }) {
  return <Chip label={state} size="small" color={jobBadgeColor(state)} sx={{ minWidth: 72 }} />;
}

// Common row label: fixed-width, single-line truncated
function RowLabel({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{primary}</Typography>
      {secondary && <Typography variant="caption" color="text.disabled" noWrap>{secondary}</Typography>}
    </Box>
  );
}

// Section heading with count badge
function SectionHead({
  label, count, children,
}: { label: string; count: number; children?: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <Typography variant="subtitle2" color="text.disabled">{label}</Typography>
      <Chip label={String(count)} size="small" variant="outlined" sx={{ height: 20, fontSize: "0.7rem" }} />
      {children}
    </Box>
  );
}

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
  const [historyOpen, setHistoryOpen] = useState(false);

  async function loadAll(): Promise<void> {
    const [j, lj, f, s, r] = await Promise.allSettled([
      api.jobs(), api.liveJobs(), api.liveFollowees(), api.liveSubscriptions(), api.syncRuns(),
    ]);
    setJobs(settled(j, []));
    setLiveJobs(settled(lj, []));
    setFollowees(settled(f, []));
    setSubs(settled(s, []));
    setRuns(settled(r, []));

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

  // Only show subscribed authors (syncWorks=true) in sync status
  const subscribedAuthors = useMemo(() => subs.filter((s) => s.syncWorks), [subs]);

  // Latest sync run per provider (runs are already sorted desc by id)
  const latestRuns = useMemo(() => {
    const seen = new Set<string>();
    const result: SyncRunPublic[] = [];
    for (const r of runs) {
      const key = r.provider ?? "__full__";
      if (!seen.has(key)) { seen.add(key); result.push(r); }
    }
    return result;
  }, [runs]);

  const sectionSx = {
    mb: 3,
    "&:last-child": { mb: 0 },
  };

  const index = PANELS.indexOf(panel);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.disabled" sx={{ letterSpacing: "0.08em" }}>Status</Typography>
          <Typography variant="h4">运行状态</Typography>
        </Box>
        <Button variant="outlined" size="small" disabled={busy} onClick={() => { void onPoll(); }} startIcon={<Refresh />}>
          立即检测直播
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg}</Alert>}

      {/* Tab bar */}
      <ToggleButtonGroup value={panel} exclusive onChange={(_, v) => v && setPanel(v)} size="small" sx={{ mb: 2 }}>
        <ToggleButton value="downloads">下载队列</ToggleButton>
        <ToggleButton value="live">直播录制</ToggleButton>
        <ToggleButton value="sync">同步状态</ToggleButton>
      </ToggleButtonGroup>

      {/* Sliding panels */}
      <Box sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            display: "flex",
            width: `${PANELS.length * 100}%`,
            transform: `translateX(-${index * (100 / PANELS.length)}%)`,
            transition: "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* ── Downloads ── */}
          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0, pr: 2 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>下载队列</Typography>

                {/* Running */}
                <Box sx={sectionSx}>
                  <SectionHead label="正在下载" count={runningDownloads.length} />
                  {runningDownloads.length === 0 ? (
                    <EmptyState icon={<Box component="span" sx={{ fontSize: 28, opacity: 0.3 }}>⬇</Box>} title="暂无下载任务" />
                  ) : (
                    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) 3fr 48px", gap: 1.5, alignItems: "center" }}>
                      {runningDownloads.map((j) => (
                        <Box key={j.id} sx={{ display: "contents" }}>
                          <RowLabel primary={j.title ?? j.workId} secondary={`[${j.provider}]`} />
                          <LinearProgress variant="determinate" value={Math.round(j.progress * 100)} sx={{ height: 6, borderRadius: 999 }} />
                          <Typography variant="caption" color="text.disabled" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(j.progress * 100)}%
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Queued */}
                <Box sx={sectionSx}>
                  <SectionHead label="队列中" count={queuedDownloads.length} />
                  {queuedDownloads.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">队列为空</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                      {queuedDownloads.map((j) => (
                        <RowLabel key={j.id} primary={`[${j.provider}] ${j.title ?? j.workId}`} />
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Failed */}
                <Box sx={sectionSx}>
                  <SectionHead label="失败" count={failedDownloads.length} />
                  {failedDownloads.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">暂无失败任务</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {failedDownloads.map((j) => (
                        <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Chip label="失败" size="small" color="error" />
                          <RowLabel primary={`[${j.provider}] ${j.title ?? j.workId}`} secondary={j.error ?? undefined} />
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* ── Live ── */}
          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0, pr: 2 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>直播录制</Typography>

                {/* Recording */}
                <Box sx={sectionSx}>
                  <SectionHead label="录制中" count={runningLive.length} />
                  {runningLive.length === 0 ? (
                    <EmptyState icon={<Box component="span" sx={{ fontSize: 28, opacity: 0.3 }}>🎙</Box>} title="暂无正在录制的任务" />
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {runningLive.map((j) => (
                        <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          <StateChip state={j.state} />
                          <RowLabel
                            primary={j.title || j.roomId}
                            secondary={j.authorDisplayName || j.authorUsername || j.authorId}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Queued */}
                <Box sx={sectionSx}>
                  <SectionHead label="队列中" count={queuedLive.length} />
                  {queuedLive.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">暂无排队任务</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {queuedLive.map((j) => (
                        <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          <StateChip state={j.state} />
                          <RowLabel
                            primary={j.title || j.roomId}
                            secondary={j.authorDisplayName || j.authorUsername || j.authorId}
                          />
                          <Box sx={{ ml: "auto" }}>
                            <Button size="small" color="error" variant="outlined" disabled={busy}
                              onClick={() => { void onDeleteLiveJob(j); }}>删除</Button>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* Failed */}
                <Box sx={sectionSx}>
                  <SectionHead label="失败" count={failedLive.length} />
                  {failedLive.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">暂无失败任务</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {failedLive.map((j) => (
                        <Box key={j.id} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          <Chip label="失败" size="small" color="error" />
                          <RowLabel
                            primary={j.title || j.roomId}
                            secondary={j.error ?? `${j.authorDisplayName || j.authorUsername || j.authorId}`}
                          />
                          <Box sx={{ ml: "auto" }}>
                            <Button size="small" color="error" variant="outlined" disabled={busy}
                              onClick={() => { void onDeleteLiveJob(j); }}>删除</Button>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>

                {/* On-air followees */}
                <Box>
                  <SectionHead label="关注在播" count={followees.length} />
                  {followees.length === 0 ? (
                    <Typography variant="body2" color="text.disabled">当前无关注在播</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                      {followees.map((f) => (
                        <Box key={f.roomId} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.displayName || f.username || f.authorId}</Typography>
                          <Typography variant="caption" color="text.disabled">{f.title || "—"} · {f.listenerCount ?? "—"} 听众</Typography>
                          {f.recordState && <StateChip state={f.recordState} />}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* ── Sync ── */}
          <Box sx={{ flex: `0 0 ${100 / PANELS.length}%`, minWidth: 0 }}>
            {/* Author sync status — only subscribed (syncWorks) */}
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                  <Typography variant="h6">作者同步状态</Typography>
                  <Chip label={`${subscribedAuthors.length} 位`} size="small" variant="outlined" />
                </Box>
                <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
                  仅显示开启了「同步作品」的订阅作者。
                </Typography>
                {subscribedAuthors.length === 0 ? (
                  <EmptyState icon={<Box component="span" sx={{ fontSize: 28, opacity: 0.3 }}>📭</Box>} title="暂无同步作者" description="前往「同步」页添加订阅并开启同步作品。" />
                ) : (
                  <Box sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>作者</TableCell>
                          <TableCell>渠道</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>最近在播</TableCell>
                          <TableCell>错误</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {subscribedAuthors.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: 140 }}>
                                {s.displayName || s.username || s.authorId}
                              </Typography>
                            </TableCell>
                            <TableCell><Chip label={s.provider} size="small" variant="outlined" /></TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.disabled" noWrap sx={{ maxWidth: 120, display: "inline-block" }}>
                                {s.lastOnairAt || "—"}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" color={s.lastError ? "error" : "text.disabled"} noWrap sx={{ maxWidth: 140, display: "inline-block" }}>
                                {s.lastError || "—"}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Favorite sync status — latest per provider */}
            <Card>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                  <Typography variant="h6">收藏夹同步状态</Typography>
                  <Button size="small" variant="outlined" startIcon={<History />}
                    onClick={() => setHistoryOpen(true)} disabled={runs.length === 0}>
                    同步历史
                  </Button>
                </Box>
                <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
                  各渠道最近一次同步结果。
                </Typography>
                {latestRuns.length === 0 ? (
                  <EmptyState icon={<Box component="span" sx={{ fontSize: 28, opacity: 0.3 }}>🔄</Box>} title="还没有同步记录" />
                ) : (
                  <Box sx={{ overflowX: "auto" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>渠道</TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>完成时间</TableCell>
                          <TableCell>发现</TableCell>
                          <TableCell>入队</TableCell>
                          <TableCell>状态</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {latestRuns.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <Chip label={r.provider ?? "全局"} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.disabled">{r.finishedAt ?? r.startedAt}</Typography>
                            </TableCell>
                            <TableCell>{r.discovered}</TableCell>
                            <TableCell>{r.enqueued}</TableCell>
                            <TableCell>
                              {r.error ? (
                                <Chip label="失败" size="small" color="error" />
                              ) : (
                                <Chip label="完成" size="small" color="success" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Sync history dialog */}
            <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
              <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                同步历史
                <IconButton onClick={() => setHistoryOpen(false)} size="small"><Close /></IconButton>
              </DialogTitle>
              <DialogContent dividers>
                {runs.length === 0 ? (
                  <Typography color="text.disabled" sx={{ py: 4, textAlign: "center" }}>还没有同步记录。</Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>渠道</TableCell>
                        <TableCell>开始</TableCell>
                        <TableCell>结束</TableCell>
                        <TableCell>发现</TableCell>
                        <TableCell>入队</TableCell>
                        <TableCell>错误</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {runs.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.provider ?? "—"}</TableCell>
                          <TableCell><Typography variant="caption">{r.startedAt}</Typography></TableCell>
                          <TableCell><Typography variant="caption">{r.finishedAt ?? "…"}</Typography></TableCell>
                          <TableCell>{r.discovered}</TableCell>
                          <TableCell>{r.enqueued}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color={r.error ? "error" : "text.disabled"} noWrap sx={{ maxWidth: 180, display: "inline-block" }}>
                              {r.error ?? "—"}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </DialogContent>
            </Dialog>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
