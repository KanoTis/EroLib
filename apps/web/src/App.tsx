import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import {
  IconJobs,
  IconLibrary,
  IconLogout,
  IconMenu,
  IconProviders,
  IconRefresh,
  IconSettings,
  IconWave,
} from "./components/Icons";
import { PlayerBar } from "./components/PlayerBar";
import { PlayerProvider, usePlayer } from "./player/PlayerContext";
import { AuthorPage } from "./pages/AuthorPage";
import { JobsPage } from "./pages/JobsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LivePage } from "./pages/LivePage";
import { LoginPage } from "./pages/LoginPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SubscribeAddPage } from "./pages/SubscribeAddPage";
import { SyncPage } from "./pages/SyncPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";

export function App() {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  async function refreshAuth(): Promise<void> {
    const s = await api.authStatus();
    setAuthEnabled(s.authEnabled);
    setAuthenticated(s.authenticated);
  }

  useEffect(() => {
    void refreshAuth()
      .catch(() => {
        setAuthEnabled(false);
        setAuthenticated(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="center">
        <div className="loading-block" role="status" aria-live="polite">
          <span className="spinner" />
          加载中…
        </div>
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
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        onLogout={() => {
          void api.logout().then(() => refreshAuth());
        }}
      />
    </PlayerProvider>
  );
}

function AuthenticatedShell({
  authEnabled,
  navOpen,
  setNavOpen,
  onLogout,
}: {
  authEnabled: boolean;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  onLogout: () => void;
}) {
  const location = useLocation();
  const { track } = usePlayer();

  return (
    <div className={track ? "layout layout--player-open" : "layout"}>
      {navOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside className={navOpen ? "sidebar open" : "sidebar"} aria-label="主导航">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <IconWave width={20} height={20} />
          </div>
          <div className="brand-text">
            <div className="brand-title">Erolib</div>
            <div className="brand-sub">本地音声备份库</div>
          </div>
        </div>

        <nav className="nav-list">
          <NavLink to="/" icon={<IconLibrary />}>
            媒体库
          </NavLink>
          <NavLink to="/providers" icon={<IconProviders />}>
            Providers
          </NavLink>
          <NavLink to="/sync" icon={<IconRefresh />}>
            同步
          </NavLink>
          <NavLink to="/jobs" icon={<IconJobs />}>
            下载任务
          </NavLink>
          <NavLink to="/live" icon={<IconWave />}>
            直播
          </NavLink>
          <NavLink to="/settings" icon={<IconSettings />}>
            设置
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          {authEnabled ? (
            <button className="ghost" type="button" onClick={onLogout}>
              <IconLogout width={16} height={16} />
              退出登录
            </button>
          ) : (
            <p className="muted small">本机鉴权未启用 · 请勿暴露公网</p>
          )}
        </div>
      </aside>

      <div className="layout-main">
        <div className="mobile-topbar">
          <button
            type="button"
            className="secondary icon-btn"
            aria-label="打开导航"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <IconMenu width={18} height={18} />
          </button>
          <strong className="mobile-topbar-title">Erolib</strong>
          <span className="mobile-topbar-spacer" aria-hidden />
        </div>

        <main id="main" className="content" key={location.pathname}>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/works/:provider/:workId" element={<WorkDetailPage />} />
            <Route
              path="/authors/:provider/:authorId"
              element={<AuthorPage />}
            />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/sync/add" element={<SubscribeAddPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <PlayerBar />
    </div>
  );
}

function NavLink({
  to,
  children,
  icon,
}: {
  to: string;
  children: ReactNode;
  icon: ReactNode;
}) {
  const loc = useLocation();
  const active =
    to === "/"
      ? loc.pathname === "/"
      : loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  return (
    <Link className={active ? "nav active" : "nav"} to={to} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
