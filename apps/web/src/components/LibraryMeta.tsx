import type { ReactNode } from "react";
import { Box } from "@mui/material";
import type { LiveMediaPublic, WorkPublic } from "@erolib/shared";
import { api } from "../api";
import type { PlayableTrack } from "../player/types";

export const PROVIDER_LABEL: Record<string, string> = {
  otobanana: "Otobanana",
  koekoe: "Koe-koe",
  erovoice: "Erovoice",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

export function workToTrack(w: WorkPublic): PlayableTrack {
  return {
    id: `vod:${w.provider}:${w.workId}`,
    kind: "vod",
    provider: w.provider,
    mediaId: w.workId,
    title: w.title,
    subtitle: w.authorName ?? w.authorId ?? undefined,
    src: api.audioUrl(w.provider, w.workId),
    artworkUrl: w.coverPath ? api.coverUrl(w.provider, w.workId) : null,
  };
}

export function liveToTrack(m: LiveMediaPublic, title: string): PlayableTrack {
  return {
    id: `live:${m.provider}:${m.roomId}`,
    kind: "live",
    provider: m.provider,
    mediaId: m.roomId,
    title,
    subtitle: m.authorName ?? m.authorId ?? undefined,
    src: api.liveAudioUrl(m.provider, m.roomId),
    artworkUrl: null,
  };
}

export function formatDuration(seconds: number | null | undefined, fallback = "—"): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return fallback;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * WorkPublic.publishedAt may be a source-site relative label (e.g. `9時間前`) kept
 * as-is, or an absolute date sliced to `YYYY-MM-DD`; LiveMediaPublic.recordedAt is
 * always a real ISO datetime, which this also slices down to a plain date.
 */
export function formatPublishedAt(value: string | null): string {
  if (!value) return "—";
  return value.startsWith("20") ? value.slice(0, 10) : value;
}

/**
 * Same source data as {@link formatPublishedAt}, resolved to a millisecond timestamp
 * for day-range filtering. A relative source label (unparseable, no absolute date)
 * can't be aged precisely, so it's treated as "now" — sites only show those for
 * genuinely recent items. Returns null when there's nothing to go on (unknown date).
 */
export function publishTimestamp(value: string | null): number | null {
  if (!value) return null;
  if (!value.startsWith("20")) return Date.now();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** asmr.one-style meta: value / value / value */
export function MetaRow({ parts }: { parts: ReactNode[] }) {
  const items = parts.filter((p) => p != null && p !== false && p !== "");
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: 1,
        rowGap: 0.25,
        color: "text.secondary",
        fontSize: "0.8125rem",
        lineHeight: 1.4,
        minWidth: 0,
      }}
    >
      {items.map((part, i) => (
        <Box key={i} component="span" sx={{ display: "contents" }}>
          {i > 0 && (
            <Box component="span" sx={{ opacity: 0.55, flexShrink: 0 }}>/</Box>
          )}
          <Box
            component="span"
            sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {part}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
