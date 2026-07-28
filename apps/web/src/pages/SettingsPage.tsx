import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Alert,
  Chip,
  CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import { Cached, Sync } from "@mui/icons-material";
import type { AuthMode, ProviderAccountPublic, ProviderId, SettingsPublic } from "@erolib/shared";
import { api } from "../api";

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [hours, setHours] = useState(4);
  const [recentDays, setRecentDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingRecentDays, setSavingRecentDays] = useState(false);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [historyMeta, setHistoryMeta] = useState<{ syncedAt: string | null; lastError: string | null; syncing: boolean } | null>(null);
  const [metaRefreshing, setMetaRefreshing] = useState(false);
  const [metaProgress, setMetaProgress] = useState("");

  const [providers, setProviders] = useState<ProviderAccountPublic[]>([]);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerBusyId, setProviderBusyId] = useState<number | null>(null);
  const [provider, setProvider] = useState<ProviderId>("otobanana");
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cookieHeader, setCookieHeader] = useState("");

  async function loadProviders(): Promise<void> { setProviders(await api.providers()); }

  useEffect(() => {
    void api.settings().then((s) => { setSettings(s); setHours(s.syncIntervalHours); setRecentDays(s.recentDays); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void api.liveFolloweeHistory().then((h) =>
      setHistoryMeta({ syncedAt: h.syncedAt, lastError: h.lastError, syncing: h.syncing })
    ).catch(() => undefined);
    void loadProviders().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function onSyncHistory(): Promise<void> {
    setHistorySyncing(true); setError(null); setMsg(null);
    try {
      await api.syncLiveFolloweeHistory();
      setMsg("已请求后台同步关注作者直播历史");
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const data = await api.liveFolloweeHistory();
        setHistoryMeta({ syncedAt: data.syncedAt, lastError: data.lastError, syncing: data.syncing });
        if (!data.syncing) break;
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setHistorySyncing(false); }
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">System</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>同步节奏、关注历史后台同步与渠道账号。</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      {!settings && !error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.disabled" }}>
          <CircularProgress size={18} /><Typography variant="body2">加载设置…</Typography>
        </Box>
      )}

      {settings && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>同步</Typography>
            <TextField
              label="同步间隔（小时）" type="number" value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 168 } }}
              helperText="默认 4 小时。" sx={{ mb: 2 }}
            />
            <Button variant="contained" color="primary" disabled={saving}
              onClick={() => {
                setSaving(true); setError(null); setMsg(null);
                void api.updateSettings({ syncIntervalHours: hours })
                  .then(() => setMsg("已保存"))
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}>
              {saving && <CircularProgress size={16} sx={{ mr: 1 }} />}保存
            </Button>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>最近入库</Typography>
            <TextField
              label="展示时间范围（天）" type="number" value={recentDays}
              onChange={(e) => setRecentDays(Number(e.target.value))}
              slotProps={{ htmlInput: { min: 0, max: 365 } }}
              helperText="媒体库页顶部“最近入库”只展示该天数内发布的内容；0 表示不限制。" sx={{ mb: 2 }}
            />
            <Button variant="contained" color="primary" disabled={savingRecentDays}
              onClick={() => {
                setSavingRecentDays(true); setError(null); setMsg(null);
                void api.updateSettings({ recentDays })
                  .then(() => setMsg("已保存"))
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSavingRecentDays(false));
              }}>
              {savingRecentDays && <CircularProgress size={16} sx={{ mr: 1 }} />}保存
            </Button>
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>直播关注历史</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>
            从 Otobanana 后台拉取关注作者与近期场次到本地缓存。
          </Typography>
          {historyMeta && (
            <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>
              上次同步：{historyMeta.syncedAt || "尚未同步"}
              {historyMeta.syncing || historySyncing ? " · 同步进行中" : ""}
              {historyMeta.lastError ? ` · 上次错误：${historyMeta.lastError}` : ""}
            </Typography>
          )}
          <Button variant="outlined"
            startIcon={historySyncing || historyMeta?.syncing ? <CircularProgress size={16} /> : <Sync />}
            disabled={historySyncing || historyMeta?.syncing}
            onClick={() => { void onSyncHistory(); }}>
            同步关注作者直播历史
          </Button>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>添加渠道账号</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Provider</InputLabel>
                <Select value={provider} label="Provider" onChange={(e) => setProvider(e.target.value as ProviderId)}>
                  <MenuItem value="otobanana">Otobanana</MenuItem>
                  <MenuItem value="koekoe">Koe-koe</MenuItem>
                  <MenuItem value="erovoice">Erovoice</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>认证方式</InputLabel>
                <Select value={authMode} label="认证方式" onChange={(e) => setAuthMode(e.target.value as AuthMode)}>
                  <MenuItem value="password">账密</MenuItem>
                  <MenuItem value="cookie">Cookie / Token</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {authMode === "password" ? (
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                <TextField label="用户名 / Email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" size="small" sx={{ flex: 1 }} />
                <TextField label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" size="small" sx={{ flex: 1 }} />
              </Box>
            ) : (
              <TextField label="Cookie / JWT" multiline rows={3} value={cookieHeader} onChange={(e) => setCookieHeader(e.target.value)}
                placeholder="Otobanana: 粘贴 JWT" helperText="Cookie 过期后需重新导入" size="small" />
            )}

            <Button variant="contained" color="primary" disabled={providerSaving}
              onClick={() => {
                setError(null); setMsg(null); setProviderSaving(true);
                void api.createProvider({ provider, authMode, username: username || undefined, password: password || undefined, cookieHeader: cookieHeader || undefined })
                  .then(async () => { setMsg("已保存并验证通过"); setPassword(""); setCookieHeader(""); await loadProviders(); })
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setProviderSaving(false));
              }}>
              {providerSaving ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}{providerSaving ? "验证中…" : "保存"}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography variant="h6">已配置账号</Typography>
            <Chip label={`${providers.length} 个`} size="small" variant="outlined" />
          </Box>
          {providers.length === 0 ? (
            <Typography color="text.disabled">尚未配置 Provider。</Typography>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Provider</TableCell><TableCell>模式</TableCell><TableCell>用户</TableCell><TableCell>状态</TableCell><TableCell>操作</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><Typography sx={{ fontWeight: 600 }}>{p.provider}</Typography></TableCell>
                      <TableCell><Chip label={p.authMode} size="small" variant="outlined" /></TableCell>
                      <TableCell>{p.username ?? "—"}</TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          <Chip label={p.status} size="small" variant="outlined" />
                          {p.statusMessage && <Typography variant="caption" color="text.disabled">{p.statusMessage}</Typography>}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <Button size="small" variant="outlined" disabled={providerBusyId === p.id} onClick={() => {
                            setProviderBusyId(p.id); setError(null); setMsg(null);
                            void api.testProvider(p.id).then(async (r) => {
                              setMsg(r.ok ? `${p.provider} 测试成功` : "测试失败");
                              if (!r.ok && r.error) setError(r.error);
                              await loadProviders();
                            }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setProviderBusyId(null));
                          }}>测试</Button>
                          <Button size="small" color="error" variant="outlined" disabled={providerBusyId === p.id} onClick={() => {
                            if (!confirm("确认删除？")) return;
                            setProviderBusyId(p.id);
                            void api.deleteProvider(p.id).then(loadProviders)
                              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                              .finally(() => setProviderBusyId(null));
                          }}>删除</Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      {settings && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>系统</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Chip label={`鉴权：${settings.authEnabled ? "已启用" : "未启用"}`} size="small" variant="outlined" />
              <Chip label={`下载并发：${settings.maxDownloadConcurrency}`} size="small" variant="outlined" />
            </Box>
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>刷新全部元数据</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>
            重新抓取所有作品的标题、封面、时长等元数据并更新 ID3 标签。
          </Typography>
          {metaProgress && (
            <Typography variant="body2" color="text.disabled" sx={{ mb: 1 }}>{metaProgress}</Typography>
          )}
          <Button variant="outlined"
            startIcon={metaRefreshing ? <CircularProgress size={16} /> : <Cached />}
            disabled={metaRefreshing}
            onClick={() => {
              setMetaRefreshing(true); setMetaProgress(""); setError(null);
              void api.refreshAllMetadata((line) => {
                if (line.done) {
                  setMetaRefreshing(false);
                  setMetaProgress(`完成：刷新 ${line.refreshed}，失败 ${line.failed}，跳过 ${line.skipped}，共 ${line.total}`);
                } else if (line.provider && line.workId) {
                  setMetaProgress(`${line.provider}/${line.workId}: ${line.ok ? "已刷新" : line.error}`);
                }
              }).catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
                setMetaRefreshing(false);
              });
            }}>
            刷新全部元数据
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
