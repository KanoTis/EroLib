import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useThemeMode } from "../ThemeContext";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  return (
    <Box
      sx={{
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        gap: 2,
        py: 8,
        px: 2,
        border: "1px dashed",
        borderColor: "divider",
        borderRadius: 3,
        bgcolor: isLight ? "#F9F9F8" : "rgba(27,27,48,0.45)",
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        {icon && <Box sx={{ color: "text.disabled", mb: 0.5 }}>{icon}</Box>}
        <Typography variant="h6" color="text.primary">{title}</Typography>
        {description && (
          <Typography variant="body2" color="text.disabled" sx={{ maxWidth: 420 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box>{action}</Box>}
    </Box>
  );
}
