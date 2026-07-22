# Author Navigation UI

Executable contracts for author name links and the local author page.

## 1. Scope / Trigger

- Trigger: user clicks author name on Library VOD cards or Work detail; routes to author home.
- Routes: `/authors/:provider/:authorId`.
- MVP entry points only: `LibraryPage` (VOD cards), `WorkDetailPage`. Out of scope for this feature: Live cards, Sync list, PlayerBar, SubscribeAdd.

## 2. Signatures

```ts
// apps/web
// AuthorLink — invalid/missing/_unknown authorId → <span>, not Link
// AuthorAvatar — hasAvatar + api.authorAvatarUrl; else hash placeholder glyph
// AuthorPage — getAuthor + works/liveMedia with authorId; subscription CRUD via existing APIs
// App route: /authors/:provider/:authorId
```

API client:

- `api.getAuthor(provider, authorId)`
- `api.authorAvatarUrl(provider, authorId)`
- `api.works({ …, authorId })` / `api.liveMedia({ …, authorId })`

## 3. Contracts

| UI piece | Rule |
|----------|------|
| Link target | `/authors/${provider}/${encodeURIComponent(authorId)}` |
| Invalid id | no navigation (`_unknown`, empty, whitespace) |
| Route params | use `useParams` values as-is (React Router already decodes) |
| Page sections | avatar + displayName + provider; subscription add/toggles; view-mode toggle; VOD list; live list |
| View mode | one page-level control (`small` / `standard` / `list`) applies to both VOD and live; shares `localStorage` key `erolib.library.viewMode` with library |
| New subscription | `enabled: false`, `syncWorks: false` |
| Auto-record toggle | show only when provider is otobanana (or disable for others) |
| Pagination | page size 50 per source when listing author media (same as library) |

## 4. Validation & Error Matrix

| Condition | UI |
|-----------|-----|
| Author detail fails | error state on page |
| Avatar 404 / img error | placeholder glyph |
| Empty VOD and live | empty sections, not crash |
| Subscription patch fails | surface error; keep previous toggles where possible |

## 5. Good / Base / Bad

- **Good**: click author on VOD card → author page filtered lists.
- **Base**: `_unknown` author stays plain text.
- **Bad**: linking Live/Sync author names without product decision (scope creep vs MVP).
- **Bad**: second `decodeURIComponent` on params.

## 6. Tests Required

- Typecheck web.
- Manual: AC1–AC7 from issue #5 task PRD.

## 7. Wrong vs Correct

#### Wrong

```tsx
<span className="work-meta">{work.authorName}</span>
// never navigable
```

#### Correct

```tsx
<AuthorLink provider={work.provider} authorId={work.authorId}>
  {work.authorName ?? work.authorId}
</AuthorLink>
```

## Design Decisions

- **Shared `AuthorLink`**: one validity rule; future Live/Sync can reuse.
- **Author page owns subscribe UX for that author**; Sync remains the full subscription list (see sync-live-page-ownership).
