# Otobanana: Past Live Media Availability

Date: 2026-07-16  
Question: Can we fetch **audio content of past livestreams** when the official UI has no archive player?

## Short answer

**No public/recoverable media URL found for ended livestreams.**  
We can list **metadata** of past sessions, but not re-download the audio after the room closes.

## What exists after a live ends

### Metadata list (works)

```http
GET /api/users/{userId}/livestreams?is_adult=false|true
```

Closed session example fields:

- `room_id`, `post_ptr_id`, `stream_service` (`realtime`)
- `room_open_at`, `room_close_at`
- `is_open: false`
- `listener_count`, title via `post.title`
- `room_url: ""` (empty)
- **No** `audio_url` / `playback_url` / `m3u8` / archive fields

### Not a Cast VOD

- Live posts use `post.type = 3`
- Same author `/api/users/{id}/casts` returned **empty** while livestream history had 10 items
- `GET /api/casts/{post_ptr_id}` → model not found  
  ⇒ livestream post is **not** converted into a downloadable cast with `audio_url`

## Endpoint probes (anonymous, ended room)

Tried against `post_ptr_id`, `room_id` parts, `realtime_session_id`:

| Path pattern | Result |
|--------------|--------|
| `/api/livestreams/{id}` | 500 internal |
| `/api/livestreams/ivs/{id}` | **405** only DELETE |
| `/api/livestreams/{id}/playback\|archive\|recording\|audio` | **404** route missing |
| `/api/casts/{post_ptr_id}` | 404 Cast model |
| `/api/realtime/sessions/{id}` | 404 |
| `/api/rooms/{id}` | 404 |

No archive/playback contract surfaced.

## Frontend bundle (`/_nuxt/*.js`)

- Live-related HTTP: mainly  
  - `/api/top/livestreams`  
  - `/api/top/followeelivestreams`  
  - `/api/users/{id}/onair`  
  - `/api/users/{id}/livestreams`  
  - `/api/livestreams/ivs/{id}/chats/token` (**chat token only**)
- `recording-*` / `startRecording` hits come from **Daily.co call machine** SDK strings (host-side cloud/local recording controls), **not** a viewer archive download API.
- No `/api/.../archive` or playback URL builder for ended rooms found.

## Page behavior

`/general|deep/livestream/{id}` for past IDs → unauthenticated HTML is **login page**, no embedded media playlist.

## Implications for erolib

| Capability | Feasible? |
|------------|-----------|
| List past sessions (who/when/title) | Yes |
| Attach local record status to past room_id | Yes (if we recorded live) |
| Download past live audio after end without prior recording | **No (current evidence)** |
| Real-time record while `is_open` | Required for content capture (Phase 2) |

## Residual unknowns (would need auth capture)

1. Host-only Daily cloud recording export (if creators enable it; not exposed to viewers in UI)
2. Authenticated join token for **live** realtime/IVS playback (for Phase 2 live record, not past)
3. Any private admin/creator API not in public web bundle

## Conclusion

Past livestream **content is not recoverable** via currently reverse-engineered public APIs.  
Official product behavior matches: history metadata yes, replay media no.  
erolib should treat auto-record as **must catch while live**; history list is for discovery/status only.
