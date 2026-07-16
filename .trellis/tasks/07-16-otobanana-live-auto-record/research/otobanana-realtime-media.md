# Otobanana Realtime Live Media Protocol

Date: 2026-07-16  
Auth: test account login via `POST /api/signin` (`Email`/`Password`)  
Verified against live `stream_service=realtime` rooms.

## Answer to Phase 2

**Yes — live audio is capturable** while the room is open, via Cloudflare Realtime (WebRTC SFU) behind Otobanana APIs + a signaling WebSocket.

Past sessions still have **no replay URL** (see `otobanana-past-live-media.md`).

## Components

| Piece | Value |
|-------|--------|
| API base | `https://api.v2.otobanana.com` |
| WS base | `wss://api.v3.otobanana.com/ws` |
| Room key for media APIs | `post_ptr_id` (not full `room_id`) |
| Host SFU session | `realtime_session_id` on room/onair |
| Viewer SFU session | returned by `/join` as `sessionId` |
| Media transport | WebRTC (`RTCPeerConnection`, Cloudflare STUN/TURN in join payload) |

## Listener flow (from `/_nuxt/CKQNS3dV.js` `useRealtime`)

1. **Join**
   ```http
   POST /api/livestreams/realtime/{post_ptr_id}/join
   Authorization: <accessToken>
   Content-Type: application/json

   {"livestream_join_token":"<uuid>"}
   ```
   Response:
   ```json
   {
     "sessionId": "<viewer-session>",
     "iceServers": [/* stun/turn.cloudflare.com */]
   }
   ```

2. **Create** `RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" })` and `addTransceiver('audio', { direction: 'recvonly' })`.

3. **WebSocket signaling / presence**
   ```text
   wss://api.v3.otobanana.com/ws/livestreams/{post_ptr_id}?token=<accessToken>
   ```
   Messages:
   - `{ "type": "track", "tracks": [{ "sessionId", "trackName" }] }` — host publishes audio
   - `{ "type": "participant", "count": N }`
   - `{ "type": "end" }` — stream ended
   - `{ "type": "ping" }` / client may send pings

4. **Pull remote track** (filter tracks whose `sessionId !== viewer sessionId`):
   ```http
   POST /api/livestreams/realtime/{post_ptr_id}/add_track
   Authorization: <accessToken>

   {
     "session_id": "<viewer-session>",
     "payload": {
       "tracks": [
         {
           "location": "remote",
           "sessionId": "<host-session>",
           "trackName": "<uuid-from-ws>"
         }
       ]
     }
   }
   ```
   Response (Cloudflare Calls style):
   - `sessionDescription` (usually offer)
   - `requiresImmediateRenegotiation: true`
   - `tracks` with `mid` etc.

5. **Answer renegotiation**
   - `pc.setRemoteDescription(sessionDescription)`
   - `pc.createAnswer()` + `setLocalDescription`
   ```http
   PUT /api/livestreams/realtime/{post_ptr_id}/renegotiate
   Authorization: <accessToken>

   {
     "session_id": "<viewer-session>",
     "payload": {
       "sessionDescription": { "type": "answer", "sdp": "..." }
     }
   }
   ```

6. **Receive** remote audio on `pc.ontrack` → wait until track **unmutes** (often starts `muted=true`).

## Body shape notes (easy to get 500)

Wrong (causes 500 on renegotiate):
```json
{ "sessionDescription": { "type": "offer", "sdp": "..." } }
```

Correct wrapper used by official client:
```json
{ "session_id": "...", "payload": { ... } }
```

Join body should include `livestream_join_token` (client generates UUID).

## stream_service variants

Frontend create path chooses among:
- `realtime` (Cloudflare) — dominant in current live samples
- `ivs` (when RTMP)
- `daily` (legacy Daily.co `room_url` + token)

Phase 2 recorder implements **`realtime` first**.

## Recording strategy for erolib

Node has no browser WebRTC. Phase 2 uses **Playwright Chromium**:

1. Headless Chromium runs the listener protocol on `https://otobanana.com` origin (CORS/Origin).
2. Join → WS track announce → `add_track` + answer renegotiate.
3. Wait for remote `MediaStreamTrack` **unmute**.
4. Capture decoded PCM via **`MediaStreamTrackProcessor` + `AudioData`** (primary).  
   Fallback: `AudioContext` / ScriptProcessor (often silent even when RTP `bytesReceived` > 0).
5. Node assembles mono int16 LE **WAV** under  
   `{dataDir}/live/otobanana/{authorId}/{roomSafeId}/audio.wav`.
6. Poller: `pending_media` → `recording` → offline/WS end/stop → `completed` + `media_rel_path`.

### Smoke evidence (2026-07-16)

- Login OK with provided test account.
- ~19s capture: WAV ~1.8MB @ 48kHz mono, peak ~0.41, active samples ~40%.
- Job state `completed`, `mediaRelPath` set.

## Open follow-ups

- Concurrent recorders / resource limits (`MAX_CONCURRENT=2`).
- Optional mp3 packaging + library import (out of Phase 2 default).
- `ivs` / `daily` stream_service support.
- Graceful stop without abort race (flush already improved).
