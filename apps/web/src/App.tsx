import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { ScrollManager } from "./navigation";
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
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const libraryActive = pathname === "/";
  // Keep the library mounted after the first visit so its list + DOM height survive
  // detail navigations. Window scroll is restored below / by ScrollManager.
  const [libraryMounted, setLibraryMounted] = useState(libraryActive);
  const libraryScrollRef = useRef(0);

  useEffect(() => {
    if (libraryActive) setLibraryMounted(true);
  }, [libraryActive]);

  // Record scroll only while the library is the visible page — never after a
  // route swap has already clamped window.scrollY to 0.
  useEffect(() => {
    if (!libraryActive) return;
    const save = () => {
      libraryScrollRef.current = window.scrollY;
    };
    window.addEventListener("scroll", save, { passive: true });
    document.addEventListener("click", save, true);
    return () => {
      window.removeEventListener("scroll", save);
      document.removeEventListener("click", save, true);
    };
  }, [libraryActive]);

  useLayoutEffect(() => {
    if (!libraryActive) return;
    // Back/forward: restore. Fresh visits to "/" (sidebar Link, search icon): top.
    const y = navigationType === "POP" ? libraryScrollRef.current : 0;
    if (navigationType !== "POP") libraryScrollRef.current = 0;
    window.scrollTo(0, y);
  }, [libraryActive, pathname, navigationType]);

  return (
    <Layout authEnabled={authEnabled} onLogout={onLogout}>
      {libraryMounted && (
        <Box
          sx={{ display: libraryActive ? "block" : "none" }}
          aria-hidden={!libraryActive}
        >
          <LibraryPage active={libraryActive} />
        </Box>
      )}
      <Routes>
        {/* Library is rendered above; keep the index route so Links to "/" resolve. */}
        <Route path="/" element={null} />
        <Route path="/works/:provider/:workId" element={<WorkDetailPage />} />
        <Route path="/authors/:provider/:authorId" element={<AuthorPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/sync/add" element={<SubscribeAddPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ScrollManager />
    </Layout>
  );
}
