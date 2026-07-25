import { useState } from "react";
import { Box, Card, Typography, Button, TextField, Alert, CircularProgress } from "@mui/material";
import { Mic } from "@mui/icons-material";
import { api } from "../api";

export function LoginPage({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", px: 2 }}>
      <Card component="form" onSubmit={(e) => {
        e.preventDefault(); setError(null); setLoading(true);
        void api.login(username, password).then(() => onSuccess())
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setLoading(false));
      }} sx={{ maxWidth: 400, width: "100%", p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 1.5, display: "grid", placeItems: "center", bgcolor: "primary.main", color: "#fff" }}>
            <Mic sx={{ width: 20, height: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: "1.1rem" }}>Erolib</Typography>
            <Typography color="text.disabled" sx={{ fontSize: "0.75rem" }}>自托管音声备份</Typography>
          </Box>
        </Box>

        <Typography variant="h5" gutterBottom>登录</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
          使用 Docker 环境变量中的管理员账号进入本地库。
        </Typography>

        <TextField label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required fullWidth sx={{ mb: 2 }} />
        <TextField label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required fullWidth sx={{ mb: 2 }} />

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Button type="submit" variant="contained" color="primary" fullWidth disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}>登录</Button>
      </Card>
    </Box>
  );
}
