import { Box, Slider, Typography } from "@mui/material";
import { formatDuration } from "./LibraryMeta";

export function PlayerSeekBar({
  currentTime,
  duration,
  scrubTime,
  canSeek,
  onScrub,
  onCommit,
  size = "small",
}: {
  currentTime: number;
  duration: number;
  scrubTime: number | null;
  canSeek: boolean;
  onScrub: (value: number) => void;
  onCommit: (value: number) => void;
  size?: "small" | "medium";
}) {
  const max = canSeek ? duration : 0;
  const displayTime =
    scrubTime != null ? Math.min(scrubTime, max) : canSeek ? Math.min(currentTime, max) : 0;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ minWidth: 36, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
      >
        {formatDuration(displayTime, "0:00")}
      </Typography>

      <Slider
        size={size}
        min={0}
        max={max || 0}
        step={0.1}
        value={displayTime}
        disabled={!canSeek}
        onChange={(_, v) => onScrub(v as number)}
        onChangeCommitted={(_, v) => onCommit(v as number)}
        sx={{ flex: 1 }}
        aria-label="播放进度"
      />

      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ minWidth: 42, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
      >
        {canSeek ? formatDuration(duration, "0:00") : "—:—"}
      </Typography>
    </Box>
  );
}
