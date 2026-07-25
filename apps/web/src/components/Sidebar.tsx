import { Link, useLocation } from "react-router-dom";
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
} from "@mui/material";
import {
  LibraryMusic,
  Settings,
  Sync,
  Download,
  Mic,
  Storage,
  Logout,
  LightMode,
  DarkMode,
} from "@mui/icons-material";
import { useThemeMode } from "../ThemeContext";

/** Must match Layout COLLAPSED_WIDTH */
const RAIL_WIDTH = 56;
/** Shared inset — collapsed item becomes (56-16)=40 square; expanded keeps same inset */
const ITEM_MX = 8;
const ITEM_H = 40;
const ICON_SLOT = 40;

const NAV_ITEMS = [
  { to: "/", label: "媒体库", icon: <LibraryMusic fontSize="small" /> },
  { to: "/providers", label: "Providers", icon: <Storage fontSize="small" /> },
  { to: "/sync", label: "同步", icon: <Sync fontSize="small" /> },
  { to: "/jobs", label: "下载任务", icon: <Download fontSize="small" /> },
  { to: "/live", label: "直播", icon: <Mic fontSize="small" /> },
  { to: "/settings", label: "设置", icon: <Settings fontSize="small" /> },
];

export function SidebarContent({
  authEnabled,
  onLogout,
  onNavClick,
  collapsed,
}: {
  authEnabled: boolean;
  onLogout: () => void;
  onNavClick?: () => void;
  collapsed?: boolean;
}) {
  const loc = useLocation();
  const { mode, toggle: toggleTheme } = useThemeMode();
  const isLight = mode === "light";

  // Same metrics for mini & expanded — only the drawer width changes (text peels in)
  const itemSx = {
    borderRadius: "8px",
    height: ITEM_H,
    minHeight: ITEM_H,
    mx: `${ITEM_MX}px`,
    my: "2px",
    py: 0,
    pl: 0,
    pr: collapsed ? 0 : 1.5,
    // Collapsed: lock to square inside the rail (56 - 8*2 = 40)
    width: collapsed ? ITEM_H : "auto",
    minWidth: collapsed ? ITEM_H : undefined,
    maxWidth: collapsed ? ITEM_H : "none",
    justifyContent: "flex-start" as const,
    boxSizing: "border-box" as const,
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        py: 1,
        overflow: "hidden",
      }}
    >
      <List
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: 0,
          p: 0,
          // Keep rail content aligned to the left edge of the 40px square
          width: collapsed ? RAIL_WIDTH : "100%",
          "& > .MuiListItemButton-root": { flex: "0 0 auto" },
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active =
            item.to === "/" ? loc.pathname === "/" : loc.pathname === item.to || loc.pathname.startsWith(`${item.to}/`);
          return (
            <ListItemButton
              key={item.to}
              component={Link}
              to={item.to}
              onClick={onNavClick}
              selected={active}
              dense
              disableGutters
              sx={{
                ...itemSx,
                transition:
                  "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms cubic-bezier(0.16, 1, 0.3, 1)",
                color: active ? "primary.main" : "inherit",
                "&.Mui-selected": {
                  backgroundColor: isLight ? "rgba(25, 118, 210, 0.08)" : "rgba(25, 118, 210, 0.16)",
                  color: "primary.main",
                  borderRadius: "8px",
                  "&:hover": {
                    backgroundColor: isLight ? "rgba(25, 118, 210, 0.12)" : "rgba(25, 118, 210, 0.22)",
                  },
                },
                "&.Mui-selected .MuiListItemIcon-root": {
                  color: "primary.main",
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: ICON_SLOT,
                  width: ICON_SLOT,
                  color: "inherit",
                  justifyContent: "center",
                  mr: 0,
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                sx={{
                  my: 0,
                  ml: 0.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
                slotProps={{
                  primary: {
                    sx: {
                      fontSize: "0.9375rem",
                      fontWeight: active ? 600 : 500,
                      lineHeight: 1.3,
                    },
                  },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Box
        sx={{
          borderTop: "1px solid",
          borderColor: "divider",
          pt: 0.5,
          mt: "auto",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          width: collapsed ? RAIL_WIDTH : "100%",
        }}
      >
        <ListItemButton
          onClick={toggleTheme}
          dense
          disableGutters
          sx={itemSx}
          aria-label={isLight ? "切换到深色模式" : "切换到浅色模式"}
        >
          <ListItemIcon sx={{ minWidth: ICON_SLOT, width: ICON_SLOT, color: "inherit", justifyContent: "center", mr: 0 }}>
            {isLight ? <DarkMode fontSize="small" /> : <LightMode fontSize="small" />}
          </ListItemIcon>
          <ListItemText
            primary={isLight ? "深色模式" : "浅色模式"}
            sx={{ my: 0, ml: 0.5, whiteSpace: "nowrap", overflow: "hidden" }}
            slotProps={{
              primary: { sx: { fontSize: "0.9375rem", fontWeight: 500, lineHeight: 1.3 } },
            }}
          />
        </ListItemButton>

        {authEnabled ? (
          <ListItemButton onClick={onLogout} dense disableGutters sx={{ ...itemSx, color: "text.secondary" }}>
            <ListItemIcon sx={{ minWidth: ICON_SLOT, width: ICON_SLOT, color: "inherit", justifyContent: "center", mr: 0 }}>
              <Logout fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="退出登录"
              sx={{ my: 0, ml: 0.5, whiteSpace: "nowrap", overflow: "hidden" }}
              slotProps={{
                primary: { sx: { fontSize: "0.9375rem", fontWeight: 500, lineHeight: 1.3 } },
              }}
            />
          </ListItemButton>
        ) : (
          !collapsed && (
            <Typography variant="caption" color="text.disabled" sx={{ px: 2, py: 0.5, display: "block", whiteSpace: "nowrap" }}>
              本机鉴权未启用
            </Typography>
          )
        )}
      </Box>
    </Box>
  );
}
