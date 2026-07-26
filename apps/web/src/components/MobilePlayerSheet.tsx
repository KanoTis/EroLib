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

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            bgcolor: isLight ? "#ffffff" : ASMR.drawerDark,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: "92vh",
            overflowY: "auto",
          },
        },
      }}
    >
      <PlayerExpandedContent onCollapse={onClose} variant="mobile" />
    </Drawer>
  );
}
