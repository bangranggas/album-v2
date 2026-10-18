# Albums — Requirements

Phase 1 output for the `albums` feature. Scope agreed with the owner on 2026-10-18.

## 1. Goal

Let the owner group saved links into **albums** and browse them, without breaking any of the
existing guarantees — in particular the rule that links on a hidden (locked) domain must not
leak onto the light dashboard.

Albums are a second way to *look at* the same links. They are not a second copy of the data: a
link still lives in `links`, and an album is a named collection of links.

## 2. Scope (in)

1. **Tabs.** A two-tab strip — `Links` and `Albums` — on `/` (light) and on `/locked` (dark).
   The active tab is part of the URL, so it survives a refresh and the back button.
2. **Albums tab.** Lists every album with a collage cover, its name, and how many links it holds
   *on that page's side*. It also holds the "create album" form and a search box for album names.
3. **Album detail page.** Opening an album shows its links in the familiar grid, with the full
   filter set (search, domain, favorites) applied **inside** the album.
4. **Membership from the link card.** Every link card gets an "add to album" button that opens a
   small popup: the albums are listed with checkboxes — checking adds the link, unchecking
   removes it — and a new album can be created right there and the link added to it at once.
5. **Album management.** Rename an album, delete an album (inline two-step confirmation, no
   browser popup), and remove a link from an album (from the detail page and from the popup).
6. **Scope awareness.** On `/`, album counts and covers consider only *visible* links; on
   `/locked`, only *hidden* ones. Album names themselves are not secret.
7. **API.** Create / rename / delete an album, and add / remove a single (link, album) pair.
8. **Data.** Two new tables (`albums`, `album_links`), a migration, and tests.

## 3. Out of scope

- **Manual album ordering** — dropped by the owner; albums are ordered automatically (D8).
- Bulk "put these N links into an album", selecting many links at once — **delivered separately**,
  after this feature shipped (`docs/bulk-album-assign/`).
- A navbar entry for albums; album descriptions; nested albums; album sharing or permissions.
- Drag & drop anywhere.
- The userscript API (`POST` / `GET /api/links` with `x-secret-key`) neither reads nor writes
  albums — its contract is unchanged.
- Locking an album. Only domains are lockable, exactly as today.
- Any link order inside an album other than the existing "most recently updated first".

## 4. Decisions

> **Amended on 2026-10-18 by `docs/album-scope/`.** D3 and D7 below are superseded: albums now
> have a `scope` column, each page lists only its own side's albums, and uniqueness is per
> `(scope, name_key)`. The rest of the table still holds.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Many-to-many: `album_links(album_id, link_id)` with a composite primary key | Owner's choice; a link can sit in several albums, and the key makes a duplicate pair impossible. |
| D2 | Counts and covers are computed with the same `locked_domains` subquery the link queries use | The hidden/visible rule lives in SQL (see the previous feature's note 1); album metadata must obey it too. |
| D3 | ~~The album list itself appears on both pages even when the scoped count is 0~~ **(amended: each page lists only its own side's albums)** | Album names are user labels, not link data. Hiding such an album would make the two tabs disagree about which albums exist. Names, counts, and covers never reveal a hidden link. |
| D4 | Two detail routes: `/albums/[id]` (light) and `/locked/albums/[id]` (dark) | Mirrors today's `/` vs `/locked` split: the dark subtree already owns its theme and passcode gate, and a single route with a scope flag could render hidden links on a light page. |
| D5 | Membership endpoints hang off the link: `POST /api/dashboard/links/:id/albums` and `DELETE /api/dashboard/links/:id/albums/:albumId` | One pair of endpoints serves both UIs: the popup (one link, many albums) and the album page (many links, one album). |
| D6 | No `GET /api/dashboard/albums` | Pages and popups get their data as server-rendered props, and every mutation ends in `router.refresh()` — the pattern the existing card actions already use. |
| D7 | Album names are unique, case-insensitively, via stored `name` + `name_key` columns **(amended: unique per side, on `(scope, name_key)`)** | A unique index on a plain column is deterministic (no expression-index surprises) and testable; `name_key = name.trim().toLowerCase()`. |
| D8 | Albums are ordered by name, case-insensitively | The owner dropped manual ordering; this is stable, predictable, and identical on both pages. |
| D9 | The albums tab lists at most `ALBUM_LIMIT = 100` albums (the same cap style as links) | Consistent with the existing per-scope 100-row cap; a cap keeps the page bounded. |
| D10 | Hard deletes: deleting an album removes its memberships only; deleting a link removes its memberships | No trash bin (matching links). The link rows themselves are untouched by an album deletion. |
| D11 | Cover = up to **4** thumbnails of the most recently updated links in scope, in a 2×2 grid; one thumbnail fills the tile; no thumbnail shows a grey placeholder with the album's first domain, or a folder glyph for an empty album | Owner's request: the tile should look like a folder you can peek into. |
| D12 | "Create album and add this link" is two API calls (create, then add) | Reuses the tested create endpoint instead of a second, special-purpose one; the popup simply ends up with the new album checked. |
| D13 | The album search uses its own query parameter (`aq`); the links tab keeps `q` / `domain` / `favorite` | The two tabs filter different things; reusing `q` would make a link search silently filter the album list. |
| D14 | The tab strip is always rendered, even where a page currently shows an empty state instead of the filter bar | Same reason the lock icon is always reachable on `/`: with two tabs, "nothing here" must not hide the way to the other tab. |
| D15 | No foreign keys, no `ON DELETE CASCADE`; deletions are explicit statements in the repository | The project never enables `PRAGMA foreign_keys`, so an FK would only be decorative; explicit deletes are enforced by tests instead. |
| D16 | Covers use plain `<img>` tags, no image generation or remote patterns | Thumbnails already come from arbitrary third-party hosts (see `LinkCard`); the project targets zero infrastructure cost. |

## 5. Data flow

```
/                    (app) group, session-gated by proxy.ts
  ?tab=albums  ──────▶ listAlbums(scope: "visible", query: aq)
  ?tab=links   ──────▶ listLinks(scope: "visible", …)            (unchanged)

/locked              dark subtree, passcode-gated
  ?tab=albums  ──────▶ listAlbums(scope: "locked", query: aq)
  ?tab=links   ──────▶ listLinks(scope: "locked", …)             (unchanged)

/albums/[id]         ─▶ getAlbumById + listLinks({ albumId, scope: "visible" })
/locked/albums/[id]  ─▶ getAlbumById + listLinks({ albumId, scope: "locked" })

card popup  ──POST   /api/dashboard/links/:id/albums          { albumId }
            ──DELETE /api/dashboard/links/:id/albums/:albumId
            ──POST   /api/dashboard/albums                     { name }     (create inline)
            └─ then router.refresh() so server props re-render

albums tab  ──POST   /api/dashboard/albums                     { name }
            ──PATCH  /api/dashboard/albums/:id                 { name }
            ──DELETE /api/dashboard/albums/:id
            └─ then router.refresh()
```

`album_links` is written only by the membership routes; the album and link rows are never
duplicated, so an album is always a *view* over links that also exist on the main list.

## 6. Acceptance criteria

1. `/` and `/locked` both show a `Links` / `Albums` tab strip; the active tab is in the URL and a
   refresh or a shared link reopens the same tab.
2. The Albums tab lists every album, ordered by name, each with a collage cover, its name, and
   its link count on that side of the hidden/visible divide; the create form and the album
   search work from there.
3. Creating an album from the Albums tab adds it to the list immediately; a name that already
   exists (ignoring case) is refused with a clear message and nothing is written.
4. Clicking an album opens its detail page with the album's links; search, domain, and favorites
   filters narrow that album's links, and the count line reads `N of M links`.
5. Every link card has an "add to album" button; the popup lists all albums with the ones this
   link already belongs to checked.
6. Checking an album adds the link; unchecking removes it; repeating the same action changes
   nothing (no duplicate membership) and the UI stays consistent after one refresh.
7. The popup can create a new album and add the current link to it in one flow.
8. The album detail page can remove a link from the album, and the link itself stays on the
   main list.
9. Renaming an album updates its name everywhere; renaming to an existing name is refused with a
   message; renaming to the same name is a harmless no-op.
10. Deleting an album (after an inline confirmation) removes the album and its memberships; the
    links themselves remain on the main list, and a later visit to the album URL reports "not
    found".
11. Deleting a link removes it from every album it was in.
12. **No leak:** with a hidden domain holding links that belong to an album, `/` (links tab, the
    albums tab, and the album detail page) never shows that domain, its links, its count in an
    album, or its thumbnail. `/locked` shows them.
13. The locked area keeps its dark theme, its passcode gate, and the rule that an expired
    passcode sends the visitor back to the prompt.
14. Authentication is unchanged: visiting a page without the session redirects to `/login`;
    a missing/blank `DASHBOARD_PASSWORD` still answers `503`, and a missing/blank
    `LOCKED_PASSCODE` still affects only `/locked*`.
15. The userscript flow, `POST`/`GET /api/links`, CORS, login, logout, the navbar, the existing
    filters, favorites, locking, and manual add behave exactly as before.
16. `npm run test`, `npm run lint`, and `npm run build` are green.

## 7. Edge cases to handle

- **Empty album** — allowed; it shows a count of 0, the placeholder cover, and an empty state on
  its own page. A pre-emptive album is legitimate (the owner may create it before saving links).
- **Album whose links are all hidden** — `/` shows it with a count of 0 and no covers;
  `/locked` shows the real count and covers. Neither page reveals the other's links.
- **Whitespace-only or empty name** → rejected with a message.
- **Name longer than 100 characters** → rejected; the input also caps at 100.
- **Duplicate name, different case** (`anime` vs `Anime`) → refused (`409`).
- **Rename to the album's own current name** → succeeds as a no-op (not a conflict).
- **Adding the same link to the same album twice** → idempotent; the response still succeeds and
  the popup keeps the box checked.
- **Adding a link to an album that was deleted in another tab** → `404`, with a message and a
  refresh, so the popup does not silently pretend success.
- **Deleting the last link of an album** → the album stays, count drops to 0.
- **Album deleted while its detail page is open** → the page reports "not found" instead of
  erroring.
- **A stale `?albumId`/`:id`** (not a UUID) → `404`, never a database error.
- **`?tab=albums` while the links tab's `q` is set** → the link search is ignored on the albums
  tab, and the album search is ignored on the links tab.
- **Very many albums** → capped at 100 with the same "showing the first N" honesty as links.
- **A link with no thumbnail in an album** → it simply does not contribute a cover tile.
- **Expired passcode on `/locked/albums/[id]`** → redirected to `/locked/unlock?next=…`, which
  returns to the album afterwards.
- **Unconfigured passcode** → `/locked*` explains it; `/albums/[id]` keeps working.
- **A name that looks like a domain** (e.g. `indoav.com`) → treated as a label; it must not be
  mistaken for domain data anywhere (the leak test uses this shape on purpose).
- **Emoji / non-ASCII names** → allowed; uniqueness uses a lowercase key.
