import type { ProviderId } from "@erolib/shared";

/** Public author page on the upstream site, or null if unknown. */
export function authorSourceUrl(
  provider: ProviderId,
  authorId: string,
): string | null {
  const id = authorId.trim();
  if (!id) return null;

  switch (provider) {
    case "otobanana":
      return `https://otobanana.com/general/user/${encodeURIComponent(id)}`;
    case "koekoe": {
      // Site returns empty results when `word` is a full trip/nan identity.
      const base =
        id
          .replace(/◆_/g, "◆/")
          .replace(/(?:◆[^\s]+|◇ID_\d+)\s*$/u, "")
          .trim() || id;
      const qs = new URLSearchParams({ word: base, m: "1", g: "1" });
      return `https://koe-koe.com/search.php?${qs.toString()}`;
    }
    case "erovoice":
      return `https://erovoice-ch.com/${encodeURIComponent(id)}/`;
    default:
      return null;
  }
}
