import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, Typography, Button, TextField, Alert, List, ListItem, ListItemText, CircularProgress,
  FormControl, InputLabel, Select, MenuItem,
} from "@mui/material";
import type { AuthorSearchHit, ProviderAccountPublic, ProviderId } from "@erolib/shared";
import { api } from "../api";

export function SubscribeAddPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderAccountPublic[]>([]);
  const [addProvider, setAddProvider] = useState<ProviderId>("otobanana");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AuthorSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const configuredProviders = useMemo(() => providers.map((p) => p.provider as ProviderId), [providers]);

  useEffect(() => { void api.providers().then(setProviders).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);

  useEffect(() => {
    if (configuredProviders.length === 0) return;
    if (!configuredProviders.includes(addProvider)) setAddProvider(configuredProviders[0]!);
  }, [configuredProviders, addProvider]);

  async function onSearch(): Promise<void> {
    const q = query.trim(); if (!q) return;
    setSearching(true); setError(null); setSearched(true);
    try { setHits(await api.searchAuthors(addProvider, q)); }
    catch (e: unknown) { setHits([]); setError(e instanceof Error ? e.message : String(e)); }
    finally { setSearching(false); }
  }

  async function onAddHit(hit: AuthorSearchHit): Promise<void> {
    if (addingId) return;
    setAddingId(hit.authorId); setError(null);
    try {
      await api.addLiveSubscription({ provider: hit.provider, authorId: hit.authorId, username: hit.username, displayName: hit.displayName, syncWorks: false, enabled: false });
      void navigate("/sync");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAddingId(null); }
  }

  function hitLabel(hit: AuthorSearchHit): string { return hit.displayName?.trim() || hit.username?.trim() || hit.authorId; }
  function hitSecondary(hit: AuthorSearchHit): string | null {
    const parts: string[] = [];
    if (hit.username && hit.username !== hit.displayName && hit.username !== hit.authorId) parts.push(`@${hit.username}`);
    if (hit.authorId && hit.authorId !== hit.displayName) { if (!parts.includes(`@${hit.authorId}`)) parts.push(hit.authorId); }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.disabled">Sync</Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>搜索并选择作者加入订阅名单。</Typography>
        </Box>
        <Button variant="outlined" component={Link} to="/sync">返回订阅列表</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>渠道</InputLabel>
              <Select value={addProvider} label="渠道" onChange={(e) => { setAddProvider(e.target.value as ProviderId); setHits([]); setSearched(false); }}>
                {(configuredProviders.length > 0 ? configuredProviders : ["otobanana", "koekoe", "erovoice"] as ProviderId[]).map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="关键词" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={addProvider === "otobanana" ? "username 或 UUID" : "作者名"} size="small" sx={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onSearch(); } }} />
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="contained" color="primary" disabled={searching || !query.trim()} onClick={() => { void onSearch(); }}>
              {searching && <CircularProgress size={16} sx={{ mr: 1 }} />}搜索</Button>
            <Button variant="outlined" component={Link} to="/sync">取消</Button>
          </Box>
        </CardContent>
      </Card>

      {searched && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>搜索结果</Typography>
            {searching ? <Typography color="text.disabled">搜索中…</Typography>
            : hits.length === 0 ? <Typography color="text.disabled">未找到匹配作者。</Typography>
            : (
              <List disablePadding>
                {hits.map((hit) => {
                  const secondary = hitSecondary(hit);
                  const busy = addingId === hit.authorId;
                  return (
                    <ListItem key={`${hit.provider}:${hit.authorId}`} divider disableGutters
                      secondaryAction={
                        <Button variant="outlined" size="small" disabled={Boolean(addingId)} onClick={() => { void onAddHit(hit); }}>
                          {busy ? <CircularProgress size={14} /> : "添加"}
                        </Button>
                      }>
                      <ListItemText primary={hitLabel(hit)} secondary={secondary} slotProps={{ primary: { sx: { fontWeight: 600 } } }} />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
