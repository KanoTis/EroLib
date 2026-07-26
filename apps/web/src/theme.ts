import { createTheme } from "@mui/material/styles";

/* asmr.one / Quasar Material palette */
const ASMR = {
  primary: "#1976D2",
  primaryLight: "#42A5F5",
  primaryDark: "#1565C0",
  /** bg-grey-3 — page */
  pageLight: "#eeeeee",
  /** bg-grey-1 — drawer */
  drawerLight: "#fafafa",
  /** Quasar body--dark page */
  pageDark: "#121212",
  /** Quasar dark drawer */
  drawerDark: "#1d1d1d",
  /** Quasar bg-grey-9 — collapsed player bar (asmr.one) */
  playerBarDark: "#212121",
  /** Light player bar — near white surface */
  playerBarLight: "#ffffff",
  /** Quasar secondary teal — asmr.one's "currently playing" highlight (bg-teal), scoped to player-queue UI only */
  playerAccent: "#26A69A",
} as const;

const sharedTypography = {
  fontFamily:
    '"Geist Sans", "Noto Sans SC", system-ui, -apple-system, sans-serif',
  h1: { fontWeight: 700, letterSpacing: "-0.03em" },
  h2: { fontWeight: 600, letterSpacing: "-0.02em" },
  h4: { fontWeight: 700, letterSpacing: "-0.02em" },
  h6: { fontWeight: 600, letterSpacing: "-0.01em" },
  button: { textTransform: "none" as const, fontWeight: 600 },
  overline: { letterSpacing: "0.06em" },
};

const sharedComponents = {
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: {
        minHeight: 44,
        borderRadius: 8,
        transition:
          "transform 150ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "&:active": { transform: "scale(0.97)" },
      },
      contained: {
        backgroundColor: ASMR.primary,
        color: "#fff",
        "&:hover": { backgroundColor: ASMR.primaryDark },
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        transition: "transform 150ms cubic-bezier(0.16, 1, 0.3, 1)",
        "&:active": { transform: "scale(0.92)" },
      },
    },
  },
  MuiTextField: {
    defaultProps: { variant: "outlined" as const, size: "small" as const },
  },
  MuiSelect: {
    defaultProps: {
      size: "small" as const,
      MenuProps: { disableScrollLock: true },
    },
  },
  MuiMenu: {
    defaultProps: { disableScrollLock: true },
  },
  MuiPopover: {
    defaultProps: { disableScrollLock: true },
  },
  MuiModal: {
    defaultProps: { disableScrollLock: true },
  },
  MuiCardContent: {
    styleOverrides: {
      root: { "&:last-child": { paddingBottom: 16 } },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: { fontWeight: 600, letterSpacing: "0.01em" },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: { backgroundImage: "none" },
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: { border: "none" },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { backgroundImage: "none" },
    },
  },
  MuiAppBar: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { backgroundImage: "none" },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        borderRadius: 10,
        transition: "background-color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        transition: "all 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
};

/* ---- Dark ---- */
const dark = createTheme({
  palette: {
    mode: "dark",
    primary: { main: ASMR.primary, light: ASMR.primaryLight, dark: ASMR.primaryDark },
    // Align with theme blue so any secondary-colored buttons follow 主题色
    secondary: { main: ASMR.primary, light: ASMR.primaryLight, dark: ASMR.primaryDark },
    error: { main: "#ef4444" },
    warning: { main: "#eab308" },
    success: { main: "#22c55e" },
    background: { default: ASMR.pageDark, paper: ASMR.drawerDark },
    text: { primary: "#f1f5f9", secondary: "#94a3b8", disabled: "#64748b" },
    divider: "rgba(255,255,255,0.08)",
  },
  shape: { borderRadius: 10 },
  typography: sharedTypography,
  components: {
    ...sharedComponents,
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: "#1d1d1d",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
          transition:
            "transform 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          "&:hover": {
            transform: "translateY(-2px)",
            borderColor: "rgba(25,118,210,0.35)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 30px rgba(0,0,0,0.3)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, letterSpacing: "0.01em" },
        outlined: {},
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: {
          "&:focus, &:hover, &.Mui-active, &.Mui-focusVisible": {
            boxShadow: "0 0 0 8px rgba(25, 118, 210, 0.16)",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: "rgba(255,255,255,0.05)" },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: { transition: "all 180ms cubic-bezier(0.16, 1, 0.3, 1)" },
      },
    },
  },
});

/* ---- Light (Day) — asmr.one: grey-3 page / grey-1 drawer / Material blue bar ---- */
const light = createTheme({
  palette: {
    mode: "light",
    primary: { main: ASMR.primary, light: ASMR.primaryLight, dark: ASMR.primaryDark },
    secondary: { main: ASMR.primary, light: ASMR.primaryLight, dark: ASMR.primaryDark },
    error: { main: "#9F2F2D" },
    warning: { main: "#956400" },
    success: { main: "#346538" },
    background: { default: ASMR.pageLight, paper: "#ffffff" },
    text: { primary: "#212121", secondary: "#616161", disabled: "#9e9e9e" },
    divider: "#e0e0e0",
  },
  shape: { borderRadius: 8 },
  typography: sharedTypography,
  components: {
    ...sharedComponents,
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 6,
          transition:
            "transform 150ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          "&:active": { transform: "scale(0.97)" },
        },
        contained: {
          backgroundColor: ASMR.primary,
          color: "#fff",
          "&:hover": { backgroundColor: ASMR.primaryDark },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: "#FFFFFF",
          border: "1px solid #e0e0e0",
          boxShadow: "none",
          transition:
            "transform 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          "&:hover": {
            transform: "translateY(-2px)",
            borderColor: "rgba(0,0,0,0.18)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, letterSpacing: "0.01em" },
        outlined: { borderColor: "#e0e0e0" },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: {
          "&:focus, &:hover, &.Mui-active, &.Mui-focusVisible": {
            boxShadow: "0 0 0 8px rgba(0,0,0,0.06)",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: "#e0e0e0" },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          transition: "all 180ms cubic-bezier(0.16, 1, 0.3, 1)",
          borderColor: "#e0e0e0",
        },
      },
    },
  },
});

export const themes = { dark, light } as const;
export type ThemeMode = keyof typeof themes;
export { ASMR };
