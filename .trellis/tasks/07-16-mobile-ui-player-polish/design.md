# Design: Mobile UI and player polish

## Architecture

```text
App
├── PlayerProvider          # single audio element + state + Media Session
│     └── <audio ref hidden>
├── layout (sidebar + content)
│     └── pages call usePlayer().play(...)
└── PlayerBar (fixed)       # custom mini UI when track != null
```

### Boundaries

| Layer | Owns | Does not own |
|-------|------|--------------|
| `PlayerProvider` | src, play state, time, volume, errors, Media Session wiring | routing, work list fetching |
| `PlayerBar` | presentation + seek/volume gestures | URL construction beyond props |
| Pages | build `PlayableTrack`, call `play` / `stop` | raw `<audio controls>` |
| CSS | tokens, mobile layout, player chrome | business logic |

### PlayableTrack (conceptual)

```ts
type PlayableTrack = {
  id: string;                 // stable key e.g. `vod:koekoe:123` / `live:otobanana:room`
  kind: "vod" | "live";
  title: string;
  subtitle?: string;          // author / room
  src: string;                // api.audioUrl | api.liveAudioUrl
  artworkUrl?: string | null; // api.coverUrl for vod when coverPath exists
};
```

### Player API (conceptual)

```ts
type PlayerContextValue = {
  track: PlayableTrack | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
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
  stop: () => void; // close bar + clear media session
};
```

## Data flow

1. User clicks 播放 on Library / Live / Detail.
2. Page maps entity → `PlayableTrack` → `play(track)`.
3. Provider sets `src` on hidden `<audio>`, `load()`, `play()`; status → loading → playing.
4. `timeupdate` / `durationchange` / `ended` / `error` update state.
5. `PlayerBar` reads context; user seek/toggle/stop.
6. Media Session handlers call same `toggle` / `seek`; metadata from `track`.

Same track id re-play: restart from 0 or toggle — **prefer restart play() if already same id and paused/ended; if playing same id, no-op or restart** → choose **if same id + playing: no-op; same id + paused: resume; else replace**.

## UI / CSS

### Player bar layout

- Desktop: `[artwork?] [title+badge] [play] [time] [range] [duration] [volume] [close]`
- Mobile: two rows
  - row1: artwork + title/badge + close
  - row2: play + time + range + duration
- Hide volume on narrow (`max-width: 900px`) or put behind overflow if needed — **hide volume on mobile**.
- Height token: raise `--player-h` if two-row mobile (~112–128px + safe-area).
- Glass: keep `backdrop-filter` + elevated panel; progress accent orange.

### Mobile layout

- Keep 900px breakpoint; refine toolbar:
  - `.toolbar` → `flex-wrap`, full-width search on small screens.
  - filters `min-width: 0; flex: 1 1 auto` where needed.
- Icon buttons: min 44×44 hit area (padding if visual icon smaller).
- Tables: ensure `.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch }`.
- `touch-action: manipulation` on interactive controls.

### Icons

Add: `IconPause`, `IconVolume`, `IconVolumeMute` (and optional `IconSeek` none). Reuse `IconPlay` / `IconClose`.

## Media Session

```ts
if ("mediaSession" in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.subtitle ?? (track.kind === "live" ? "直播录制" : "Erolib"),
    artwork: track.artworkUrl
      ? [{ src: track.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
      : [],
  });
  navigator.mediaSession.setActionHandler("play", ...);
  navigator.mediaSession.setActionHandler("pause", ...);
  navigator.mediaSession.setActionHandler("seekto", (d) => seek(d.seekTime ?? 0));
  // seekbackward / seekforward optional ±10s
  // previoustrack / nexttrack: null or omit
}
```

On `stop` / unmount: clear handlers + metadata if possible.

**Caveat:** cover URLs need cookie credentials — Media Session artwork fetch may fail cross-origin/cookie; treat artwork as best-effort (empty array fallback).

## Compatibility

- Single hidden audio: cookie session for same-origin `/api/.../audio` continues to work.
- Safari iOS: autoplay after user gesture OK (click 播放); Media Session partial.
- No change to Range/audio MIME on server.

## Trade-offs

| Choice | Why | Cost |
|--------|-----|------|
| App-level provider | continuous play + one Media Session | pages must migrate off local audio |
| Hidden native audio + custom UI | reliable decode + Range | custom a11y (role/slider) |
| No queue | MVP scope | prev/next no-op |

## Rollback

- Revert PlayerProvider + bar; restore page-local `<audio controls>` blocks.
- CSS tokens only additive → easy to drop.

## Risks

| Risk | Mitigation |
|------|------------|
| Cover as Media Session artwork 401 | optional artwork; ignore load errors |
| Player height covers list | dynamic `--player-h` / content padding when open |
| Double audio if detail not migrated | remove detail native controls in same change set |
| Seek range thumb too small | large hit slop + custom range styling |
