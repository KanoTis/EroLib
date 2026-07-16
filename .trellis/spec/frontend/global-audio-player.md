# Global Audio Player

Executable contract for app-wide audio playback in `apps/web`.

## 1. Scope / Trigger

- Any page that plays VOD or live audio must use the global player.
- Trigger when adding play buttons, Media Session behavior, or bottom-bar chrome.

## 2. Signatures

```ts
// apps/web/src/player/types.ts
type PlayableTrack = {
  id: string; // `vod:{provider}:{workId}` | `live:{provider}:{roomId}`
  kind: "vod" | "live";
  title: string;
  subtitle?: string;
  src: string; // api.audioUrl | api.liveAudioUrl
  artworkUrl?: string | null; // api.coverUrl when cover exists
};

// apps/web/src/player/PlayerContext.tsx
function PlayerProvider(props: { children: ReactNode }): JSX.Element;
function usePlayer(): {
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
  stop: () => void;
};
```

## 3. Contracts

| Concern | Rule |
|---------|------|
| Shell | `PlayerProvider` wraps authenticated app; single hidden `<audio>` |
| UI | `PlayerBar` rendered once in shell; visible when `track != null` |
| Continuity | Route changes must not unmount provider or stop audio |
| Media Session | Best-effort metadata + `play` / `pause` / `seekto`; clear on `stop` / unmount |
| Artwork | Optional; empty array / omit when missing; cookie failures must not crash |
| Layout | `layout--player-open` adds content bottom padding (`--player-h` / mobile token + safe-area) |

### Same-track policy

| Current | Action |
|---------|--------|
| same id + playing | no-op |
| same id + paused | resume |
| same id + ended | seek 0 then play |
| different id | replace `src` and play |

## 4. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| play() before audio ref ready | no-op |
| `audio.play()` rejects | `status=error`, user-visible error string |
| media decode / network error | `status=error` via `audio.error` mapping |
| duration unknown / non-finite | seek control disabled; show `—:—` |
| Media Session unsupported | no throw; local controls still work |

## 5. Good / Base / Bad

- **Good**: Library play → open detail → audio continues; detail shows「正在播放」.
- **Base**: No track → no `PlayerBar`; content padding uses non-player baseline.
- **Bad**: Page-local `<audio controls>` beside global player (double audio / Media Session fights).

## 6. Tests Required

- Manual: 375px library play/close; route change continuous play; Live + Detail entries.
- Typecheck: `pnpm --filter @erolib/web typecheck`.
- Optional unit later: same-id policy pure helpers if extracted.

## 7. Wrong vs Correct

#### Wrong
```tsx
// Page-owned player — breaks cross-route playback
const [src, setSrc] = useState<string | null>(null);
return src ? <audio controls autoPlay src={src} /> : null;
```

#### Correct
```tsx
const { play } = usePlayer();
play({
  id: `vod:${provider}:${workId}`,
  kind: "vod",
  title,
  src: api.audioUrl(provider, workId),
  artworkUrl: coverPath ? api.coverUrl(provider, workId) : null,
});
```

## Design Decisions

- **App-level single instance**: required for Media Session + continuous play.
- **Custom UI over native controls**: consistent dark chrome; native element stays hidden for decode/Range.
- **Hamburger nav kept**: bottom Tab not combined with player bar in this product phase.
