import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import {
  IconJobs,
  IconLibrary,
  IconLogout,
  IconMenu,
  IconProviders,
  IconSettings,
  IconWave,
} from "./components/Icons";
import { JobsPage } from "./pages/JobsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { SettingsPage } from "./pages/SettingsPage";
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
    <div className="layout">
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
          <NavLink to="/jobs" icon={<IconJobs />}>
            同步 / 任务
          </NavLink>
          <NavLink to="/settings" icon={<IconSettings />}>
            设置
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          {authEnabled ? (
            <button
              className="ghost"
              type="button"
              onClick={() => {
                void api.logout().then(() => refreshAuth());
              }}
            >
              <IconLogout width={16} height={16} />
              退出登录
            </button>
          ) : (
            <p className="muted small">本机鉴权未启用 · 请勿暴露公网</p>
          )}
        </div>
      </aside>

      <div>
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
          <strong>Erolib</strong>
          <span className="muted small">备份库</span>
        </div>

        <main id="main" className="content" key={location.pathname}>
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/works/:provider/:workId" element={<WorkDetailPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
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
