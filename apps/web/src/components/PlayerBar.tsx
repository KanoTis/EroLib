import { useEffect, useState } from "react";
import {
  IconClose,
  IconPause,
  IconPlay,
  IconVolume,
  IconVolumeMute,
} from "./Icons";
import { usePlayer } from "../player/PlayerContext";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerBar() {
  const {
    track,
    status,
    currentTime,
    duration,
    volume,
    muted,
    error,
    toggle,
    seek,
    setVolume,
    setMuted,
    stop,
  } = usePlayer();

  // Local preview while dragging; commit seek only on release.
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const scrubbing = scrubTime != null;

  useEffect(() => {
    setScrubTime(null);
  }, [track?.id]);

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  const canSeek = Number.isFinite(duration) && duration > 0;
  const max = canSeek ? duration : 0;
  const displayTime = scrubbing
    ? Math.min(scrubTime, max)
    : canSeek
      ? Math.min(currentTime, max)
      : 0;

  let statusText: string | null = null;
  if (error || status === "error") {
    statusText = error ?? "无法播放";
  } else if (status === "loading" && !scrubbing) {
    // Never flash loading while the user is dragging the seek bar.
    statusText = "加载中…";
  }

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
    <div className="player" role="region" aria-label="播放器">
      <div className="player-main">
        <div className="player-meta">
          {track.artworkUrl ? (
            <img
              className="player-art"
              src={track.artworkUrl}
              alt=""
              width={48}
              height={48}
              decoding="async"
            />
          ) : (
            <div className="player-art player-art--empty" aria-hidden />
          )}
          <div className="player-text">
            <div className="player-title-row">
              <div className="player-title" title={track.title}>
                {track.title}
              </div>
              {track.kind === "live" ? (
                <span className="badge queued player-live-badge">直播</span>
              ) : null}
            </div>
            {track.subtitle ? (
              <div className="player-subtitle muted small">{track.subtitle}</div>
            ) : null}
            {statusText ? (
              <div
                className={
                  status === "error" || error
                    ? "player-status error small"
                    : "player-status muted small"
                }
                role="status"
              >
                {statusText}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ghost icon-btn player-close"
            aria-label="关闭播放器"
            onClick={() => stop()}
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        <div className="player-controls">
          <button
            type="button"
            className="secondary icon-btn player-toggle"
            aria-label={isPlaying ? "暂停" : "播放"}
            onClick={() => toggle()}
          >
            {isPlaying ? (
              <IconPause width={18} height={18} />
            ) : (
              <IconPlay width={18} height={18} />
            )}
          </button>

          <span className="player-time" aria-hidden>
            {formatTime(displayTime)}
          </span>

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

          <span className="player-time player-time--end" aria-hidden>
            {canSeek ? formatTime(duration) : "—:—"}
          </span>

          <div className="player-volume">
            <button
              type="button"
              className="ghost icon-btn"
              aria-label={muted || volume === 0 ? "取消静音" : "静音"}
              onClick={() => setMuted(!(muted || volume === 0))}
            >
              {muted || volume === 0 ? (
                <IconVolumeMute width={18} height={18} />
              ) : (
                <IconVolume width={18} height={18} />
              )}
            </button>
            <label className="player-volume-label">
              <span className="sr-only">音量</span>
              <input
                className="player-volume-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={muted || volume === 0 ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (v > 0 && muted) setMuted(false);
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
