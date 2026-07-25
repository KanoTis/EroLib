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
} from "@mui/material";
import { Sync } from "@mui/icons-material";
import type { SettingsPublic } from "@erolib/shared";
import { api } from "../api";
import { useThemeMode } from "../ThemeContext";

export function SettingsPage() {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [hours, setHours] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [historyMeta, setHistoryMeta] = useState<{ syncedAt: string | null; lastError: string | null; syncing: boolean } | null>(null);

  useEffect(() => {
    void api.settings().then((s) => { setSettings(s); setHours(s.syncIntervalHours); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void api.liveFolloweeHistory().then((h) =>
      setHistoryMeta({ syncedAt: h.syncedAt, lastError: h.lastError, syncing: h.syncing })
    ).catch(() => undefined);
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
        <Typography variant="h4">设置</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>同步节奏、关注历史后台同步与路径信息。</Typography>
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

      {settings && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>路径（只读）</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
              {[
                { label: "DATA_DIR", value: settings.dataDir },
                { label: "MEDIA_DIR", value: settings.mediaDir },
                { label: "CACHE_DIR", value: settings.cacheDir },
              ].map((p) => (
                <Box key={p.label} sx={{ p: 1, bgcolor: isLight ? "#F4F4F0" : "rgba(15,15,35,0.45)", borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
                  <Typography variant="caption" color="secondary.main" component="code">{p.label}</Typography>
                  <Typography variant="body2">{p.value}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Chip label={`鉴权：${settings.authEnabled ? "已启用" : "未启用"}`} size="small" variant="outlined" />
              <Chip label={`下载并发：${settings.maxDownloadConcurrency}`} size="small" variant="outlined" />
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
