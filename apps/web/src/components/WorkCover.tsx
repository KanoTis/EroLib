import { useState, type ReactNode } from "react";
import type { ProviderId } from "@erolib/shared";
import { api } from "../api";

const PROVIDER_LABEL: Record<ProviderId, string> = {
  otobanana: "OTB",
  koekoe: "KOE",
  erovoice: "ERO",
};

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

function initialGlyph(title: string, authorName: string | null): string {
  const source = (title || authorName || "?").trim();
  if (!source) return "?";
  const m = source.match(/[\p{L}\p{N}]/u);
  return (m?.[0] ?? source[0] ?? "?").toUpperCase();
}

export function WorkCover({
  provider,
  workId,
  title,
  authorName,
  coverPath,
  size = "card",
  badge,
}: {
  provider: ProviderId | string;
  workId: string;
  title: string;
  authorName?: string | null;
  coverPath?: string | null;
  size?: "card" | "detail" | "list";
  badge?: ReactNode;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(coverPath) && !imgFailed;
  const seed = hashSeed(`${provider}:${workId}:${title}`);
  const [c0, c1] = PALETTES[seed % PALETTES.length] ?? PALETTES[0];
  const glyph = initialGlyph(title, authorName ?? null);
  const providerKey = (
    provider in PROVIDER_LABEL ? provider : "koekoe"
  ) as ProviderId;
  const providerShort = PROVIDER_LABEL[providerKey];
  const className =
    size === "detail"
      ? "detail-cover"
      : size === "list"
        ? "work-cover work-cover--list"
        : "work-cover";

  return (
    <div
      className={`${className}${showImage ? " has-image" : " is-placeholder"}`}
      style={
        showImage
          ? undefined
          : {
              background: `linear-gradient(145deg, ${c0}, ${c1}cc), radial-gradient(circle at 28% 22%, rgba(255,255,255,0.18), transparent 52%)`,
            }
      }
      aria-hidden
    >
      {badge ? <span className="work-cover-badge">{badge}</span> : null}
      {showImage ? (
        <img
          className="work-cover-img"
          src={api.coverUrl(provider, workId)}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="work-cover-placeholder">
          <span className="work-cover-glyph">{glyph}</span>
          <span className="work-cover-provider">{providerShort}</span>
        </div>
      )}
    </div>
  );
}
