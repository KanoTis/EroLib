import { useState, forwardRef } from "react";
import {
  Dialog,
  Slide,
  IconButton,
  Typography,
  Slider,
  Box,
} from "@mui/material";
import {
  PlayArrow,
  Pause,
  KeyboardArrowDown,
  VolumeUp,
  VolumeOff,
} from "@mui/icons-material";
import type { TransitionProps } from "@mui/material/transitions";
import { usePlayer } from "../player/PlayerContext";
import { useThemeMode } from "../ThemeContext";
import { CoverImage } from "./CoverImage";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const Transition = forwardRef(function Transition(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export function FullScreenPlayer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    track,
    status,
    currentTime,
    duration,
    volume,
    muted,
    error,
    toggle,
    seek,
    setVolume,
    setMuted,
  } = usePlayer();

  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const scrubbing = scrubTime != null;

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const max = canSeek ? duration : 0;
  const displayTime = scrubbing ? Math.min(scrubTime, max) : canSeek ? Math.min(currentTime, max) : 0;

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      slots={{ transition: Transition }}
      sx={{
        "& .MuiDialog-paper": {
          bgcolor: isLight ? "rgba(250,250,248,0.97)" : "rgba(10,10,20,0.97)",
          backdropFilter: "blur(24px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        },
      }}
    >
      <IconButton
        onClick={onClose}
        sx={{ position: "absolute", top: 16, left: 16, zIndex: 1 }}
        aria-label="关闭全屏播放器"
      >
        <KeyboardArrowDown />
      </IconButton>

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          px: 4,
          maxWidth: 360,
          width: "100%",
        }}
      >
        {/* Cover */}
        <Box
          sx={{
            width: 280,
            height: 280,
            borderRadius: 4,
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: isLight ? "none" : "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <CoverImage
            provider={track.provider}
            workId={track.mediaId}
            title={track.title}
            authorName={track.subtitle}
            coverPath={track.artworkUrl}
            size={280}
          />
        </Box>

        {/* Title + subtitle */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, textAlign: "center", width: "100%" }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 600, maxWidth: "100%" }}>
            {track.title}
          </Typography>
          {track.subtitle && (
            <Typography variant="body2" color="text.disabled">
              {track.subtitle}
            </Typography>
          )}
          {(error || status === "error") && (
            <Typography variant="caption" color="error">
              {error ?? "无法播放"}
            </Typography>
          )}
        </Box>

        {/* Seek */}
        <Box sx={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, width: "100%" }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 36 }}>
            {formatTime(displayTime)}
          </Typography>
          <Slider
            min={0}
            max={max || 0}
            step={0.1}
            value={displayTime}
            disabled={!canSeek}
            onChange={(_, v) => setScrubTime(v as number)}
            onChangeCommitted={(_, v) => {
              setScrubTime(null);
              seek(v as number);
            }}
            sx={{ flex: 1 }}
            aria-label="播放进度"
          />
          <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: "tabular-nums", minWidth: 42 }}>
            {canSeek ? formatTime(duration) : "—:—"}
          </Typography>
        </Box>

        {/* Big play/pause */}
        <IconButton
          onClick={toggle}
          color="primary"
          sx={{
            bgcolor: "primary.main",
            color: "#fff",
            "&:hover": { bgcolor: "primary.dark" },
            width: 72,
            height: 72,
          }}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? <Pause sx={{ fontSize: 40 }} /> : <PlayArrow sx={{ fontSize: 40 }} />}
        </IconButton>

        {/* Volume */}
        <Box sx={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 1, justifyContent: "center", width: "100%" }}>
          <IconButton
            size="small"
            onClick={() => setMuted(!(muted || volume === 0))}
            aria-label={muted || volume === 0 ? "取消静音" : "静音"}
          >
            {muted || volume === 0 ? <VolumeOff /> : <VolumeUp />}
          </IconButton>
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(_, v) => {
              setVolume(v as number);
              if ((v as number) > 0 && muted) setMuted(false);
            }}
            sx={{ width: 120 }}
            aria-label="音量"
          />
        </Box>
      </Box>
    </Dialog>
  );
}
