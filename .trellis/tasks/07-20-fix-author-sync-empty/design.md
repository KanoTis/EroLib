# Design: listAuthorWorks empty-result fix

## Scope

| File | Change |
|------|--------|
| `apps/server/src/providers/otobanana.ts` | `listAuthorWorks`: fetch both adult flags + dedupe |
| `apps/server/src/providers/koekoe.ts` | `listAuthorWorks`: base-name search + gender + identity filter |
| `apps/server/test/*` | unit tests for helpers / URL construction |

## Otobanana

```
for isAdult in [false, true]:
  page through GET /api/users/{uid}/casts?limit=50&offset=N&is_adult={isAdult}
  parse CastPayload / LikeListItem → RemoteWorkRef
  dedupe by workId across both adult flags
```

- Keep existing `next_page_url` / offset fallback.
- Do **not** rely on bare URL without `is_adult` (API defaults to non-adult empty for R18 creators).
- Token still required via existing `apiGet`.

## Koekoe

Author ids stored as display identity, e.g. `黒猫◆/HV2b6TqMw` or `黒猫◆_HV2b6TqMw`.

```
parseAuthorSearchKey(authorId) → { base: "黒猫", fullNorm: normalize(full) }
for g in [1, 2]:
  page search.php?word={base}&m=1&g={g}&p={page}
  parseListCards → filter by author identity match (normalize ◆/ vs ◆_)
  dedupe by workId
```

- Search **base name only** (strip trip / nan marker); full trip as `word` returns empty.
- Always pass `g` when `m=1` (site returns empty without gender in author mode).
- Filter: match full identity after normalizing `◆/` ↔ `◆_`; also accept base-only cards when subscription is base-only.
- Prefer not to use unscoped full-text search without `m=1` (noise).

Helpers (export for tests if small):

- `normalizeKoeKoeAuthorKey(id: string): string` — NFC-ish trim + unify trip slash
- `koeKoeAuthorSearchBase(id: string): string` — strip `◆…` / `◇ID_…` suffix

## Runner / API

No runner changes unless needed for observability. Empty list remains success.

## Compatibility

- Existing favorites path untouched.
- Author path still `fromFavorites=false`.
- Spec update: document `is_adult` dual-pass and koekoe `g`+base search in `vod-sync-local-media.md`.

## Validation

1. Unit tests (koekoe normalize/filter; optional oto URL builder)
2. Manual: open 同步作品 on kei7241 + 黒猫 trip → 立即同步 → sync run / library
