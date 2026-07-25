import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Button, Alert, Chip,
  Table, TableHead, TableRow, TableCell, TableBody,
  ToggleButtonGroup, ToggleButton, CircularProgress,
} from "@mui/material";
import { Refresh } from "@mui/icons-material";
import type { LiveSubscriptionPublic, ProviderAccountPublic, SyncRunPublic } from "@erolib/shared";
import { api } from "../api";

type SyncTab = "subscribe" | "vod";

export function SyncPage() {
  const [tab, setTab] = useState<SyncTab>("subscribe");
  const [runs, setRuns] = useState<SyncRunPublic[]>([]);
  const [providers, setProviders] = useState<ProviderAccountPublic[]>([]);
  const [subs, setSubs] = useState<LiveSubscriptionPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toggleId, setToggleId] = useState<number | null>(null);

  async function loadRuns(): Promise<void> { setRuns(await api.syncRuns()); }
  async function loadProviders(): Promise<void> { setProviders(await api.providers()); }
  async function loadSubs(): Promise<void> { setSubs(await api.liveSubscriptions()); }
  async function loadVod(): Promise<void> { await Promise.all([loadRuns(), loadProviders()]); }

  useEffect(() => {
    void loadSubs().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void loadVod().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => { if (tab === "vod") { void loadRuns().catch(() => undefined); } }, 4000);
    return () => clearInterval(t);
  }, [tab]);

  async function onImportFollowees(): Promise<void> {
    setImporting(true); setError(null); setMsg(null);
    try {
      const r = await api.importFolloweeSubscriptions();
      await loadSubs();
      const parts = r.providers.map((p) => p.skipped ? `${p.provider}: ${p.skipped}` : p.error ? `${p.provider}: 失败` : `${p.provider}: 新增 ${p.imported}`);
      setMsg(`已导入。合计新增 ${r.totalImported}。`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setImporting(false); }
  }

  async function onDelete(id: number): Promise<void> {
    setBusy(true); setError(null);
    try { await api.deleteLiveSubscription(id); await loadSubs(); setMsg("已移除"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onToggle(id: number, key: "enabled" | "syncWorks", next: boolean): Promise<void> {
    setBusy(true); setError(null);
    try { await api.patchLiveSubscription(id, { [key]: next }); await loadSubs(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onToggleFavoriteSync(p: ProviderAccountPublic): Promise<void> {
    setToggleId(p.id); setError(null); setMsg(null);
    try {
      await api.patchProvider(p.id, { favoriteSyncEnabled: !p.favoriteSyncEnabled });
      await loadProviders();
      setMsg(p.favoriteSyncEnabled ? `已关闭 ${p.provider}` : `已开启 ${p.provider}`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setToggleId(null); }
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">Sync</Typography>
        <Typography variant="h4">同步</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>管理作者订阅，按渠道控制 VOD 同步。</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      <ToggleButtonGroup value={tab} exclusive onChange={(_, v) => v && setTab(v)} size="small" sx={{ mb: 2 }}>
        <ToggleButton value="subscribe">订阅作者</ToggleButton>
        <ToggleButton value="vod">VOD 同步</ToggleButton>
      </ToggleButtonGroup>

      {tab === "subscribe" ? (
        <Card>
          <CardContent>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography variant="h6">订阅作者</Typography>
              <Chip label={`${subs.length} 位`} size="small" variant="outlined" />
            </Box>
            <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>可从各渠道「关注」导入。自动录制仅 otobanana 可开。</Typography>
            <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
              <Button variant="contained" color="primary" disabled={importing || busy} onClick={() => { void onImportFollowees(); }}
                startIcon={importing ? <CircularProgress size={16} /> : null}>从关注导入</Button>
              <Button variant="outlined" component={Link} to="/sync/add">手动添加</Button>
              <Button variant="outlined" size="small" disabled={busy} onClick={() => { void loadSubs(); }} startIcon={<Refresh />}>刷新</Button>
            </Box>

            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>作者</TableCell><TableCell>渠道</TableCell><TableCell>同步作品</TableCell><TableCell>自动录制</TableCell><TableCell>最近在播</TableCell><TableCell>错误</TableCell><TableCell /></TableRow>
                </TableHead>
                <TableBody>
                  {subs.length === 0 ? (
                    <TableRow><TableCell colSpan={7} sx={{ color: "text.disabled" }}>暂无订阅。</TableCell></TableRow>
                  ) : subs.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }} variant="body2">{s.displayName || s.username || s.authorId}</Typography>
                        <Typography variant="caption" color="text.disabled">{s.username ? `@${s.username}` : s.authorId}</Typography>
                      </TableCell>
                      <TableCell><Chip label={s.provider} size="small" variant="outlined" /></TableCell>
                      <TableCell>
                        <Button size="small" variant="outlined" disabled={busy} onClick={() => { void onToggle(s.id, "syncWorks", !s.syncWorks); }}>{s.syncWorks ? "开" : "关"}</Button>
                      </TableCell>
                      <TableCell>
                        {s.provider === "otobanana" ? (
                          <Button size="small" variant="outlined" disabled={busy} onClick={() => { void onToggle(s.id, "enabled", !s.enabled); }}>{s.enabled ? "开" : "关"}</Button>
                        ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="caption" color="text.disabled">{s.lastOnairAt || "—"}</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.disabled">{s.lastError || "—"}</Typography></TableCell>
                      <TableCell><Button size="small" color="error" variant="outlined" disabled={busy} onClick={() => { void onDelete(s.id); }}>移除</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <>
          <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
            <Chip label={`同步记录 ${runs.length}`} size="small" variant="outlined" />
            <Button variant="contained" color="primary" disabled={syncing}
              onClick={() => { setMsg(null); setError(null); setSyncing(true); void api.sync().then(() => { setMsg("已触发全量同步"); return loadRuns(); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setSyncing(false)); }}
              startIcon={syncing ? <CircularProgress size={16} /> : null}>立即同步全部</Button>
            <Button variant="outlined" size="small" onClick={() => { void loadVod(); }} startIcon={<Refresh />}>刷新</Button>
          </Box>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>按渠道收藏同步</Typography>
              <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>关闭后仅跳过该渠道的收藏夹同步。</Typography>
              {providers.length === 0 ? <Typography color="text.disabled">尚未配置 Provider。</Typography> : (
                <Table size="small">
                  <TableHead><TableRow><TableCell>渠道</TableCell><TableCell>收藏同步</TableCell><TableCell /></TableRow></TableHead>
                  <TableBody>{providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><Typography sx={{ fontWeight: 600 }}>{p.provider}</Typography></TableCell>
                      <TableCell><Chip label={p.favoriteSyncEnabled ? "开启" : "关闭"} size="small" color={p.favoriteSyncEnabled ? "warning" : "default"} /></TableCell>
                      <TableCell><Button size="small" variant="outlined" disabled={toggleId === p.id} onClick={() => { void onToggleFavoriteSync(p); }}>{p.favoriteSyncEnabled ? "关闭" : "开启"}</Button></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
                <Typography variant="h6">同步历史</Typography>
                <Typography variant="caption" color="text.disabled">约 4 秒自动刷新</Typography>
              </Box>
              {runs.length === 0 ? <Typography color="text.disabled">还没有同步记录。</Typography> : (
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Provider</TableCell><TableCell>开始</TableCell><TableCell>结束</TableCell><TableCell>发现</TableCell><TableCell>入队</TableCell><TableCell>错误</TableCell></TableRow></TableHead>
                    <TableBody>{runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.id}</TableCell><TableCell>{r.provider ?? "—"}</TableCell>
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
        </>
      )}
    </Box>
  );
}
