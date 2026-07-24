import { useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "motion/react";
import {
  IconClose,
  IconMore,
  IconPause,
  IconPlay,
  IconPlaylist,
} from "../Icons";
import { usePlayer } from "../../player/PlayerContext";
import { PlayerArt } from "./PlayerArt";
import { PlayerControls } from "./PlayerControls";
import { PlayerSeek } from "./PlayerSeek";
import { PlayerVolume } from "./PlayerVolume";

type SheetMode = "mini" | "full";

const MINI_H = 72;
const FULL_RATIO = 0.92;

function fullHeight(): number {
  if (typeof window === "undefined") return 640;
  return Math.round(window.innerHeight * FULL_RATIO);
}

/** Positive y shifts the bottom-anchored sheet downward (revealing less). */
function yForMode(mode: SheetMode): number {
  if (mode === "full") return 0;
  return Math.max(0, fullHeight() - MINI_H);
}

export function PlayerSheet() {
  const {
    track,
    status,
    error,
    queue,
    queueIndex,
    toggle,
    stop,
    playFromList,
  } = usePlayer();

  const [mode, setMode] = useState<SheetMode>("mini");
  const [queueOpen, setQueueOpen] = useState(false);
  const [sheetH, setSheetH] = useState(() => fullHeight());
  const y = useMotionValue(yForMode("mini"));
  const radius = useTransform(y, (v) => {
    const max = Math.max(1, sheetH - MINI_H);
    const t = Math.min(1, Math.max(0, v / max));
    return 16 + t * 8;
  });

  useEffect(() => {
    void animate(y, mode === "full" ? 0 : Math.max(0, sheetH - MINI_H), {
      type: "spring",
      stiffness: 380,
      damping: 36,
      mass: 0.8,
    });
  }, [mode, y, sheetH]);

  useEffect(() => {
    function onResize(): void {
      const nextH = fullHeight();
      setSheetH(nextH);
      y.set(mode === "full" ? 0 : Math.max(0, nextH - MINI_H));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode, y]);

  useEffect(() => {
    setQueueOpen(false);
  }, [track?.id]);

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  let statusText: string | null = null;
  if (error || status === "error") {
    statusText = error ?? "无法播放";
  } else if (status === "loading" && mode === "full") {
    statusText = "加载中…";
  }

  function snapTo(next: SheetMode): void {
    setMode(next);
    if (next === "mini") setQueueOpen(false);
  }

  function onDragEnd(_e: unknown, info: PanInfo): void {
    const velocity = info.velocity.y;
    const currentY = y.get();
    const miniY = Math.max(0, sheetH - MINI_H);
    const mid = miniY / 2;

    if (velocity < -500) {
      snapTo("full");
      return;
    }
    if (velocity > 500) {
      snapTo("mini");
      return;
    }
    snapTo(currentY < mid ? "full" : "mini");
  }

  return (
    <>
      {mode === "full" ? (
        <button
          type="button"
          className="player-sheet-backdrop"
          aria-label="收起播放器"
          onClick={() => snapTo("mini")}
        />
      ) : null}

      <motion.div
        className={`player-sheet player-sheet--${mode}`}
        role="region"
        aria-label="播放器"
        style={{
          y,
          height: sheetH,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
        }}
        drag="y"
        dragConstraints={{ top: 0, bottom: Math.max(0, sheetH - MINI_H) }}
        dragElastic={0.08}
        dragMomentum={false}
        onDragEnd={onDragEnd}
      >
        <div className="player-sheet-handle" aria-hidden>
          <span />
        </div>

        <div
          className="player-sheet-mini"
          onClick={() => {
            if (mode === "mini") snapTo("full");
          }}
        >
          <PlayerArt artworkUrl={track.artworkUrl} size="sm" />
          <div className="player-float-text">
            <div className="player-title" title={track.title}>
              {track.title}
            </div>
            {track.subtitle ? (
              <div className="player-subtitle muted small">{track.subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="secondary icon-btn player-toggle"
            aria-label={isPlaying ? "暂停" : "播放"}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            {isPlaying ? (
              <IconPause width={18} height={18} />
            ) : (
              <IconPlay width={18} height={18} />
            )}
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="关闭播放器"
            onClick={(e) => {
              e.stopPropagation();
              stop();
            }}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="player-sheet-body">
          <PlayerArt artworkUrl={track.artworkUrl} size="xl" />

          <div className="player-float-meta player-sheet-meta">
            <div className="player-title" title={track.title}>
              {track.title}
            </div>
            {track.subtitle ? (
              <div className="player-subtitle muted">{track.subtitle}</div>
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

          <PlayerSeek />
          <PlayerControls size="lg" />
          <PlayerVolume />

          <div className="player-sheet-footer">
            <button
              type="button"
              className={`ghost icon-btn ${queueOpen ? "active" : ""}`}
              aria-label="播放列表"
              aria-pressed={queueOpen}
              disabled={queue.length === 0}
              onClick={() => setQueueOpen((v) => !v)}
            >
              <IconPlaylist width={20} height={20} />
            </button>
            <button
              type="button"
              className="ghost icon-btn"
              aria-label="更多"
              disabled
              title="更多选项即将推出"
            >
              <IconMore width={20} height={20} />
            </button>
          </div>

          {queueOpen && queue.length > 0 ? (
            <div className="player-queue" role="list" aria-label="当前播放列表">
              {queue.map((item, i) => {
                const active = i === queueIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="listitem"
                    className={
                      active ? "player-queue-item active" : "player-queue-item"
                    }
                    onClick={() => playFromList(queue, i)}
                  >
                    <PlayerArt artworkUrl={item.artworkUrl} size="sm" />
                    <span className="player-queue-text">
                      <span className="player-title">{item.title}</span>
                      {item.subtitle ? (
                        <span className="muted small">{item.subtitle}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </motion.div>
    </>
  );
}
