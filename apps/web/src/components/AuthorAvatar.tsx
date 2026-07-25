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

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initialGlyph(name: string | null | undefined, authorId: string): string {
  const source = (name || authorId || "?").trim();
  if (!source) return "?";
  const m = source.match(/[\p{L}\p{N}]/u);
  return (m?.[0] ?? source[0] ?? "?").toUpperCase();
}

export function AuthorAvatar({
  provider,
  authorId,
  displayName,
  hasAvatar,
  size = "md",
}: {
  provider: string;
  authorId: string;
  displayName?: string | null;
  hasAvatar: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const { mode } = useThemeMode();
  const isLight = mode === "light";
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [provider, authorId, hasAvatar]);

  const showImage = hasAvatar && !imgFailed;
  const seed = hashSeed(`${provider}:${authorId}`);
  const palette = PALETTES[seed % PALETTES.length]!;
  const [c0, c1] = palette;
  const glyph = initialGlyph(displayName, authorId);

  const px = size === "lg" ? 112 : size === "sm" ? 40 : 72;
  const fontSize = size === "lg" ? "2.5rem" : size === "sm" ? "1rem" : "1.75rem";

  return (
    <Box
      sx={{
        width: px, height: px, borderRadius: "50%", border: "1px solid", borderColor: "divider",
        overflow: "hidden", display: "grid", placeItems: "center", flexShrink: 0,
        background: showImage ? (isLight ? "#F4F4F0" : "#0b0b18") : c0,
      }}
      aria-hidden
    >
      {showImage ? (
        <Box component="img" src={api.authorAvatarUrl(provider, authorId)} alt="" loading="lazy"
          onError={() => setImgFailed(true)} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Typography sx={{ fontSize, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "rgba(248,250,252,0.95)" }}>
          {glyph}
        </Typography>
      )}
    </Box>
  );
}
