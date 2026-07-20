import { useEffect, useState } from "react";
import type { ProviderId } from "@erolib/shared";
import { api } from "../api";

const PALETTES = [
  ["#312e81", "#f97316"],
  ["#0f766e", "#a855f7"],
  ["#9f1239", "#f59e0b"],
  ["#1d4ed8", "#22c55e"],
  ["#7c3aed", "#fb7185"],
  ["#0e7490", "#f97316"],
  ["#4c1d95", "#38bdf8"],
  ["#be123c", "#fde68a"],
] as const;

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
  provider: ProviderId | string;
  authorId: string;
  displayName?: string | null;
  hasAvatar: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [provider, authorId, hasAvatar]);
  const showImage = hasAvatar && !imgFailed;
  const seed = hashSeed(`${provider}:${authorId}`);
  const [c0, c1] = PALETTES[seed % PALETTES.length] ?? PALETTES[0];
  const glyph = initialGlyph(displayName, authorId);
  const sizeClass =
    size === "lg"
      ? "author-avatar author-avatar--lg"
      : size === "sm"
        ? "author-avatar author-avatar--sm"
        : "author-avatar";

  return (
    <div
      className={`${sizeClass}${showImage ? " has-image" : " is-placeholder"}`}
      style={
        showImage
          ? undefined
          : {
              background: `linear-gradient(145deg, ${c0}, ${c1}cc), radial-gradient(circle at 28% 22%, rgba(255,255,255,0.18), transparent 52%)`,
            }
      }
      aria-hidden
    >
      {showImage ? (
        <img
          className="author-avatar-img"
          src={api.authorAvatarUrl(provider, authorId)}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="author-avatar-glyph">{glyph}</span>
      )}
    </div>
  );
}
