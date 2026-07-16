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
  play: (track: PlayableTrack) => void;
  toggle: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  stop: () => void;
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

  const [track, setTrack] = useState<PlayableTrack | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  trackRef.current = track;

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(time)) return;
    const next =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, Math.min(time, audio.duration))
        : Math.max(0, time);
    audio.currentTime = next;
    setCurrentTime(next);
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
    clearMediaSession();
  }, []);

  const play = useCallback((next: PlayableTrack) => {
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
      setStatus("playing");
      setError(null);
      setMediaSessionPlaybackState("playing");
    };
    const onPause = () => {
      // Ignore pause while stopping / no track
      if (!trackRef.current) return;
      if (audio.ended) return;
      setStatus("paused");
      setMediaSessionPlaybackState("paused");
    };
    const onWaiting = () => {
      if (!trackRef.current) return;
      setStatus("loading");
    };
    const onCanPlay = () => {
      if (!trackRef.current) return;
      if (!audio.paused) setStatus("playing");
    };
    const onEnded = () => {
      setStatus("paused");
      setCurrentTime(audio.currentTime);
      setMediaSessionPlaybackState("paused");
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
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
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

  const value = useMemo<PlayerContextValue>(
    () => ({
      track,
      status,
      currentTime,
      duration,
      volume,
      muted,
      error,
      play,
      toggle,
      seek,
      setVolume,
      setMuted,
      stop,
    }),
    [
      track,
      status,
      currentTime,
      duration,
      volume,
      muted,
      error,
      play,
      toggle,
      seek,
      setVolume,
      setMuted,
      stop,
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
