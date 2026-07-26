import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { PlayerProvider } from "./player/PlayerContext";
import { LoginPage } from "./pages/LoginPage";
import { LibraryPage } from "./pages/LibraryPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";
import { AuthorPage } from "./pages/AuthorPage";
import { SyncPage } from "./pages/SyncPage";
import { SubscribeAddPage } from "./pages/SubscribeAddPage";
import { StatusPage } from "./pages/StatusPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refreshAuth(): Promise<void> {
    const s = await api.authStatus();
    setAuthEnabled(s.authEnabled);
    setAuthenticated(s.authenticated);
  }

  useEffect(() => {
    void refreshAuth()
      .catch(() => { setAuthEnabled(false); setAuthenticated(true); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.secondary" }}>
          <CircularProgress size={18} />
          加载中…
        </Box>
      </div>
    );
  }

  if (authEnabled && !authenticated) {
    return (
      <LoginPage
        onSuccess={async () => {
          await refreshAuth();
        }}
      />
    );
  }

  return (
    <PlayerProvider>
      <AuthenticatedShell
        authEnabled={authEnabled}
        onLogout={() => {
          void api.logout().then(() => refreshAuth());
        }}
      />
    </PlayerProvider>
  );
}

function AuthenticatedShell({
  authEnabled,
  onLogout,
}: {
  authEnabled: boolean;
  onLogout: () => void;
}) {
  return (
    <Layout authEnabled={authEnabled} onLogout={onLogout}>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/works/:provider/:workId" element={<WorkDetailPage />} />
        <Route path="/authors/:provider/:authorId" element={<AuthorPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/sync/add" element={<SubscribeAddPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
