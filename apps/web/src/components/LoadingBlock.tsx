import { CircularProgress, Box, Typography } from "@mui/material";

export function LoadingBlock({ text = "加载中…" }: { text?: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.disabled" }}>
      <CircularProgress size={18} />
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}
