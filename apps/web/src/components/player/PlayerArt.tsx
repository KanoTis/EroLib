type PlayerArtProps = {
  artworkUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const SIZE_CLASS: Record<NonNullable<PlayerArtProps["size"]>, string> = {
  sm: "player-art player-art--sm",
  md: "player-art player-art--md",
  lg: "player-art player-art--lg",
  xl: "player-art player-art--xl",
};

export function PlayerArt({
  artworkUrl,
  size = "md",
  className = "",
}: PlayerArtProps) {
  const cls = `${SIZE_CLASS[size]} ${className}`.trim();
  if (artworkUrl) {
    return (
      <img
        className={cls}
        src={artworkUrl}
        alt=""
        decoding="async"
        draggable={false}
      />
    );
  }
  return <div className={`${cls} player-art--empty`} aria-hidden />;
}
