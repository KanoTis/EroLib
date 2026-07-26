import { useEffect, useRef, useState } from "react";
import { Box, Card, CardActionArea, Chip, Typography } from "@mui/material";
import { CoverImage } from "./CoverImage";
import { formatPublishedAt, providerLabel } from "./LibraryMeta";

const CARD_WIDTH = 164;
const SPEED_PX_PER_SEC = 34;
const EDGE_FADE =
  "linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)";

export interface RecentRailItem {
  key: string;
  kind: "vod" | "live";
  provider: string;
  mediaId: string;
  title: string;
  authorName: string | null;
  coverPath: string | null;
  publishedAt: string | null;
  onPlay: () => void;
}

function RecentCard({ item }: { item: RecentRailItem }) {
  return (
    <Card sx={{ width: CARD_WIDTH, flexShrink: 0, overflow: "hidden" }}>
      <CardActionArea onClick={item.onPlay} sx={{ display: "block" }}>
        <CoverImage
          provider={item.provider}
          workId={item.mediaId}
          title={item.title}
          authorName={item.authorName}
          coverPath={item.coverPath}
          size="card"
          badge={item.kind === "live" ? <Chip label="直播" size="small" color="warning" /> : undefined}
        />
        <Box sx={{ px: 1, py: 0.75 }}>
          <Typography noWrap sx={{ fontSize: "0.8125rem", fontWeight: 600 }}>
            {item.title}
          </Typography>
          <Typography noWrap sx={{ fontSize: "0.7rem", color: "text.disabled" }}>
            {item.authorName ?? "未知作者"} · {providerLabel(item.provider)}
          </Typography>
          <Typography noWrap sx={{ fontSize: "0.68rem", color: "text.disabled", opacity: 0.75 }}>
            {formatPublishedAt(item.publishedAt)}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}

/** Auto-scrolling "recently added" strip; loops seamlessly and pauses while hovered/focused. */
export function RecentlyAddedRail({ items, days = 0 }: { items: RecentRailItem[]; days?: number }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoop, setShouldLoop] = useState(false);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    const outer = outerRef.current;
    const group = groupRef.current;
    if (!outer || !group) return;

    const measure = () => {
      const over = group.scrollWidth > outer.clientWidth + 1;
      setShouldLoop(over);
      if (over) setDuration(Math.max(14, group.scrollWidth / SPEED_PX_PER_SEC));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(group);
    return () => ro.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        最近入库{days > 0 ? ` · 近 ${days} 天` : ""} · {items.length}
      </Typography>
      <Box
        ref={outerRef}
        sx={{
          overflow: "hidden",
          ...(shouldLoop && { WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }),
        }}
      >
        <Box
          sx={{
            display: "flex",
            width: "max-content",
            ...(shouldLoop && {
              animation: `erolib-recent-flow ${duration}s linear infinite`,
              "&:hover, &:focus-within": { animationPlayState: "paused" },
            }),
            "@keyframes erolib-recent-flow": {
              "0%": { transform: "translateX(0)" },
              "100%": { transform: "translateX(-50%)" },
            },
          }}
        >
          <Box ref={groupRef} sx={{ display: "flex", gap: 2, pr: shouldLoop ? 2 : 0 }}>
            {items.map((item) => (
              <RecentCard key={item.key} item={item} />
            ))}
          </Box>
          {shouldLoop && (
            <Box aria-hidden sx={{ display: "flex", gap: 2, pr: 2 }}>
              {items.map((item) => (
                <RecentCard key={`${item.key}-dup`} item={item} />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
