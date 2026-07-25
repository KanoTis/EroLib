import { Paper, IconButton, Typography, Box } from "@mui/material";
import { PlayArrow, Pause } from "@mui/icons-material";
import { usePlayer } from "../player/PlayerContext";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";
import { CoverImage } from "./CoverImage";

export function MiniPlayerBar({ onExpand }: { onExpand: () => void }) {
  const { track, status, currentTime, duration, toggle } = usePlayer();
  const { mode } = useThemeMode();
  const isLight = mode === "light";

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const progress = canSeek ? (currentTime / duration) * 100 : 0;

  return (
    <Paper
      elevation={0}
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        bgcolor: isLight ? ASMR.playerBarLight : ASMR.playerBarDark,
        borderTop: "1px solid",
        borderColor: isLight ? "divider" : "rgba(255,255,255,0.08)",
        borderRadius: 0,
        pb: "env(safe-area-inset-bottom, 0px)",
      }}
      role="region"
      aria-label="播放器"
    >
      <Box sx={{ height: 3, bgcolor: "rgba(148,163,184,0.2)" }}>
        <Box sx={{ height: "100%", width: `${progress}%`, bgcolor: "primary.main", transition: "width 200ms linear" }} />
      </Box>

      <Box
        onClick={onExpand}
        sx={{ display: "flex", alignItems: "center", px: 1.5, py: 0.75, cursor: "pointer", minHeight: 60 }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1,
            flexShrink: 0,
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
            mr: 1.5,
          }}
        >
          <CoverImage
            provider={track.provider}
            workId={track.mediaId}
            title={track.title}
            authorName={track.subtitle}
            coverPath={track.artworkUrl}
            size={40}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, mr: 1, display: "flex", flexDirection: "column" }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
            {track.title}
          </Typography>
          {track.subtitle && (
            <Typography variant="caption" color="text.disabled" noWrap>
              {track.subtitle}
            </Typography>
          )}
        </Box>

        <IconButton
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          color="primary"
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? <Pause /> : <PlayArrow />}
        </IconButton>
      </Box>
    </Paper>
  );
}
