# Otobanana Live: Author → Room Mapping

Date: 2026-07-16  
Status: verified by live API probes

## Summary

Given an author **UUID**, Otobanana exposes a direct on-air endpoint that returns the live `room_id` when the user is streaming. Username cannot be used as the path segment.

## Endpoints

### Primary: user onair

```http
GET https://api.v2.otobanana.com/api/users/{userId}/onair
Accept: application/json
Origin: https://otobanana.com
```

| State | HTTP | Body |
|-------|------|------|
| Live | 200 | room object, `is_open: true`, includes `room_id` |
| Offline | 404 | `{"status_code":404,"code":0,"message":""}` |

Auth: anonymous worked in 2026-07-16 probes. Frontend still sends `Authorization` when logged in.

Frontend source (`/_nuxt/CddccoJi.js`):

```js
$fetch(`${apiBase}/api/users/${userId}/onair`, {
  method: "GET",
  headers: { Authorization: accessToken },
  credentials: "include",
})
// used by setHasStreaming → isStreaming = response.is_open
```

### Secondary: user livestreams list

```http
GET https://api.v2.otobanana.com/api/users/{userId}/livestreams
```

- Live: `data: [room, ...]`
- Offline: `data: []` (200)

### Global lists

```http
GET /api/top/livestreams?is_adult=false|true
GET /api/livestreams?is_adult=false|true
GET /api/top/followeelivestreams   # login; empty without session
```

`is_adult=true/false` return different sets. Watchlist matching should query both if adult content is in scope.

## Room identity

Example:

```text
room_id = realtime:802b8dfd-3f0c-406a-b89b-cd3333c9d971:906a876a-805c-4e36-8f2f-b3a7ace4938b
```

Pattern:

```text
{stream_service}:{userId}:{sessionOrStreamId}
```

Observed fields on room object:

- `room_id`, `room_open_at`, `room_close_at`
- `post_ptr_id`, `post.id`, `post.user_id`, `post.user.username`, `post.user.name`
- `is_open`, `is_adult`, `is_rtmp`, `stream_service` (`realtime` in sample)
- `realtime_session_id`
- `listener_count`, `room_rule`, `thumbnail_url`
- onair-only extras: `chats`, `event`

## Username resolution

Does **not** work:

- `GET /api/users/{username}` → 404 model not found
- `GET /api/users/{username}/onair` → 404
- `GET /api/users?q=` / `?username=` — not the real search contract

**Does work** (frontend search users page):

```http
GET https://api.v2.otobanana.com/api/users?is_adult=false|true&search={username}
```

- Frontend strips leading `@` before search.
- Adult and general are partitioned: a user may only appear under one of `is_adult=true|false`.
- Implementation must query **both** partitions and require **exact** `username` match on results (search may be fuzzy/partial).

Verified 2026-07-16:

| search | is_adult | exact hit |
|--------|----------|-----------|
| `hideyooooooooo` | true | `802b8dfd-...` |
| `hideyooooooooo` | false | none |
| `ame_tenki` | false | `9f2968e6-...` |
| `ame_tenki` | true | none |
| `@hideyooooooooo` | true/false | none (do not send `@`) |

Resolution order for add-author:

1. If input looks like UUID → use directly
2. Else strip `@`, search both adult flags, exact-match username → UUID
3. Fallback: followee live list / local authors table exact match
4. Else error: username not found

## Media path (open)

Not solved in this note.

Known clues:

- Sample `stream_service: "realtime"` (not plain public HLS URL)
- Site loads `amazon-ivs-player.min.js`
- Chat token API: `GET /api/livestreams/ivs/{id}/chats/token` (auth required)
- Live page routes redirect to login when unauthenticated
- IVS chat uses `tokenProvider` + `awsIvsRegion`; this is chat, not necessarily A/V playback

Next research:

1. Authenticated capture of live page network for playback URL / join token
2. Whether `stream_service=realtime` uses Daily/WebRTC/other (bundle also mentions Daily remote media player strings)
3. Map `post_ptr_id` / room third segment to IVS or realtime media API

## Probe samples (2026-07-16)

Online author:

- userId: `802b8dfd-3f0c-406a-b89b-cd3333c9d971`
- username: `hideyooooooooo`
- `/onair` → 200, `is_open: true`
- room_id: `realtime:802b8dfd-...:906a876a-...`

Offline author:

- userId: `9f2968e6-f952-4e1e-8b6e-8f403068d6fa`
- `/onair` → 404
- `/livestreams` → `{ data: [] }`

Adult list also returned live rooms; `/users/{adultUserId}/onair` likewise returned `is_open: true` + matching `room_id`.
