import { Box, IconButton } from "@mui/material";
import { Forward30, Pause, PlayArrow, Replay5, SkipNext, SkipPrevious } from "@mui/icons-material";

export function PlayerTransportControls({
  isPlaying,
  onToggle,
  onPrev,
  onNext,
  onRewind,
  onForward,
  hasPrev,
  hasNext,
  size = "md",
}: {
  isPlaying: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRewind: () => void;
  onForward: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  size?: "md" | "lg";
}) {
  const isLarge = size === "lg";
  const playIconSize = isLarge ? 52 : 34;
  const sideIconSize = isLarge ? "medium" : "small";

  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: isLarge ? 1.5 : 0.5 }}>
      <IconButton onClick={onPrev} disabled={!hasPrev} size={sideIconSize} aria-label="上一曲">
        <SkipPrevious fontSize={sideIconSize} />
      </IconButton>

      <IconButton onClick={onRewind} size={sideIconSize} aria-label="快退 5 秒">
        <Replay5 fontSize={sideIconSize} />
      </IconButton>

      <IconButton
        onClick={onToggle}
        sx={{ color: "text.primary", mx: isLarge ? 1 : 0.5 }}
        aria-label={isPlaying ? "暂停" : "播放"}
      >
        {isPlaying ? <Pause sx={{ fontSize: playIconSize }} /> : <PlayArrow sx={{ fontSize: playIconSize }} />}
      </IconButton>

      <IconButton onClick={onForward} size={sideIconSize} aria-label="快进 30 秒">
        <Forward30 fontSize={sideIconSize} />
      </IconButton>

      <IconButton onClick={onNext} disabled={!hasNext} size={sideIconSize} aria-label="下一曲">
        <SkipNext fontSize={sideIconSize} />
      </IconButton>
    </Box>
  );
}
