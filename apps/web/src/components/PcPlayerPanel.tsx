import { useState } from "react";
import { Box, IconButton, Paper, Typography } from "@mui/material";
import { PlayArrow, Pause, Close, KeyboardArrowUp, SkipPrevious, SkipNext } from "@mui/icons-material";
import { usePlayer } from "../player/PlayerContext";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";
import { CoverImage } from "./CoverImage";
import { PlayerExpandedContent } from "./PlayerExpandedContent";

/** Match Layout COLLAPSED_WIDTH — bottom bar sits beside the rail */
const RAIL_WIDTH = 56;

export function PcPlayerPanel() {
  const { track, status, currentTime, duration, toggle, stop, next, previous, hasNext, hasPrevious } = usePlayer();

  const [collapsed, setCollapsed] = useState(true);
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
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
            gap: 0.5,
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
              mr: 0.5,
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
            onClick={(e) => { e.stopPropagation(); previous(); }}
            disabled={!hasPrevious}
            aria-label="上一曲"
          >
            <SkipPrevious fontSize="small" />
          </IconButton>

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
            onClick={(e) => { e.stopPropagation(); next(); }}
            disabled={!hasNext}
            aria-label="下一曲"
          >
            <SkipNext fontSize="small" />
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

  /* ---- Expanded: floating panel, bottom-right (asmr.one style) ---- */
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
      <PlayerExpandedContent onCollapse={() => setCollapsed(true)} variant="desktop" />
    </Paper>
  );
}
