import type { PlayableTrack } from "./types";

type MediaSessionHandlers = {
  play: () => void;
  pause: () => void;
  seekTo: (time: number) => void;
  prev?: () => void;
  next?: () => void;
};

function supportsMediaSession(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/** Best-effort Media Session metadata + action handlers. Safe when unsupported. */
export function setMediaSession(
  track: PlayableTrack,
  handlers: MediaSessionHandlers,
): void {
  if (!supportsMediaSession()) return;

  try {
    const artwork =
      track.artworkUrl != null && track.artworkUrl !== ""
        ? [{ src: track.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
        : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist:
        track.subtitle ?? (track.kind === "live" ? "直播录制" : "Erolib"),
      artwork,
    });
  } catch {
    // Artwork or MediaMetadata may fail (cross-origin / cookie / unsupported).
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist:
          track.subtitle ?? (track.kind === "live" ? "直播录制" : "Erolib"),
        artwork: [],
      });
    } catch {
      // ignore
    }
  }

  try {
    navigator.mediaSession.setActionHandler("play", () => {
      handlers.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      handlers.pause();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null && Number.isFinite(details.seekTime)) {
        handlers.seekTo(details.seekTime);
      }
    });
    navigator.mediaSession.setActionHandler(
      "previoustrack",
      handlers.prev
        ? () => {
            handlers.prev?.();
          }
        : null,
    );
    navigator.mediaSession.setActionHandler(
      "nexttrack",
      handlers.next
        ? () => {
            handlers.next?.();
          }
        : null,
    );
  } catch {
    // Some browsers reject certain action handlers.
  }
}

export function clearMediaSession(): void {
  if (!supportsMediaSession()) return;

  try {
    navigator.mediaSession.metadata = null;
  } catch {
    // ignore
  }

  for (const action of [
    "play",
    "pause",
    "seekto",
    "seekbackward",
    "seekforward",
    "previoustrack",
    "nexttrack",
  ] as MediaSessionAction[]) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // ignore unsupported actions
    }
  }
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
): void {
  if (!supportsMediaSession()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}

export function setMediaSessionPositionState(
  duration: number,
  position: number,
  playbackRate = 1,
): void {
  if (!supportsMediaSession()) return;
  if (
    !("setPositionState" in navigator.mediaSession) ||
    typeof navigator.mediaSession.setPositionState !== "function"
  ) {
    return;
  }
  if (!Number.isFinite(duration) || duration <= 0) return;
  const safePos = Math.max(0, Math.min(position, duration));
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate,
      position: safePos,
    });
  } catch {
    // ignore invalid position state
  }
}
