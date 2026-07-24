import { useEffect, useState } from "react";
import { usePlayer } from "../../player/PlayerContext";
import { formatTime } from "./formatTime";

type PlayerSeekProps = {
  className?: string;
  showTimes?: boolean;
};

export function PlayerSeek({ className = "", showTimes = true }: PlayerSeekProps) {
  const { currentTime, duration, seek } = usePlayer();

  // Local preview while dragging; commit seek only on release.
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const scrubbing = scrubTime != null;

  useEffect(() => {
    setScrubTime(null);
  }, [duration]);

  const canSeek = Number.isFinite(duration) && duration > 0;
  const max = canSeek ? duration : 0;
  const displayTime = scrubbing
    ? Math.min(scrubTime, max)
    : canSeek
      ? Math.min(currentTime, max)
      : 0;

  function beginScrub(): void {
    if (!canSeek) return;
    setScrubTime(currentTime);
  }

  function previewScrub(time: number): void {
    if (!canSeek) return;
    setScrubTime(time);
  }

  function commitScrub(time: number): void {
    if (!canSeek) {
      setScrubTime(null);
      return;
    }
    setScrubTime(null);
    seek(time);
  }

  return (
    <div className={`player-seek-row ${className}`.trim()}>
      <label className="player-seek-label">
        <span className="sr-only">播放进度</span>
        <input
          className="player-seek"
          type="range"
          min={0}
          max={max || 0}
          step={0.1}
          value={displayTime}
          disabled={!canSeek}
          aria-valuemin={0}
          aria-valuemax={max || 0}
          aria-valuenow={displayTime}
          aria-valuetext={formatTime(displayTime)}
          onPointerDown={beginScrub}
          onMouseDown={beginScrub}
          onTouchStart={beginScrub}
          onChange={(e) => previewScrub(Number(e.target.value))}
          onPointerUp={(e) =>
            commitScrub(Number((e.target as HTMLInputElement).value))
          }
          onMouseUp={(e) =>
            commitScrub(Number((e.target as HTMLInputElement).value))
          }
          onTouchEnd={(e) =>
            commitScrub(Number((e.target as HTMLInputElement).value))
          }
          onPointerCancel={() => setScrubTime(null)}
          onBlur={(e) => {
            if (scrubTime == null) return;
            commitScrub(Number(e.currentTarget.value));
          }}
          onKeyDown={beginScrub}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "Home" ||
              e.key === "End" ||
              e.key === "PageUp" ||
              e.key === "PageDown"
            ) {
              commitScrub(Number((e.target as HTMLInputElement).value));
            }
          }}
        />
      </label>
      {showTimes ? (
        <div className="player-seek-times" aria-hidden>
          <span>{formatTime(displayTime)}</span>
          <span>{canSeek ? formatTime(duration) : "—:—"}</span>
        </div>
      ) : null}
    </div>
  );
}
