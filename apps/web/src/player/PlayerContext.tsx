import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearMediaSession,
  setMediaSession,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "./mediaSession";
import type { PlayableTrack, PlayerStatus } from "./types";

export type PlayerContextValue = {
  track: PlayableTrack | null;
  status: PlayerStatus;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  error: string | null;
  queue: PlayableTrack[];
  queueIndex: number;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Pass a `queue` to enable next()/previous(); omit for a single-track play (queue = [track]). */
  play: (track: PlayableTrack, queue?: PlayableTrack[]) => void;
  toggle: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  /** Jump to an arbitrary index within the current queue (used by the queue popover). */
  playAt: (index: number) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function audioErrorMessage(audio: HTMLAudioElement): string {
  const err = audio.error;
  if (!err) return "无法播放";
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "播放已中断";
    case MediaError.MEDIA_ERR_NETWORK:
      return "网络错误，无法加载音频";
    case MediaError.MEDIA_ERR_DECODE:
      return "音频解码失败";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "不支持的音频格式或地址";
    default:
      return "无法播放";
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<PlayableTrack | null>(null);
  const seekQuietUntilRef = useRef(0);
  const queueRef = useRef<PlayableTrack[]>([]);
  const queueIndexRef = useRef(-1);

  const [track, setTrack] = useState<PlayableTrack | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<PlayableTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);

  trackRef.current = track;
  queueRef.current = queue;
  queueIndexRef.current = queueIndex;

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(time)) return;
    const next =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, Math.min(time, audio.duration))
        : Math.max(0, time);
    // Drag/seek fires waiting repeatedly; keep quiet until seeked settles.
    seekQuietUntilRef.current = Date.now() + 2500;
    try {
      audio.currentTime = next;
    } catch {
      // Some browsers throw while metadata not ready.
    }
    setCurrentTime(next);
    // Keep playing chrome while scrubbing — do not force "loading".
    if (!audio.paused) {
      setStatus((s) => (s === "error" ? s : "playing"));
    }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !trackRef.current) return;
    if (audio.paused) {
      setError(null);
      setStatus("loading");
      if (audio.ended) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      void audio.play().catch(() => {
        setStatus("error");
        setError("无法播放");
      });
    } else {
      audio.pause();
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setTrack(null);
    trackRef.current = null;
    setStatus("idle");
    setCurrentTime(0);
    setDuration(0);
    setError(null);
    setQueue([]);
    setQueueIndex(-1);
    queueRef.current = [];
    queueIndexRef.current = -1;
    clearMediaSession();
  }, []);

  /** Starts playback of `next`, resuming in place if it's already the loaded track. Does not touch queue state. */
  const startTrack = useCallback((next: PlayableTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    const current = trackRef.current;
    if (current && current.id === next.id) {
      // Same id + playing → no-op; same id + paused → resume; ended → restart
      if (!audio.paused) return;
      setError(null);
      setStatus("loading");
      if (audio.ended) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      void audio.play().catch(() => {
        setStatus("error");
        setError("无法播放");
      });
      return;
    }
    setTrack(next);
    trackRef.current = next;
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setStatus("loading");

    audio.src = next.src;
    audio.load();
    void audio.play().catch(() => {
      setStatus("error");
      setError("无法播放");
    });
  }, []);

  const play = useCallback(
    (next: PlayableTrack, queueArg?: PlayableTrack[]) => {
      const q = queueArg && queueArg.length > 0 ? queueArg : [next];
      const idx = q.findIndex((t) => t.id === next.id);
      const safeIdx = idx >= 0 ? idx : 0;
      setQueue(q);
      setQueueIndex(safeIdx);
      queueRef.current = q;
      queueIndexRef.current = safeIdx;
      startTrack(next);
    },
    [startTrack],
  );

  const playAt = useCallback(
    (index: number) => {
      const q = queueRef.current;
      if (index < 0 || index >= q.length) return;
      const t = q[index]!;
      setQueueIndex(index);
      queueIndexRef.current = index;
      startTrack(t);
    },
    [startTrack],
  );

  const next = useCallback(() => {
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    if (idx < 0 || idx >= q.length - 1) return;
    playAt(idx + 1);
  }, [playAt]);

  const previous = useCallback(() => {
    const idx = queueIndexRef.current;
    if (idx <= 0) return;
    playAt(idx - 1);
  }, [playAt]);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audio) audio.volume = clamped;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    const audio = audioRef.current;
    setMutedState(m);
    if (audio) audio.muted = m;
  }, []);

  // Wire audio element events once
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;
    audio.muted = muted;

    const onTimeUpdate = () => {
      // Avoid fighting the scrubber while the element is mid-seek.
      if (audio.seeking) return;
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => {
      setDuration(
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0,
      );
    };
    const onPlay = () => {
      if (audio.seeking || Date.now() < seekQuietUntilRef.current) {
        // Stay out of loading thrash during seek.
        setError(null);
        setMediaSessionPlaybackState("playing");
        if (!audio.paused) setStatus("playing");
        return;
      }
      setStatus("playing");
      setError(null);
      setMediaSessionPlaybackState("playing");
    };
    const onPause = () => {
      // Ignore pause while stopping / no track
      if (!trackRef.current) return;
      if (audio.ended) return;
      if (audio.seeking || Date.now() < seekQuietUntilRef.current) return;
      setStatus("paused");
      setMediaSessionPlaybackState("paused");
    };
    const onWaiting = () => {
      if (!trackRef.current) return;
      // Seeking / scrub always buffers; never flash "加载中" for that.
      if (audio.seeking) return;
      if (Date.now() < seekQuietUntilRef.current) return;
      setStatus("loading");
    };
    const onSeeking = () => {
      seekQuietUntilRef.current = Date.now() + 2500;
    };
    const onSeeked = () => {
      seekQuietUntilRef.current = 0;
      setCurrentTime(audio.currentTime);
      if (!trackRef.current) return;
      if (audio.paused) {
        if (!audio.ended) setStatus("paused");
      } else {
        setStatus("playing");
        setError(null);
        setMediaSessionPlaybackState("playing");
      }
    };
    const onCanPlay = () => {
      if (!trackRef.current) return;
      if (audio.seeking) return;
      if (!audio.paused) setStatus("playing");
    };
    const onPlaying = () => {
      if (!trackRef.current) return;
      if (audio.seeking) return;
      seekQuietUntilRef.current = 0;
      setStatus("playing");
      setError(null);
      setMediaSessionPlaybackState("playing");
    };
    const onEnded = () => {
      setCurrentTime(audio.currentTime);
      setMediaSessionPlaybackState("paused");

      // Auto-advance to the next queued track, if any.
      const q = queueRef.current;
      const idx = queueIndexRef.current;
      if (idx >= 0 && idx < q.length - 1) {
        const upNext = q[idx + 1]!;
        const nextIdx = idx + 1;
        setQueueIndex(nextIdx);
        queueIndexRef.current = nextIdx;
        startTrack(upNext);
      } else {
        setStatus("paused");
      }
    };
    const onError = () => {
      if (!trackRef.current) return;
      setStatus("error");
      setError(audioErrorMessage(audio));
      setMediaSessionPlaybackState("none");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // volume/muted applied above; event wiring is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only listeners
  }, []);

  // Media Session metadata + handlers when track changes
  useEffect(() => {
    if (!track) {
      clearMediaSession();
      return;
    }

    setMediaSession(track, {
      play: () => {
        const audio = audioRef.current;
        if (!audio) return;
        setError(null);
        setStatus("loading");
        if (audio.ended) {
          audio.currentTime = 0;
          setCurrentTime(0);
        }
        void audio.play().catch(() => {
          setStatus("error");
          setError("无法播放");
        });
      },
      pause: () => {
        audioRef.current?.pause();
      },
      seekTo: (time) => {
        seek(time);
      },
    });

    return () => {
      // Do not clear on every track swap mid-update; stop() clears explicitly.
    };
  }, [track, seek]);

  // Position state for lock screen scrubbing
  useEffect(() => {
    if (!track) return;
    if (status !== "playing" && status !== "paused") return;
    setMediaSessionPositionState(duration, currentTime);
  }, [track, status, duration, currentTime]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMediaSession();
    };
  }, []);

  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;
  const hasPrevious = queueIndex > 0;

  const value = useMemo<PlayerContextValue>(
    () => ({
      track,
      status,
      currentTime,
      duration,
      volume,
      muted,
      error,
      queue,
      queueIndex,
      hasNext,
      hasPrevious,
      play,
      toggle,
      seek,
      setVolume,
      setMuted,
      stop,
      next,
      previous,
      playAt,
    }),
    [
      track,
      status,
      currentTime,
      duration,
      volume,
      muted,
      error,
      queue,
      queueIndex,
      hasNext,
      hasPrevious,
      play,
      toggle,
      seek,
      setVolume,
      setMuted,
      stop,
      next,
      previous,
      playAt,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      {/* Single hidden audio element for the whole app */}
      <audio ref={audioRef} preload="metadata" style={{ display: "none" }} />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer must be used within PlayerProvider");
  }
  return ctx;
}
