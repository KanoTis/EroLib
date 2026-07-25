import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Typography, Button, TextField, Alert, Chip,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import type { AuthMode, ProviderAccountPublic, ProviderId } from "@erolib/shared";
import { api } from "../api";

export function ProvidersPage() {
  const [list, setList] = useState<ProviderAccountPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [provider, setProvider] = useState<ProviderId>("otobanana");
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cookieHeader, setCookieHeader] = useState("");

  async function load(): Promise<void> { setList(await api.providers()); }

  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">Accounts</Typography>
        <Typography variant="h4">Providers</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>配置各站账号。凭证加密存储。</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>添加绑定</Typography>
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

            <Button variant="contained" color="primary" disabled={saving}
              onClick={() => {
                setError(null); setMsg(null); setSaving(true);
                void api.createProvider({ provider, authMode, username: username || undefined, password: password || undefined, cookieHeader: cookieHeader || undefined })
                  .then(async () => { setMsg("已保存并验证通过"); setPassword(""); setCookieHeader(""); await load(); })
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setSaving(false));
              }}>
              {saving ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}{saving ? "验证中…" : "保存"}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography variant="h6">已配置</Typography>
            <Chip label={`${list.length} 个`} size="small" variant="outlined" />
          </Box>
          {list.length === 0 ? (
            <Typography color="text.disabled">尚未配置 Provider。</Typography>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Provider</TableCell><TableCell>模式</TableCell><TableCell>用户</TableCell><TableCell>状态</TableCell><TableCell>操作</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {list.map((p) => (
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
                          <Button size="small" variant="outlined" disabled={busyId === p.id} onClick={() => {
                            setBusyId(p.id); setError(null); setMsg(null);
                            void api.testProvider(p.id).then(async (r) => {
                              setMsg(r.ok ? `${p.provider} 测试成功` : "测试失败");
                              if (!r.ok && r.error) setError(r.error);
                              await load();
                            }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusyId(null));
                          }}>测试</Button>
                          <Button size="small" color="error" variant="outlined" disabled={busyId === p.id} onClick={() => {
                            if (!confirm("确认删除？")) return;
                            setBusyId(p.id);
                            void api.deleteProvider(p.id).then(load)
                              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                              .finally(() => setBusyId(null));
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
    </Box>
  );
}
