import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { api } from "../api";
import { useThemeMode } from "../ThemeContext";

const PALETTES: [string, string][] = [
  ["#312e81", "#f97316"],
  ["#0f766e", "#a855f7"],
  ["#9f1239", "#f59e0b"],
  ["#1d4ed8", "#22c55e"],
  ["#7c3aed", "#fb7185"],
  ["#0e7490", "#f97316"],
  ["#4c1d95", "#38bdf8"],
  ["#be123c", "#fde68a"],
];

const PROVIDER_SHORT: Record<string, string> = {
  otobanana: "OTB",
  koekoe: "KOE",
  erovoice: "ERO",
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initialGlyph(title: string, authorName: string | null): string {
  const source = (title || authorName || "?").trim();
  if (!source) return "?";
  const m = source.match(/[\p{L}\p{N}]/u);
  return (m?.[0] ?? source[0] ?? "?").toUpperCase();
}

export function CoverImage({
  provider,
  workId,
  title,
  authorName,
  coverPath,
  size = "card",
  badge,
  showProviderBadge = true,
}: {
  provider: string;
  workId: string;
  title: string;
  authorName?: string | null;
  coverPath?: string | null;
  /** Named presets, or pixel size for compact player thumbs */
  size?: "card" | "detail" | "list" | number;
  badge?: React.ReactNode;
  showProviderBadge?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const showImage = Boolean(coverPath) && !imgFailed;
  const seed = hashSeed(`${provider}:${workId}:${title}`);
  const palette = PALETTES[seed % PALETTES.length]!;
  const [c0, c1] = palette;
  const glyph = initialGlyph(title, authorName ?? null);
  const shortLabel = PROVIDER_SHORT[provider] ?? provider.slice(0, 3).toUpperCase();
  const isPx = typeof size === "number";

  useEffect(() => {
    setImgFailed(false);
  }, [provider, workId, coverPath]);

  const dims =
    isPx ? size
    : size === "detail" ? 180
    : size === "list" ? 96
    : undefined;

  const glyphFontSize =
    isPx ? (size <= 48 ? "1rem" : size <= 96 ? "1.5rem" : "3.5rem")
    : size === "detail" ? "3rem"
    : size === "list" ? "1.35rem"
    : "clamp(1.8rem, 6vw, 2.6rem)";

  const providerFontSize =
    isPx ? (size <= 48 ? "0.45rem" : "0.55rem")
    : size === "detail" ? "0.68rem"
    : size === "list" ? "0.55rem"
    : "0.68rem";

  const compact = isPx && size <= 72;

  return (
    <Box
      sx={{
        position: "relative",
        aspectRatio: "1 / 1",
        width: dims ?? "100%",
        height: dims ?? "auto",
        minWidth: dims,
        minHeight: dims,
        maxWidth: dims,
        maxHeight: dims,
        alignSelf: size === "list" || isPx ? "center" : "stretch",
        flexShrink: 0,
        borderRadius: 0,
        overflow: "hidden",
        background: showImage
          ? (isLight ? "#eeeeee" : "#0a0a0a")
          : c0,
        border: size === "list" || isPx ? undefined : isLight ? "1px solid #e0e0e0" : "1px solid rgba(255,255,255,0.08)",
        display: "grid",
        placeItems: "center",
      }}
      aria-hidden
    >
      {badge && (
        <Box sx={{ position: "absolute", top: 8, left: 8, zIndex: 1 }}>
          {badge}
        </Box>
      )}
      {showImage ? (
        <Box
          component="img"
          src={api.coverUrl(provider, workId)}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            display: "block",
          }}
        />
      ) : (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            px: 1,
            textAlign: "center",
            color: "rgba(248,250,252,0.92)",
            // Fill square so placeholder has no empty bands
            position: "absolute",
            inset: 0,
            background: `linear-gradient(145deg, ${c0}, ${c1})`,
          }}
        >
          <Typography
            sx={{
              fontSize: glyphFontSize,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              textShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            {glyph}
          </Typography>
          {showProviderBadge && !compact && (
            <Typography
              sx={{
                fontSize: providerFontSize,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.82,
                px: 0.6,
                py: 0.25,
                borderRadius: 999,
                bgcolor: isLight ? "rgba(0,0,0,0.05)" : "rgba(15,15,35,0.28)",
                border: isLight ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {shortLabel}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
