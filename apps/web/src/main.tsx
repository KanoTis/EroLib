import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CssBaseline } from "@mui/material";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import { App } from "./App";
import { AppThemeProvider } from "./ThemeContext";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");

createRoot(rootEl).render(
  <StrictMode>
    <AppThemeProvider>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppThemeProvider>
  </StrictMode>,
);
