# Per-side albums (album scope) — Requirements

Phase 1 output for the `album-scope` feature. Scope agreed with the owner on 2026-10-18, in
response to the report: *"an album created on the locked page only shows on the locked page and
disappears on the normal page — so every album is dedicated to normal or locked and cannot cross
pages"*.

Investigated first, then decided. The measurement (production build, real `local.db`) was:

- `/?tab=albums` rendered `Empty album · test · 0 links` and `Empty album · test2 · 0 links`.
- `/locked?tab=albums` rendered `test · 2 links` and `test2 · 2 links`.
- In the database both albums hold only hidden links (`scele.cs.ui.ac.id`, `www.youtube.com`,
  `www.indoav.com` — all three in `locked_domains`).

So the album *names* were never hidden (the albums feature's decision D3); what looked like a
disappearing album was a 0-count tile with an "Empty album" cover on the light page. The owner's
answer to the choice between "keep the shared model, only fix the wording" and "make albums
dedicated per side" was **dedicated per side**, with the four follow-up decisions recorded in §4.

## 1. Goal

Give every album a **side** — `visible` (the light dashboard, `/`) or `locked` (the passcode-gated
area, `/locked`) — so that:

1. an album created in the locked area is listed there and **not** on `/`, and vice versa; and
2. no album can ever mix the two sides, so a light page can never show an album whose contents are
   behind the passcode (and no longer has to render a misleading `0 links` tile for one).

This **amends** the albums feature's D3 ("the album list appears on both pages even when the scoped
count is 0") and D6 ("album names are not secret"): from now on each page lists only its own side's
albums, and a locked album's name is not visible outside the locked area.

The hidden/visible rule for **links** is unchanged: `locked_domains` still decides a link's side,
the same `scopeCondition` fragment still filters every link read, and the locked area keeps its
passcode gate and dark theme.

## 2. Scope (in)

1. **Schema.** `albums` gains `scope` (`text`, not null, default `visible`; one of `visible` |
   `locked`). Uniqueness becomes per side: `(scope, name_key)` instead of `name_key`.
2. **Migration `0004`.** Adds the column, backfills the sides of albums that already exist from
   their contents, and swaps the unique index. No `album_links` rows are rewritten.
3. **Albums tab.** `/` lists, creates, and counts only `visible` albums; `/locked` only `locked`
   ones. The `Links` / `Albums` tabs, the create form, the album search (`aq`), the collage cover,
   the ordering, and the `N of M albums` line behave exactly as today — per side.
4. **Creating an album** carries the side of the page it was started from. The same name may exist
   once per side (`Anime` on `/` and `Anime` on `/locked` are two different albums).
5. **Filing a link.** The per-card "add to album" popup and the bulk selection bar offer **only**
   the albums of the page they render on, and their membership checkboxes only reflect those
   albums.
6. **Membership guard.** A link may only join an album on the link's own side. The single-link
   endpoint refuses the other combination with `409`; the bulk endpoint counts such ids as
   `skipped` (see D8 — unreachable from the UI either way).
7. **Detail routes.** `/albums/[id]` answers `404` for a locked album and
   `/locked/albums/[id]` answers `404` for a visible one, instead of rendering an empty page.
8. **Data migration for existing data.** Albums that already exist are placed automatically (§4 D2).
9. **Tests and docs.** Repository, validation, route, and no-leak coverage, plus README updates.

## 3. Out of scope

- **Moving an album to the other side.** Owner's decision: an album's side is fixed at creation,
  and a wrong-side album is replaced by creating a new album on the right side. No `PATCH` of
  `scope`, no move button.
- **Cross-side contents.** There is no view, endpoint, or count that shows the other side's links
  inside an album. In particular a visible album still shows `0` when its links have all moved to
  the hidden side (see §7).
- **Splitting mixed albums** created before this change, and **rewriting `album_links`** in the
  migration: dormant memberships are kept as they are (D7).
- **Per-side changes to the links rule**: locking a domain, the userscript API, `x-secret-key`,
  CORS, favorites, search, filters, the navbar, and the 7-day dashboard session are untouched.
- Bulk remove / bulk favorite / bulk delete (still not a thing), album ordering, album
  descriptions, nested albums, sharing, drag & drop.
- Re-wording the `Empty album` / `0 links` tile (D11).

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | `albums.scope` is a plain `text` column, not null, default `'visible'`, holding `'visible'` or `'locked'` — the same two values as the link scope, minus `'all'` | Lives in the same vocabulary as the link rule, so "which side is this?" is one string everywhere. A default keeps `ALTER TABLE ADD COLUMN` legal on a table that already has rows. |
| D2 | **Migration backfill:** an existing album becomes `locked` when it has at least one hidden member **and no visible member**; every other existing album becomes `visible` | Owner's choice ("ikut isinya, otomatis"). All-hidden is the unambiguous case, and it is exactly the reported one: `test` and `test2` (hidden-only) become locked albums. A mixed album keeps the light page as its home, which is the friendlier of the two surprises — the album stays where the owner last saw it instead of vanishing. |
| D3 | Uniqueness is per side: a unique index on `(scope, name_key)` replaces the index on `name_key` | Owner's choice. The same label on both sides is natural (`Anime` for the public list, `Anime` for the private one), and a global index would turn the `409` message into a probe for locked album names — the exact leak this feature removes. |
| D4 | An album's `scope` is **immutable**: creation sets it, `PATCH` keeps ignoring it, and there is no move action | Owner's choice. Moving a locked album to the light side would leave its links behind anyway (they belong to the other side), so the feature would ship a broken state; creating a new album on the right side is honest. |
| D5 | Each page lists only its own side's albums: `listAlbums`, `countAlbums`, and the detail pages filter on `albums.scope` | The point of the feature. It **amends** albums D3: the two tabs no longer agree on which albums exist, and a locked album's name no longer appears on `/`. |
| D6 | The popup and the bulk panel receive only their page's albums (`listAlbumOptions(db, scope)`), and the membership map is scope-filtered too (`listAlbumIdsByLink(db, ids, scope)`) | Otherwise the light page would still receive locked album names, and its checkboxes would reveal which of them hold the link. The scope is threaded from the page, exactly like every other link read. |
| D7 | Adding a link to an album of the other side is refused: `addLinkToAlbum` gains a `scope-mismatch` outcome and the route answers `409`; **existing** memberships are never rewritten by a later lock change | Owner's choice. The refusal is what makes "dedicated" true (a visible link can never be filed into a locked album), while the dormant rows keep the data: unlocking the domain makes the old membership show up again instead of having been silently deleted. |
| D8 | The bulk endpoint (`POST /api/dashboard/albums/:id/links`) treats an id that is not on the album's side as `skipped`, the same bucket as an id that no longer exists | Keeps the three counts summing to the distinct request size, which the existing report already relies on. It is unreachable from the UI (the selection is always built from one page), and `skipped` is deliberately ambiguous so nothing about the hidden side leaks. |
| D9 | The detail routes guard the side: `/albums/[id]` calls `notFound()` for a `locked` album, `/locked/albums/[id]` for a `visible` one | An album URL pasted on the wrong side must not render a cross-side shell. `404` (not `403`) keeps it identical to "no such album", so the wrong side learns nothing. The queries inside keep passing the page scope as well — defence in depth. |
| D10 | The client sends `scope` on create, derived from the `locked` prop the pages already thread (`locked ? "locked" : "visible"`); the server validates it and answers `400` for a missing or unknown value. Rename keeps its `{ name }` payload and checks the conflict **inside the album's own scope** | No new prop has to be plumbed through `LinkGrid` → `LinkCard` → `AddToAlbumMenu`, or into `SelectionBar` / `AlbumCreateForm`: the `locked` flag is already there, and it means exactly this. Requiring the field keeps a silent misfiling impossible for a hand-made request. |
| D11 | The `Empty album` placeholder and the `N links` tile wording stay as they are | With dedicated albums a `0` on a page is now truthful for that side, and the confusing case (an all-hidden album rendered on `/`) cannot happen any more. The remaining case — a visible album whose links were all locked afterwards — is honest at `0` and is documented in §7 instead of dressed up. |
| D12 | No foreign keys, no cascade, no `album_links` rewrite; `scope` is enforced by the repository and by the unique index | Unchanged project rules (albums D15): the schema has nothing to cascade, and the migration must not touch rows the owner did not ask to change. |

## 5. Data flow

```
create album          ──POST /api/dashboard/albums  { name, scope }        (scope validated)
                        └─ unique index decides conflicts per (scope, name_key)

/                     ?tab=albums ─▶ listAlbums(db, { scope: "visible", query, limit })
                                    countAlbums(db, "visible")
      ?tab=links   ─▶ listAlbumOptions(db, "visible")            (card popups + bulk panel)
                      listAlbumIdsByLink(db, ids, "visible")     (checkbox state)

/locked               ?tab=albums ─▶ listAlbums(db, { scope: "locked", … })
                                    countAlbums(db, "locked")
      ?tab=links   ─▶ listAlbumOptions(db, "locked")
                      listAlbumIdsByLink(db, ids, "locked")

/albums/[id]          ─▶ getAlbumById → scope must be "visible"  (else 404)
                         listLinks({ albumId, scope: "visible" })   (unchanged)
/locked/albums/[id]   ─▶ getAlbumById → scope must be "locked"   (else 404)

membership            ──POST /api/dashboard/links/:id/albums { albumId }
                        └─ album side ≠ link side → 409 "scope-mismatch"
                      ──DELETE /api/dashboard/links/:id/albums/:albumId   (unchanged)

bulk filing           ──POST /api/dashboard/albums/:id/links { linkIds }
                        └─ ids off the album's side → counted as `skipped`
```

`albums.scope` is read (never guessed) wherever albums are listed or joined, and `scopeCondition`
keeps filtering links, counts, and covers exactly as before.

## 6. Acceptance criteria

1. An album created on `/locked` (Albums tab, or the popup/bulk panel there) is listed on
   `/locked?tab=albums` and is **absent** from `/?tab=albums`; the same holds in the other
   direction for `/`.
2. `/` never renders the name, id, count, domain, or thumbnail of a locked album, and never a
   locked link — on the links tab, the albums tab, the album detail page, the card popup, or the
   bulk panel. `/locked` only ever renders locked albums.
3. The count line reads the number of that side's albums (`2 albums`, `1 of 2 albums`) and the
   albums of the other side are not counted.
4. The same name can exist once per side: creating `Anime` on `/locked` succeeds even when `Anime`
   exists on `/`, and each page lists only its own; a duplicate **within** a side is still `409`
   with the existing message.
5. Renaming an album within its own scope behaves as today (conflict → `409`, same name → no-op);
   a rename can never collide with an album of the other side.
6. The card popup lists only the page's albums, and its checkboxes are checked only for the albums
   of that page; adding and removing still work, still refresh, and stay idempotent.
7. The bulk "Add to album" panel lists only the page's albums and files the selection into one of
   them with the existing report; the report's counts still sum to the number of selected links.
8. Filing a link into an album of the other side through the API answers `409` with a message that
   names the side, and writes nothing; the same request against a same-side album still succeeds.
9. `/albums/[id]` answers `404` for a locked album, `/locked/albums/[id]` for a visible one; the
   correct side renders the album with its filters, count line, and empty state as before.
10. A link that leaves an album's side because its domain was locked (or unlocked) disappears from
    that album's contents, count, and covers without being deleted from `album_links`, and comes
    back if the domain returns; a locked album is never re-listed on the light page.
11. Albums created before this change are placed by §4 D2: `test` and `test2` (hidden-only members)
    are locked albums; no membership row is lost by the migration.
12. Authentication, the locked gate, the dark theme, the userscript, `POST`/`GET /api/links`, CORS,
    favorites, filters, locking, and the links tab are unchanged.
13. `npm run test`, `npm run lint`, and `npm run build` are green.

## 7. Edge cases to handle

- **Album with no links at all** → allowed, created with the page's side, listed there with `0`
  links and the placeholder cover (unchanged behaviour).
- **Album whose links all moved to the other side later** (the owner locked the domain) → it stays
  on its own side with `0` links, `0` covers, and an empty detail page; the memberships stay in the
  database and reappear if the domain is unlocked. There is no move action (D4).
- **Mixed legacy album** → becomes `visible` (D2); its hidden members are dormant until their
  domain is unlocked. Nothing is deleted.
- **Legacy album with only hidden members** → becomes `locked`; its `2 links` and covers move to
  `/locked` and it disappears from `/`.
- **`(scope, name_key)` index on legacy data** → no collision is possible: the old global index was
  strictly stronger, so the new one cannot be violated by existing rows.
- **Missing or unknown `scope` in the create payload** → `400` (`scope: …`), nothing written.
- **`scope` sent on rename** → ignored (the field is immutable).
- **A locked album's id used on `/albums/[id]`** → `404`, same body as an unknown id.
- **A visible album's id used on `/locked/albums/[id]`** → `404`.
- **A locked link added to a visible album** → `409`, nothing written; the popup never offers that
  combination, so this only happens against a hand-made request or a stale page.
- **A visible link added to a locked album** → `409` (same rule, other direction).
- **Bulk add where an id is on the other side** → counted as `skipped`, the rest still filed.
- **Bulk add of an album that was deleted in another tab** → `404` (unchanged).
- **Album deleted while its detail page is open** → `404` (unchanged).
- **Empty `?aq=` search / no matches on a side** → the existing "create the first album" empty state
  for that side, unchanged.
- **Unconfigured passcode** → `/locked*` explains it; `/albums/[id]` keeps working (unchanged).
- **A visible-album name that looks like a domain** (e.g. `indoav.com`) → still treated as a label.
- **Emoji / non-ASCII names** → allowed; uniqueness still uses the lowercase key, now per side.
