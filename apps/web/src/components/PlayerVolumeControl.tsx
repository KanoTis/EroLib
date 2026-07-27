import { useState } from "react";
import { Box, IconButton, Slider } from "@mui/material";
import { VolumeDown, VolumeOff, VolumeUp } from "@mui/icons-material";

export function PlayerVolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
  width = 100,
  size = "small",
}: {
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
  width?: number;
  size?: "small" | "medium";
}) {
  // Drag updates local state only — committing every tick to the shared
  // player context re-renders every usePlayer() consumer and feels janky.
  const [scrub, setScrub] = useState<number | null>(null);
  const effective = scrub ?? (muted ? 0 : volume);
  const MuteIcon = effective === 0 ? VolumeOff : effective < 0.5 ? VolumeDown : VolumeUp;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <IconButton
        size={size}
        onClick={onToggleMute}
        aria-label={muted || volume === 0 ? "取消静音" : "静音"}
      >
        <MuteIcon fontSize={size} />
      </IconButton>

      <Slider
        size={size}
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(_, v) => setScrub(v as number)}
        onChangeCommitted={(_, v) => {
          onVolumeChange(v as number);
          setScrub(null);
        }}
        sx={{ width }}
        aria-label="音量"
      />

      <IconButton size={size} onClick={() => onVolumeChange(1)} aria-label="最大音量" sx={{ opacity: 0.7 }}>
        <VolumeUp fontSize={size} />
      </IconButton>
    </Box>
  );
}
