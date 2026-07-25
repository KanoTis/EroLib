import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  LinearProgress,
  CircularProgress,
} from "@mui/material";
import { Refresh } from "@mui/icons-material";
import type { DownloadJobPublic } from "@erolib/shared";
import { api } from "../api";

const STATE_COLOR: Record<string, "warning" | "success" | "error" | "default"> = {
  queued: "warning", running: "warning", done: "success", failed: "error",
};

export function JobsPage() {
  const [jobs, setJobs] = useState<DownloadJobPublic[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> { setJobs(await api.jobs()); }

  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => { void load().catch(() => undefined); }, 4000);
    return () => clearInterval(t);
  }, []);

  const activeJobs = jobs.filter((j) => j.state === "queued" || j.state === "running").length;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.disabled">Downloads</Typography>
        <Typography variant="h4">下载任务</Typography>
        <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
          查看下载队列进度与失败信息。同步请前往「同步」页。
        </Typography>
      </Box>

      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Chip label={`队列 ${jobs.length}`} variant="outlined" size="small" />
        <Chip label={`进行中 ${activeJobs}`} color="warning" size="small" />
        <Button variant="outlined" size="small" startIcon={<Refresh />} onClick={() => { void load(); }}>刷新</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography variant="h6">下载队列</Typography>
            <Typography variant="caption" color="text.disabled">约 4 秒自动刷新</Typography>
          </Box>

          {jobs.length === 0 ? (
            <Typography color="text.disabled">队列为空。</Typography>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell><TableCell>作品</TableCell><TableCell>状态</TableCell>
                    <TableCell>进度</TableCell><TableCell>尝试</TableCell><TableCell>错误</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>{j.id}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }} variant="body2">[{j.provider}] {j.title ?? j.workId}</Typography>
                      </TableCell>
                      <TableCell><Chip label={j.state} size="small" color={STATE_COLOR[j.state] ?? "default"} /></TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 120 }}>
                          <LinearProgress variant="determinate" value={Math.round(j.progress * 100)} sx={{ flex: 1, height: 6, borderRadius: 999 }} />
                          <Typography variant="caption" color="text.disabled">{Math.round(j.progress * 100)}%</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{j.attempts}</TableCell>
                      <TableCell><Typography variant="caption" color="text.disabled">{j.error ?? "—"}</Typography></TableCell>
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
