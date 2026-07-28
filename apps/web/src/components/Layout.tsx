import { useState, useCallback, type ReactNode, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { keyframes } from "@emotion/react";
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Menu, ArrowBackIosNew, Search } from "@mui/icons-material";
import { SidebarContent } from "./Sidebar";
import { PcPlayerPanel } from "./PcPlayerPanel";
import { MiniPlayerBar } from "./MiniPlayerBar";
import { MobilePlayerSheet } from "./MobilePlayerSheet";
import { useGoBack } from "../navigation";
import { usePlayer } from "../player/PlayerContext";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";

const DRAWER_WIDTH = 260;
const COLLAPSED_WIDTH = 56;
const APP_BAR_HEIGHT = 50;

const titleSlideIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
`;

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "媒体库";
  if (pathname === "/sync") return "同步";
  if (pathname === "/sync/add") return "手动添加作者";
  if (pathname === "/status") return "运行状态";
  if (pathname === "/settings") return "设置";
  if (pathname.startsWith("/works/")) return "作品详情";
  if (pathname.startsWith("/authors/")) return "作者详情";
  return "Erolib";
}

function PageTitle({ pathname }: { pathname: string }) {
  const title = useMemo(() => getPageTitle(pathname), [pathname]);
  return (
    <Typography
      key={pathname}
      noWrap
      sx={{
        fontWeight: 600,
        fontSize: "1.125rem",
        letterSpacing: "0.01em",
        ml: 0.5,
        flex: 1,
        animation: `${titleSlideIn} 260ms cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    >
      {title}
    </Typography>
  );
}

export function Layout({
  authEnabled,
  onLogout,
  children,
}: {
  authEnabled: boolean;
  onLogout: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useGoBack();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [desktopNavOpen, setDesktopNavOpen] = useState(false);

  const sidebarExpanded = sidebarHovered || desktopNavOpen;
  const sidebarEnter = useCallback(() => setSidebarHovered(true), []);
  const sidebarLeave = useCallback(() => setSidebarHovered(false), []);
  const closeDesktopNav = useCallback(() => {
    setSidebarHovered(false);
    setDesktopNavOpen(false);
  }, []);

  const { track } = usePlayer();
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const canGoBack = location.pathname !== "/";
  const pageBg = isLight ? ASMR.pageLight : ASMR.pageDark;

  const sidebarEl = (
    <SidebarContent
      authEnabled={authEnabled}
      onLogout={onLogout}
      onNavClick={() => {
        setMobileOpen(false);
        closeDesktopNav();
      }}
    />
  );

  // asmr.one: light bg-grey-1 / dark $dark (#1d1d1d)
  const sidebarSx = {
    bgcolor: isLight ? ASMR.drawerLight : ASMR.drawerDark,
    borderRight: "1px solid",
    borderColor: isLight ? "#e0e0e0" : "rgba(255,255,255,0.12)",
    color: isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.7)",
  };

  const overlayShadow = isLight
    ? "2px 0 8px rgba(0, 0, 0, 0.12)"
    : "2px 0 12px rgba(0, 0, 0, 0.5)";

  function toggleNav() {
    if (isMobile) setMobileOpen((v) => !v);
    else setDesktopNavOpen((v) => !v);
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        bgcolor: pageBg,
      }}
    >
      {/* Fixed top bar — never scrolls away (Quasar fixed-top) */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 10,
          height: APP_BAR_HEIGHT,
          bgcolor: ASMR.primary,
          color: "#fff",
          boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
        }}
      >
        <Toolbar
          disableGutters
          sx={{
            minHeight: `${APP_BAR_HEIGHT}px !important`,
            height: APP_BAR_HEIGHT,
            px: 1,
            gap: 0.25,
          }}
        >
          <IconButton
            onClick={toggleNav}
            aria-label="打开导航"
            size="small"
            sx={{ width: 34, height: 34, color: "inherit" }}
          >
            <Menu fontSize="small" />
          </IconButton>

          {canGoBack && (
            <IconButton
              onClick={goBack}
              aria-label="返回"
              size="small"
              sx={{ width: 34, height: 34, color: "inherit" }}
            >
              <ArrowBackIosNew sx={{ fontSize: 16 }} />
            </IconButton>
          )}

          <PageTitle pathname={location.pathname} />

          <IconButton
            onClick={() => navigate("/")}
            aria-label="搜索媒体库"
            size="small"
            sx={{ width: 34, height: 34, color: "inherit", mr: 0.5 }}
          >
            <Search fontSize="small" />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Offset for fixed AppBar */}
      <Box sx={{ height: APP_BAR_HEIGHT, flexShrink: 0 }} aria-hidden />

      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          position: "relative",
          bgcolor: pageBg,
        }}
      >
        {/* Desktop overlay scrim — below app bar */}
        {!isMobile && sidebarExpanded && (
          <Box
            aria-hidden
            onClick={closeDesktopNav}
            sx={{
              position: "fixed",
              top: APP_BAR_HEIGHT,
              left: 0,
              right: 0,
              bottom: 0,
              bgcolor: isLight ? "rgba(0, 0, 0, 0.32)" : "rgba(0, 0, 0, 0.5)",
              zIndex: (t) => t.zIndex.drawer,
            }}
          />
        )}

        {/* Sidebar */}
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              "& .MuiDrawer-paper": {
                width: "min(82vw, 280px)",
                top: APP_BAR_HEIGHT,
                height: `calc(100% - ${APP_BAR_HEIGHT}px)`,
                boxShadow: overlayShadow,
                ...sidebarSx,
              },
            }}
            slotProps={{
              backdrop: {
                sx: {
                  top: APP_BAR_HEIGHT,
                  bgcolor: isLight ? "rgba(0, 0, 0, 0.32)" : "rgba(0, 0, 0, 0.5)",
                },
              },
            }}
          >
            {sidebarEl}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            slotProps={{
              paper: {
                onMouseEnter: sidebarEnter,
                onMouseLeave: sidebarLeave,
              },
            }}
            sx={{
              width: COLLAPSED_WIDTH,
              flexShrink: 0,
              "& .MuiDrawer-paper": {
                width: sidebarExpanded ? DRAWER_WIDTH : COLLAPSED_WIDTH,
                top: APP_BAR_HEIGHT,
                height: `calc(100% - ${APP_BAR_HEIGHT}px)`,
                overflow: "hidden",
                transition:
                  "width 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)",
                zIndex: (t) => t.zIndex.drawer + (sidebarExpanded ? 2 : 0),
                boxShadow: sidebarExpanded ? overlayShadow : "none",
                ...sidebarSx,
              },
            }}
          >
            <SidebarContent
              authEnabled={authEnabled}
              onLogout={onLogout}
              onNavClick={closeDesktopNav}
              collapsed={!sidebarExpanded}
            />
          </Drawer>
        )}

        {/* Main — Quasar dark-page / grey-3 */}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            bgcolor: pageBg,
            pb: track ? "72px" : 0,
          }}
        >
          <Box sx={{ flex: 1, px: isMobile ? 2 : 3, py: isMobile ? 2 : 2.5, maxWidth: "100%" }}>
            {children}
          </Box>
        </Box>

        {!isMobile && <PcPlayerPanel />}
      </Box>

      {isMobile && <MiniPlayerBar onExpand={() => setFullPlayerOpen(true)} />}
      {isMobile && <MobilePlayerSheet open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)} />}
    </Box>
  );
}
