import { useState } from "react";
import {
  Box,
  IconButton,
  Paper,
  Slider,
  Typography,
} from "@mui/material";
import {
  PlayArrow,
  Pause,
  Close,
  VolumeUp,
  VolumeOff,
  KeyboardArrowUp,
  KeyboardArrowDown,
} from "@mui/icons-material";
import { usePlayer } from "../player/PlayerContext";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";
import { CoverImage } from "./CoverImage";

/** Match Layout COLLAPSED_WIDTH — bottom bar sits beside the rail */
const RAIL_WIDTH = 56;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PcPlayerPanel() {
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
    stop,
  } = usePlayer();

  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const scrubbing = scrubTime != null;

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const max = canSeek ? duration : 0;
  const displayTime = scrubbing
    ? Math.min(scrubTime, max)
    : canSeek
      ? Math.min(currentTime, max)
      : 0;
  const progress = canSeek ? (currentTime / duration) * 100 : 0;

  const barBg = isLight ? ASMR.playerBarLight : ASMR.playerBarDark;
  const panelBg = isLight ? "rgba(255,255,255,0.98)" : ASMR.drawerDark;

  /* ---- Collapsed: full-width bottom bar (asmr.one / mobile style) ---- */
  if (collapsed) {
    return (
      <Paper
        elevation={0}
        sx={{
          position: "fixed",
          bottom: 0,
          left: { xs: 0, md: RAIL_WIDTH },
          right: 0,
          zIndex: 1200,
          bgcolor: barBg,
          borderTop: "1px solid",
          borderColor: "divider",
          borderRadius: 0,
        }}
        role="region"
        aria-label="播放器"
      >
        <Box sx={{ height: 2, bgcolor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)" }}>
          <Box
            sx={{
              height: "100%",
              width: `${progress}%`,
              bgcolor: "primary.main",
              transition: "width 200ms linear",
            }}
          />
        </Box>

        <Box
          onClick={() => setCollapsed(false)}
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1.5,
            py: 0.75,
            cursor: "pointer",
            minHeight: 60,
            gap: 1,
          }}
        >
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 1,
              flexShrink: 0,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <CoverImage
              provider={track.provider}
              workId={track.mediaId}
              title={track.title}
              authorName={track.subtitle}
              coverPath={track.artworkUrl}
              size={44}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
              {track.title}
            </Typography>
            {track.subtitle && (
              <Typography variant="caption" color="text.disabled" noWrap>
                {track.subtitle}
              </Typography>
            )}
          </Box>

          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            color="primary"
            aria-label={isPlaying ? "暂停" : "播放"}
          >
            {isPlaying ? <Pause /> : <PlayArrow />}
          </IconButton>

          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(false);
            }}
            aria-label="展开播放器"
          >
            <KeyboardArrowUp />
          </IconButton>

          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              stop();
            }}
            aria-label="关闭播放器"
          >
            <Close fontSize="small" />
          </IconButton>
        </Box>
      </Paper>
    );
  }

  /* ---- Expanded: floating panel (bottom-right), unchanged from original ---- */
  return (
    <Paper
      elevation={0}
      sx={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1300,
        width: 340,
        maxWidth: "calc(100vw - 48px)",
        bgcolor: panelBg,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 3,
        overflow: "hidden",
        boxShadow: isLight ? "0 8px 32px rgba(0,0,0,0.12)" : "0 8px 32px rgba(0,0,0,0.45)",
      }}
      role="region"
      aria-label="播放器"
    >
      <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
          <Box
            sx={{
              width: 72,
              height: 72,
              borderRadius: 2,
              flexShrink: 0,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <CoverImage
              provider={track.provider}
              workId={track.mediaId}
              title={track.title}
              authorName={track.subtitle}
              coverPath={track.artworkUrl}
              size={72}
            />
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {track.kind === "live" && (
                <Typography
                  component="span"
                  sx={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    px: 0.6,
                    py: 0.15,
                    borderRadius: 999,
                    bgcolor: isLight ? "#FBF3DB" : "rgba(234,179,8,0.16)",
                    color: isLight ? "#956400" : "#fde68a",
                    flexShrink: 0,
                  }}
                >
                  直播
                </Typography>
              )}
              <Typography noWrap title={track.title} sx={{ fontWeight: 600, fontSize: "0.95rem" }}>
                {track.title}
              </Typography>
            </Box>
            {track.subtitle && (
              <Typography variant="body2" color="text.disabled" noWrap>
                {track.subtitle}
              </Typography>
            )}
            {(error || status === "error") && (
              <Typography variant="caption" color="error">
                {error ?? "无法播放"}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: "flex", gap: 0.5 }}>
            <IconButton size="small" onClick={() => setCollapsed(true)} aria-label="收起播放器">
              <KeyboardArrowDown fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={stop} aria-label="关闭播放器">
              <Close fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              onClick={toggle}
              sx={{
                bgcolor: "primary.main",
                color: "#fff",
                "&:hover": { bgcolor: "primary.dark" },
                width: 48,
                height: 48,
              }}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause /> : <PlayArrow />}
            </IconButton>

            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ minWidth: 36, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
            >
              {formatTime(displayTime)}
            </Typography>

            <Slider
              size="small"
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

            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ minWidth: 42, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
            >
              {canSeek ? formatTime(duration) : "—:—"}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton
              size="small"
              onClick={() => setMuted(!(muted || volume === 0))}
              aria-label={muted || volume === 0 ? "取消静音" : "静音"}
            >
              {muted || volume === 0 ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
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
              sx={{ width: 80 }}
              aria-label="音量"
            />
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
