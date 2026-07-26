import { Box, List, ListItemButton, Popover, Typography } from "@mui/material";
import type { PlayableTrack } from "../player/types";
import { ASMR } from "../theme";
import { CoverImage } from "./CoverImage";

export function PlayerQueuePopover({
  anchorEl,
  open,
  onClose,
  queue,
  queueIndex,
  onSelect,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  queue: PlayableTrack[];
  queueIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      slotProps={{ paper: { sx: { width: 300, maxWidth: "90vw", borderRadius: 2 } } }}
    >
      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          播放队列 · {queue.length}
        </Typography>
      </Box>

      <List dense disablePadding sx={{ maxHeight: 320, overflowY: "auto" }}>
        {queue.map((t, i) => {
          const active = i === queueIndex;
          return (
            <ListItemButton
              key={`${t.id}-${i}`}
              onClick={() => onSelect(i)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 0.75,
                bgcolor: active ? ASMR.playerAccent : "transparent",
                "&:hover": { bgcolor: active ? ASMR.playerAccent : undefined },
              }}
            >
              <Box sx={{ width: 36, height: 36, borderRadius: 1, overflow: "hidden", flexShrink: 0 }}>
                <CoverImage
                  provider={t.provider}
                  workId={t.mediaId}
                  title={t.title}
                  authorName={t.subtitle}
                  coverPath={t.artworkUrl}
                  size={36}
                />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  noWrap
                  sx={{ fontSize: "0.85rem", fontWeight: active ? 700 : 500, color: active ? "#fff" : "text.primary" }}
                >
                  {t.title}
                </Typography>
                {t.subtitle && (
                  <Typography
                    noWrap
                    sx={{ fontSize: "0.72rem", color: active ? "rgba(255,255,255,0.75)" : "text.disabled" }}
                  >
                    {t.subtitle}
                  </Typography>
                )}
              </Box>
            </ListItemButton>
          );
        })}
      </List>
    </Popover>
  );
}
