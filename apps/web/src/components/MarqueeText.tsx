import { useEffect, useRef, useState } from "react";
import { Box, type SxProps, type Theme } from "@mui/material";

/** Single-line text that auto-scrolls when it overflows its container; static ellipsis otherwise. */
export function MarqueeText({
  children,
  sx,
  gap = 48,
  speedPxPerSec = 40,
}: {
  children: string;
  sx?: SxProps<Theme>;
  gap?: number;
  speedPxPerSec?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [duration, setDuration] = useState(10);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const measure = () => {
      const over = text.scrollWidth > container.clientWidth + 1;
      setOverflowing(over);
      if (over) {
        setDuration(Math.max(4, (text.scrollWidth + gap) / speedPxPerSec));
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(text);
    return () => ro.disconnect();
  }, [children, gap, speedPxPerSec]);

  return (
    <Box ref={containerRef} sx={{ overflow: "hidden", whiteSpace: "nowrap", width: "100%", ...sx }}>
      <Box
        sx={{
          display: "inline-flex",
          width: "max-content",
          ...(overflowing && {
            animation: `erolib-marquee ${duration}s linear infinite`,
            "&:hover": { animationPlayState: "paused" },
          }),
          "@keyframes erolib-marquee": {
            "0%": { transform: "translateX(0)" },
            "100%": { transform: "translateX(-50%)" },
          },
        }}
      >
        <Box component="span" ref={textRef} sx={{ pr: overflowing ? `${gap}px` : 0 }}>
          {children}
        </Box>
        {overflowing && (
          <Box component="span" aria-hidden sx={{ pr: `${gap}px` }}>
            {children}
          </Box>
        )}
      </Box>
    </Box>
  );
}
