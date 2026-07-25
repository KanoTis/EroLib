import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeProvider } from "@mui/material";
import { themes, type ThemeMode } from "./theme";

const STORAGE_KEY = "erolib.themeMode";

function readMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch { /* noop */ }
  return "dark";
}

interface ThemeCtx {
  mode: ThemeMode;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ mode: "dark", toggle: () => {} });

export function useThemeMode(): ThemeCtx {
  return useContext(Ctx);
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readMode);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    document.body.setAttribute("data-theme-mode", mode);
  }, [mode]);

  const theme = useMemo(() => themes[mode], [mode]);

  const value = useMemo<ThemeCtx>(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <Ctx.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </Ctx.Provider>
  );
}
