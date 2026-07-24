import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import {
  IconClose,
  IconCollapse,
  IconExpand,
  IconPause,
  IconPlay,
} from "../Icons";
import { usePlayer } from "../../player/PlayerContext";
import { PlayerArt } from "./PlayerArt";
import { PlayerControls } from "./PlayerControls";
import { PlayerSeek } from "./PlayerSeek";
import { PlayerVolume } from "./PlayerVolume";

const STORAGE_KEY = "erolib.player.floating";
const CARD_W = 320;
const CARD_H = 440;

type StoredLayout = {
  x: number;
  y: number;
  expanded: boolean;
};

function defaultPos(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return {
    x: Math.max(16, window.innerWidth - CARD_W - 24),
    y: Math.max(16, window.innerHeight - CARD_H - 24),
  };
}

function readStored(): StoredLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.expanded !== "boolean"
    ) {
      return null;
    }
    return { x: parsed.x, y: parsed.y, expanded: parsed.expanded };
  } catch {
    return null;
  }
}

function writeStored(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private mode
  }
}

function clampPos(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - CARD_W);
  const maxY = Math.max(0, window.innerHeight - CARD_H);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

export function FloatingPlayerCard() {
  const { track, status, error, toggle, stop } = usePlayer();

  const stored = useRef(readStored());
  const init = stored.current ?? { ...defaultPos(), expanded: true };

  const [expanded, setExpanded] = useState(init.expanded);
  const posRef = useRef(clampPos(init.x, init.y));
  const x = useMotionValue(posRef.current.x);
  const y = useMotionValue(posRef.current.y);
  const dragControls = useDragControls();
  const constraintsRef = useRef<HTMLDivElement | null>(null);

  const persist = useCallback((next: Partial<StoredLayout>) => {
    const layout: StoredLayout = {
      x: next.x ?? posRef.current.x,
      y: next.y ?? posRef.current.y,
      expanded: next.expanded ?? expanded,
    };
    if (typeof next.x === "number") posRef.current.x = next.x;
    if (typeof next.y === "number") posRef.current.y = next.y;
    writeStored(layout);
  }, [expanded]);

  useEffect(() => {
    function onResize(): void {
      const next = clampPos(x.get(), y.get());
      x.set(next.x);
      y.set(next.y);
      posRef.current = next;
      persist({ x: next.x, y: next.y });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [x, y, persist]);

  if (!track) return null;

  const isPlaying = status === "playing" || status === "loading";
  let statusText: string | null = null;
  if (error || status === "error") {
    statusText = error ?? "无法播放";
  } else if (status === "loading") {
    statusText = "加载中…";
  }

  function onDragEnd(): void {
    const next = clampPos(x.get(), y.get());
    x.set(next.x);
    y.set(next.y);
    posRef.current = next;
    persist({ x: next.x, y: next.y });
  }

  function toggleExpanded(): void {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    persist({ expanded: nextExpanded });
  }

  // Collapsed: full-width bottom bar (screenshot 2)
  if (!expanded) {
    return (
      <div className="player-dock" role="region" aria-label="播放器">
        <PlayerArt artworkUrl={track.artworkUrl} size="sm" />
        <div className="player-float-text">
          <div className="player-title" title={track.title}>
            {track.title}
          </div>
          {track.subtitle ? (
            <div className="player-subtitle muted small">{track.subtitle}</div>
          ) : null}
        </div>
        <div className="player-dock-controls">
          <PlayerControls
            size="sm"
            showSeekButtons={false}
            className="player-dock-transport"
          />
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="展开播放器"
            onClick={toggleExpanded}
          >
            <IconExpand width={16} height={16} />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="关闭播放器"
            onClick={() => stop()}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={constraintsRef} className="player-float-bounds" aria-hidden />
      <motion.div
        className="player-float player-float--card"
        role="region"
        aria-label="播放器"
        style={{ x, y, width: CARD_W }}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragConstraints={constraintsRef}
        dragElastic={0.12}
        onDragEnd={(_e: unknown, _info: PanInfo) => onDragEnd()}
      >
        <div
          className="player-float-handle"
          onPointerDown={(e) => dragControls.start(e)}
        />
        <div className="player-float-toolbar">
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="收起播放器"
            onClick={toggleExpanded}
          >
            <IconCollapse width={16} height={16} />
          </button>
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="关闭播放器"
            onClick={() => stop()}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        <PlayerArt artworkUrl={track.artworkUrl} size="lg" />

        <div className="player-float-meta">
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

        <PlayerSeek />
        <PlayerControls size="md" />
        <PlayerVolume />

        {/* Keep play affordance reachable while dragging metadata */}
        <button
          type="button"
          className="sr-only"
          aria-label={isPlaying ? "暂停" : "播放"}
          onClick={() => toggle()}
        >
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
      </motion.div>
    </>
  );
}
