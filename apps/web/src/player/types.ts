export type PlayableTrack = {
  /** Stable key, e.g. `vod:koekoe:123` / `live:otobanana:room` */
  id: string;
  kind: "vod" | "live";
  title: string;
  /** Author / room label */
  subtitle?: string;
  /** api.audioUrl | api.liveAudioUrl */
  src: string;
  /** api.coverUrl when cover exists */
  artworkUrl?: string | null;
};

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";
