# Implement checklist

- [x] Otobanana `listAuthorWorks`: dual `is_adult` + dedupe + keep pagination
- [x] Koekoe helpers: search base + normalize identity
- [x] Koekoe `listAuthorWorks`: `m=1&g=1|2`, base word, filter by identity
- [x] Unit tests
- [x] `pnpm --filter @erolib/server test` / typecheck
- [x] Spec note in `vod-sync-local-media.md` (step 3.3)

## Manual smoke

1. `syncWorks=true` on otobanana adult author + koekoe trip author
2. POST sync / UI 立即同步
3. Expect new discoveries or stable re-upsert of author works; no silent empty for known prolific authors
