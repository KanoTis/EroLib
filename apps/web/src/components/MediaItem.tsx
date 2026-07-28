import { Link } from "react-router-dom";
import {
  Box, IconButton, Card, CardContent, CardActions,
  Typography, Button, Chip,
} from "@mui/material";
import { PlayArrow } from "@mui/icons-material";
import type { LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { CoverImage } from "./CoverImage";
import { AuthorLink } from "./AuthorLink";
import { MetaRow, providerLabel } from "./LibraryMeta";
import { useThemeMode } from "../ThemeContext";
import { ASMR } from "../theme";

export type LibraryItem =
  | { kind: "vod"; key: string; work: WorkPublic }
  | { kind: "live"; key: string; media: LiveMediaPublic };

export interface MediaItemProps {
  item: LibraryItem;
  viewMode: "small" | "standard" | "list";
  index: number;
  total: number;
  onPlay: () => void;
  /** Link target for the title (VOD only). */
  titleHref?: string;
  /** Show a status chip below MetaRow (list) or in CardActions (card). */
  showStatus?: boolean;
  statusLabel?: string;
  statusColor?: "success" | "error" | "warning" | "default";
  /** Show a delete button alongside play. */
  showDelete?: boolean;
  onDelete?: () => void;
  /** Make the provider label clickable. */
  providerClickable?: boolean;
  onProviderClick?: (provider: string) => void;
  /** Replace the play button with "不可播". */
  playDisabled?: boolean;
}

export function MediaItem({
  item, viewMode, index, total, onPlay,
  titleHref, showStatus, statusLabel, statusColor,
  showDelete, onDelete,
  providerClickable, onProviderClick,
  playDisabled,
}: MediaItemProps) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const isSmall = viewMode === "small";
  const isList = viewMode === "list";
  const listSurface = isLight ? "#fff" : ASMR.drawerDark;

  if (item.kind === "live") {
    const m = item.media;
    const title = m.title || m.roomId;
    const providerEl = providerClickable && onProviderClick ? (
      <Box
        component="span"
        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onProviderClick(m.provider); }}
        sx={{ cursor: "pointer", color: "text.secondary", "&:hover": { color: "primary.main" } }}
      >
        {providerLabel(m.provider)}
      </Box>
    ) : (
      providerLabel(m.provider)
    );

    if (isList) {
      return (
        <Box sx={{
          display: "flex", alignItems: "center", gap: 1, pl: 0, pr: 1, py: 0,
          borderBottom: index < total - 1 ? "1px solid" : "none", borderColor: "divider",
          "&:hover": { bgcolor: isLight ? "rgba(25,118,210,0.04)" : "rgba(255,255,255,0.04)" },
        }}>
          <CoverImage
            provider={m.provider} workId={m.roomId} title={title}
            authorName={m.authorName} coverPath={null} size="list"
            durationSeconds={m.durationSeconds}
            badge={<Chip label="直播" size="small" color="warning" />}
          />
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5, py: 1.25 }}>
            <Typography sx={{
              fontWeight: 600, fontSize: "0.95rem", overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {title}
            </Typography>
            <MetaRow parts={[
              <AuthorLink key="a" provider={m.provider} authorId={m.authorId}>
                {m.authorName ?? m.authorId ?? "未知"}
              </AuthorLink>,
              providerEl,
            ]} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
            <IconButton size="small" onClick={onPlay} aria-label="播放">
              <PlayArrow fontSize="small" />
            </IconButton>
            {showDelete && onDelete && (
              <Button size="small" color="error" variant="outlined" onClick={onDelete}>
                删除
              </Button>
            )}
          </Box>
        </Box>
      );
    }

    return (
      <Card sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <CoverImage
          provider={m.provider} workId={m.roomId} title={title}
          authorName={m.authorName} coverPath={null} size="card"
          durationSeconds={m.durationSeconds}
          badge={<Chip label="直播" size="small" color="warning" />}
        />
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <CardContent sx={{ flex: 1, py: 1 }}>
            <Typography sx={{
              fontWeight: 600, fontSize: "0.95rem", overflow: "hidden",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.disabled" noWrap>
              {m.authorName ?? m.authorId} · {providerEl}
            </Typography>
          </CardContent>
          <CardActions sx={{ pt: 0, flexWrap: "wrap", gap: 0.5 }}>
            <IconButton size="small" onClick={onPlay} aria-label="播放">
              <PlayArrow fontSize="small" />
            </IconButton>
            {showDelete && onDelete && (
              <Button size="small" color="error" variant="outlined" onClick={onDelete}>
                {isSmall ? "×" : "删除"}
              </Button>
            )}
          </CardActions>
        </Box>
      </Card>
    );
  }

  // VOD
  const w = item.work;
  const providerEl = providerClickable && onProviderClick ? (
    <Box
      component="span"
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onProviderClick(w.provider); }}
      sx={{ cursor: "pointer", color: "text.secondary", "&:hover": { color: "primary.main" } }}
    >
      {providerLabel(w.provider)}
    </Box>
  ) : (
    providerLabel(w.provider)
  );

  const titleEl = titleHref ? (
    <Typography
      component={Link} to={titleHref}
      sx={{
        fontWeight: 600, fontSize: "0.95rem", color: "text.primary",
        textDecoration: "none", "&:hover": { color: "primary.main" },
        overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}
    >
      {w.title}
    </Typography>
  ) : (
    <Typography sx={{
      fontWeight: 600, fontSize: "0.95rem", overflow: "hidden",
      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
    }}>
      {w.title}
    </Typography>
  );

  if (isList) {
    return (
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1, pl: 0, pr: 1, py: 0,
        borderBottom: index < total - 1 ? "1px solid" : "none", borderColor: "divider",
        "&:hover": { bgcolor: isLight ? "rgba(25,118,210,0.04)" : "rgba(255,255,255,0.04)" },
      }}>
        <CoverImage
          provider={w.provider} workId={w.workId} title={w.title}
          authorName={w.authorName} coverPath={w.coverPath} size="list"
          durationSeconds={w.durationSeconds}
        />
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5, py: 1.25 }}>
          {titleEl}
          <MetaRow parts={[
            <AuthorLink key="a" provider={w.provider} authorId={w.authorId}>
              {w.authorName ?? w.authorId ?? "未知作者"}
            </AuthorLink>,
            providerEl,
          ]} />
          {showStatus && statusLabel && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Chip label={statusLabel} size="small" color={statusColor ?? "default"} />
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {playDisabled ? (
            <Typography variant="caption" color="text.disabled">不可播</Typography>
          ) : (
            <IconButton size="small" onClick={onPlay} aria-label="播放">
              <PlayArrow fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Card sx={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <CoverImage
        provider={w.provider} workId={w.workId} title={w.title}
        authorName={w.authorName} coverPath={w.coverPath} size="card"
        durationSeconds={w.durationSeconds}
      />
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <CardContent sx={{ flex: 1, py: 1 }}>
          {titleEl}
          <Typography variant="body2" color="text.disabled" noWrap>
            <AuthorLink provider={w.provider} authorId={w.authorId}>
              {w.authorName ?? w.authorId ?? "未知作者"}
            </AuthorLink>
            {" · "}{providerEl}
          </Typography>
        </CardContent>
        <CardActions sx={{ pt: 0, flexWrap: "wrap", gap: 0.5 }}>
          {showStatus && statusLabel && (
            <Chip label={statusLabel} size="small" color={statusColor ?? "default"} />
          )}
          {playDisabled ? (
            <Typography variant="caption" color="text.disabled">不可播</Typography>
          ) : (
            <IconButton size="small" onClick={onPlay} aria-label="播放">
              <PlayArrow fontSize="small" />
            </IconButton>
          )}
        </CardActions>
      </Box>
    </Card>
  );
}
