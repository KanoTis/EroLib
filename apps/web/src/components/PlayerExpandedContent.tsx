import { useState } from "react";
import { Box, ButtonBase, Divider, IconButton, Typography } from "@mui/material";
import { QueueMusic, Stop } from "@mui/icons-material";
import { usePlayer } from "../player/PlayerContext";
import { CoverImage } from "./CoverImage";
import { MarqueeText } from "./MarqueeText";
import { PlayerQueuePopover } from "./PlayerQueuePopover";
import { PlayerSeekBar } from "./PlayerSeekBar";
import { PlayerTransportControls } from "./PlayerTransportControls";
import { PlayerVolumeControl } from "./PlayerVolumeControl";

/**
 * Shared body for the expanded player: desktop floating panel and the mobile
 * bottom sheet both render this, just inside different chrome/positioning.
 */
export function PlayerExpandedContent({
  onCollapse,
  variant = "desktop",
}: {
  onCollapse: () => void;
  variant?: "desktop" | "mobile";
}) {
  const {
    track,
    status,
    currentTime,
    duration,
    volume,
    muted,
    error,
    queue,
    queueIndex,
    hasNext,
    hasPrevious,
    toggle,
    seek,
    setVolume,
    setMuted,
    stop,
    next,
    previous,
    playAt,
  } = usePlayer();

  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [queueAnchor, setQueueAnchor] = useState<HTMLElement | null>(null);

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const isLarge = variant === "mobile";

  function handleRewind() {
    seek(Math.max(0, currentTime - 5));
  }
  function handleForward() {
    seek(Math.max(0, canSeek ? Math.min(duration, currentTime + 30) : currentTime + 30));
  }
  function handleVolumeChange(v: number) {
    setVolume(v);
    if (v > 0 && muted) setMuted(false);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <ButtonBase onClick={onCollapse} aria-label="收起播放器" sx={{ width: "100%", py: 1 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 999, bgcolor: "text.disabled", opacity: 0.4 }} />
      </ButtonBase>

      <Box sx={{ width: "100%", maxWidth: isLarge ? 420 : undefined, mx: "auto" }}>
        <CoverImage
          provider={track.provider}
          workId={track.mediaId}
          title={track.title}
          authorName={track.subtitle}
          coverPath={track.artworkUrl}
          size="card"
        />

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: isLarge ? 2.5 : 1.5,
            px: isLarge ? 3 : 2.5,
            pt: isLarge ? 2.5 : 2,
            pb: isLarge ? 3 : 2.5,
          }}
        >
          <Box sx={{ textAlign: "center" }}>
            {track.kind === "live" && (
              <Typography
                component="span"
                sx={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  px: 0.6,
                  py: 0.15,
                  mb: 0.5,
                  display: "inline-block",
                  borderRadius: 999,
                  bgcolor: "rgba(234,179,8,0.16)",
                  color: "#eab308",
                }}
              >
                直播
              </Typography>
            )}
            <MarqueeText sx={{ fontWeight: 700, fontSize: isLarge ? "1.05rem" : "0.95rem" }}>
              {track.title}
            </MarqueeText>
            {track.subtitle && (
              <Typography noWrap variant="body2" color="text.disabled">
                {track.subtitle}
              </Typography>
            )}
            {(error || status === "error") && (
              <Typography variant="caption" color="error">
                {error ?? "无法播放"}
              </Typography>
            )}
          </Box>

          <PlayerSeekBar
            currentTime={currentTime}
            duration={duration}
            scrubTime={scrubTime}
            canSeek={canSeek}
            onScrub={setScrubTime}
            onCommit={(v) => {
              setScrubTime(null);
              seek(v);
            }}
            size={isLarge ? "medium" : "small"}
          />

          <PlayerTransportControls
            isPlaying={isPlaying}
            onToggle={toggle}
            onPrev={previous}
            onNext={next}
            onRewind={handleRewind}
            onForward={handleForward}
            hasPrev={hasPrevious}
            hasNext={hasNext}
            size={isLarge ? "lg" : "md"}
          />

          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <PlayerVolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={handleVolumeChange}
              onToggleMute={() => setMuted(!(muted || volume === 0))}
              width={isLarge ? 160 : 120}
            />
          </Box>

          <Divider sx={{ opacity: 0.6 }} />

          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
            <IconButton
              size="small"
              disabled={queue.length <= 1}
              onClick={(e) => setQueueAnchor(e.currentTarget)}
              aria-label="播放队列"
            >
              <QueueMusic fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => {
                stop();
                onCollapse();
              }}
              aria-label="停止播放"
            >
              <Stop fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <PlayerQueuePopover
        anchorEl={queueAnchor}
        open={Boolean(queueAnchor)}
        onClose={() => setQueueAnchor(null)}
        queue={queue}
        queueIndex={queueIndex}
        onSelect={(i) => {
          playAt(i);
          setQueueAnchor(null);
        }}
      />
    </Box>
  );
}
