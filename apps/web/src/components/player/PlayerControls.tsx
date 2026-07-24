import {
  IconForward,
  IconPause,
  IconPlay,
  IconRewind,
  IconSkipNext,
  IconSkipPrev,
} from "../Icons";
import { usePlayer } from "../../player/PlayerContext";

type PlayerControlsProps = {
  className?: string;
  showSkip?: boolean;
  showSeekButtons?: boolean;
  size?: "sm" | "md" | "lg";
};

export function PlayerControls({
  className = "",
  showSkip = true,
  showSeekButtons = true,
  size = "md",
}: PlayerControlsProps) {
  const {
    status,
    currentTime,
    duration,
    hasPrev,
    hasNext,
    toggle,
    prev,
    next,
    seek,
  } = usePlayer();

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const iconSize = size === "lg" ? 28 : size === "sm" ? 16 : 20;
  const playSize = size === "lg" ? 36 : size === "sm" ? 18 : 24;

  function seekBy(delta: number): void {
    if (!canSeek) return;
    seek(Math.max(0, Math.min(duration, currentTime + delta)));
  }

  return (
    <div
      className={`player-controls player-controls--${size} ${className}`.trim()}
    >
      {showSkip ? (
        <button
          type="button"
          className="ghost icon-btn"
          aria-label="上一曲"
          disabled={!hasPrev}
          onClick={() => prev()}
        >
          <IconSkipPrev width={iconSize} height={iconSize} />
        </button>
      ) : null}

      {showSeekButtons ? (
        <button
          type="button"
          className="ghost icon-btn"
          aria-label="快退 5 秒"
          disabled={!canSeek}
          onClick={() => seekBy(-5)}
        >
          <IconRewind width={iconSize} height={iconSize} />
        </button>
      ) : null}

      <button
        type="button"
        className="secondary icon-btn player-toggle"
        aria-label={isPlaying ? "暂停" : "播放"}
        onClick={() => toggle()}
      >
        {isPlaying ? (
          <IconPause width={playSize} height={playSize} />
        ) : (
          <IconPlay width={playSize} height={playSize} />
        )}
      </button>

      {showSeekButtons ? (
        <button
          type="button"
          className="ghost icon-btn"
          aria-label="快进 30 秒"
          disabled={!canSeek}
          onClick={() => seekBy(30)}
        >
          <IconForward width={iconSize} height={iconSize} />
        </button>
      ) : null}

      {showSkip ? (
        <button
          type="button"
          className="ghost icon-btn"
          aria-label="下一曲"
          disabled={!hasNext}
          onClick={() => next()}
        >
          <IconSkipNext width={iconSize} height={iconSize} />
        </button>
      ) : null}
    </div>
  );
}
