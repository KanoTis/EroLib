import { useEffect } from "react";
import { Drawer } from "@mui/material";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";
import { PlayerExpandedContent } from "./PlayerExpandedContent";

/** Mobile expanded player — bottom sheet with a drag handle (asmr.one style), not a fullscreen dialog. */
export function MobilePlayerSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  // MUI's disableScrollLock can no-op if some other Modal already registered
  // body with the app-wide `disableScrollLock: true` default. Lock directly
  // on both <html> and <body> so wheel/touch scroll cannot reach the page
  // behind the fullscreen sheet.
  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      sx={{ zIndex: 1400 }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: isLight ? "#ffffff" : ASMR.drawerDark,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            height: "100dvh",
            overflowY: "auto",
            pt: "max(env(safe-area-inset-top, 0px), 8px)",
            pb: "env(safe-area-inset-bottom, 0px)",
          },
        },
      }}
    >
      <PlayerExpandedContent onCollapse={onClose} variant="mobile" />
    </Drawer>
  );
}
