# Albums — Architecture Plan

Phase 2 output for `docs/albums/requirements.md` (approved scope). No code until this plan is
approved.

## 1. Approach

An album is a **named set of links**, stored as a join table (`album_links`) on top of the
existing `links` table. Nothing is copied: an album is a view over links that also appear on
the main list, so favorites, edit, delete, and locking keep working exactly as they do today.

Three properties drive the whole design:

1. **The hidden/visible rule stays in SQL.** Album counts and covers join through the same
   `locked_domains` subquery the link queries use (`scopeCondition`), so a hidden link cannot
   reach `/` through an album tile.
2. **The owner asked for tabs, not a new page tree.** `?tab=albums` on `/` and `/locked` reads
   like a second view of the same page, so the tab strip is a plain server-rendered list of
   links and survives a refresh or a shared URL.
3. **Every mutation ends in `router.refresh()`.** The existing card actions already work that
   way (`callApi` + refresh), so the popup, the create form, and the rename field follow the
   same pattern and no client cache has to be kept in sync.

The dark locked page keeps its own layout, passcode gate, and detail route, mirroring today's
`/` vs `/locked` split rather than parameterising one page with a scope flag.

## 2. Module boundaries

| Layer | Responsibility |
| --- | --- |
| `src/db/schema.ts` | `albums` and `album_links` tables; the join is the only place membership exists. |
| `src/db/albums.ts` (new) | The only SQL for albums: create, rename, delete, list with scoped counts and covers, membership add/remove, memberships-of-links. |
| `src/db/links.ts` (extended) | Gains an `albumId` option on `listLinks` / `listDomains` / `countLinks`, and drops memberships when a link is deleted. Scope semantics are untouched. |
| `src/lib/validation.ts` (extended) | `parseAlbumName`, `parseAlbumLinkInput` — the only place a name is trimmed, length-checked, and turned into a `name_key`. |
| `src/lib/link-filters.ts` (extended) | Tab resolution (`?tab=`), album search (`?aq=`), and the href builders the tab strip and forms use. |
| `src/app/api/dashboard/albums*` (new) | Four session-gated route handlers; no CORS (same-origin, like the other dashboard routes). |
| Pages | `/` and `/locked` render the active tab; `/albums/[id]` and `/locked/albums/[id]` render one album with the full filter set. |
| Components | Tab strip, album grid/card/cover, create form, album search, the per-card album popup. Shared components stay theme-agnostic (light + `dark:`). |

## 3. Data structures

### 3.1 Schema (migration `drizzle/0003_*.sql`)

```ts
export const albums = sqliteTable(
  "albums",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),          // as typed, trimmed
    nameKey: text("name_key").notNull(),   // name.toLowerCase(); uniqueness lives here
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("albums_name_key_unique").on(table.nameKey)],
);

export const albumLinks = sqliteTable(
  "album_links",
  {
    albumId: text("album_id").notNull(),
    linkId: text("link_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.albumId, table.linkId] }),
    index("album_links_link_idx").on(table.linkId),
  ],
);
```

- No foreign keys and no cascade (D15): the project never enables `PRAGMA foreign_keys`, so the
  integrity is enforced by explicit deletes and by the primary key.
- `album_links_link_idx` makes "which albums is this link in?" (the popup) a cheap lookup.
- Generated with `npm run db:generate` (never hand-written), reviewed, then applied.

### 3.2 Repository API

`src/db/albums.ts`

```ts
export interface Album { id: string; name: string; nameKey: string; createdAt: number }

export interface AlbumSummary {
  id: string;
  name: string;
  createdAt: number;
  /** Links in this album *on this side of the hidden/visible divide*. */
  linkCount: number;
  /** Up to 4 thumbnail URLs, most recently updated first, in the same scope. */
  covers: string[];
}

export function createAlbum(db, input: { name: string; nameKey: string }):
  Promise<{ ok: true; album: Album } | { ok: false; reason: "name-taken" }>;

export function renameAlbum(db, id: string, input: { name: string; nameKey: string }):
  Promise<{ ok: true; album: Album } | { ok: false; reason: "name-taken" | "not-found" }>;

export function deleteAlbum(db, id: string): Promise<boolean>;      // + its memberships

export function getAlbumById(db, id: string): Promise<Album | undefined>;

export function listAlbums(db, options: { scope: LinkScope; query?: string; limit?: number }):
  Promise<AlbumSummary[]>;

/** Album ids per link, for a whole page of cards in one query (no N+1). */
export function listAlbumIdsByLink(db, linkIds: readonly string[]):
  Promise<Map<string, string[]>>;

export function addLinkToAlbum(db, albumId: string, linkId: string):
  Promise<"added" | "already" | "album-not-found" | "link-not-found">;

export function removeLinkFromAlbum(db, albumId: string, linkId: string): Promise<boolean>;
```

`src/db/links.ts` additions (no behavioural change to existing callers):

- `ListLinksOptions.albumId?: string` → `links.id IN (SELECT link_id FROM album_links WHERE album_id = ?)`.
- The same `albumId` option on `listDomains` (so the album page's dropdown offers only domains
  present in that album) and on `countLinks` (for the `N of M links` line).
- `deleteLink` also deletes the link's `album_links` rows, so no orphan membership survives.

### 3.3 API contracts

All four routes run `requireDashboardSession` first (401 / 503 `UNCONFIGURED`), log events in
the established `dashboard_*` style, and answer with `jsonOk` / `jsonError`.

| Route | Body | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/dashboard/albums` | `{ name }` | `201 { album }` | `400` invalid name, `409` name taken |
| `PATCH /api/dashboard/albums/:id` | `{ name }` | `200 { album }` | `400`, `404` gone, `409` name taken |
| `DELETE /api/dashboard/albums/:id` | — | `200 { deleted: true }` | `404` gone |
| `POST /api/dashboard/links/:id/albums` | `{ albumId }` | `200 { added: true }` (also `false` when it was already a member) | `400`, `404` link or album gone |
| `DELETE /api/dashboard/links/:id/albums/:albumId` | — | `200 { removed: true }` | `404` when the pair does not exist |

Next 16 route handlers take dynamic params as `Promise<{ id: string }>` / `Promise<{ id: string; albumId: string }>`.

### 3.4 URL state

| Parameter | Tab | Meaning |
| --- | --- | --- |
| `tab=albums` | both | Shows the album list; absent or anything else means the links tab. |
| `q`, `domain`, `favorite` | links | Unchanged. |
| `aq` | albums | Album-name search. Ignored on the links tab, and vice versa (D13). |

New helpers in `src/lib/link-filters.ts`:

```ts
export type DashboardTab = "links" | "albums";
export function resolveTab(raw: RawSearchParams): DashboardTab;
export function resolveAlbumQuery(raw: RawSearchParams): string;      // `aq`, trimmed, capped
export function buildTabHref(tab: DashboardTab, basePath = "/"): string;
export function buildAlbumsHref(query: string, basePath = "/"): string;
```

`buildLinksHref` keeps its signature, so the existing filter bar is untouched.

## 4. File mapping

### Created

| File | Purpose |
| --- | --- |
| `drizzle/0003_*.sql` + `drizzle/meta/0003_*` | The two tables and their indexes (generated). |
| `src/db/albums.ts` | Album + membership SQL (above). |
| `src/lib/albums.ts` | Small presentation helpers: collage slot filling, `formatAlbumCount` (singular/plural). |
| `src/app/api/dashboard/albums/route.ts` | Create. |
| `src/app/api/dashboard/albums/[id]/route.ts` | Rename, delete. |
| `src/app/api/dashboard/links/[id]/albums/route.ts` | Add a membership. |
| `src/app/api/dashboard/links/[id]/albums/[albumId]/route.ts` | Remove a membership. |
| `src/app/albums/[id]/page.tsx` | Light album detail page. |
| `src/app/locked/albums/[id]/page.tsx` | Dark album detail page (same gate as `/locked`). |
| `src/components/DashboardTabs.tsx` | `Links` / `Albums` tab strip (server-rendered links, `aria-current`). |
| `src/components/AlbumGrid.tsx` | The album list + its empty state. |
| `src/components/AlbumCard.tsx` | One album tile: collage, name, count, actions. |
| `src/components/AlbumCover.tsx` | The 2×2 collage with the 1-thumbnail and 0-thumbnail fallbacks. |
| `src/components/AlbumActions.tsx` | Client: inline rename + two-step delete. |
| `src/components/AlbumCreateForm.tsx` | Client: create an album from the Albums tab. |
| `src/components/AlbumSearch.tsx` | Client: the `aq` search box (debounced, like `LinkFilters`). |
| `src/components/AddToAlbumMenu.tsx` | Client: the per-card popup (checkbox list, create-and-add). |
| `tests/albums-repository.test.ts` | Repository behaviour incl. scope and orphan cleanup. |
| `tests/album-validation.test.ts` | Name parsing + album URL helpers. |
| `tests/album-routes.test.ts` | The four handlers: gating, status codes, payloads. |

### Modified

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `albums`, `album_links`, and their exported types. |
| `src/db/links.ts` | `albumId` option on the three read helpers; `deleteLink` clears memberships. |
| `src/lib/validation.ts` | `MAX_ALBUM_NAME_LENGTH`, `parseAlbumName`, `parseAlbumLinkInput`. |
| `src/lib/link-filters.ts` | Tab + `aq` helpers (above). |
| `src/app/(app)/page.tsx` | Tab strip; render the album list or the link list; pass albums + memberships to the grid. |
| `src/app/locked/page.tsx` | Same, scoped to hidden links; tabs stay visible in the empty state (D14). |
| `src/components/LinkGrid.tsx`, `LinkCard.tsx`, `LinkActions.tsx` | Pass `albums` / `memberAlbumIds` down; add the album button + popup trigger, and the optional "remove from this album" action. |
| `src/components/LinkFilters.tsx` | Only where needed to sit next to the tab strip and to keep the lock icon reachable on the albums tab. |
| `tests/links-repository.test.ts`, `tests/link-filters.test.ts`, `tests/link-management-routes.test.ts` | New cases for the `albumId` filter, membership cleanup, and the tab/`aq` helpers. |
| `README.md` | Albums section, the four endpoints, the tests table, the project layout. |
| `docs/albums/*` | This plan and the requirements, kept in step with what ships. |

### Unchanged (deliberately)

- `src/proxy.ts` — the matcher already gates `/locked*` and everything outside `/api`, `/login`,
  and static assets, so `/albums/[id]` and `/locked/albums/[id]` are covered without an edit.
- `/api/links` (userscript), CORS, `api-auth.ts`, `api-response.ts`, the session/passcode
  cookies, `LockedDomainsPanel`, `locked-domains.ts`, the link/index schema.
- Every existing test keeps its current expectations; new behaviour is additive.

## 5. Key implementation notes

1. **Counts and covers share one scope condition.** `listAlbums` calls the same
   `scopeCondition(scope)` used by `listLinks` — the SQL fragment stays in one module, so an
   album tile cannot forget the rule the grid already enforces.
2. **Covers and the placeholder domain in one query, not N+1.** *(Revised during TDD: the first
   draft read candidate thumbnails and sliced the first four per album in JS, which is unbounded
   — `LIMIT` cannot be expressed per group — so an album with many links could crowd out the
   covers of albums later in the result.)* The shipped query is one album query (LEFT JOIN +
   GROUP BY) plus one window-function query: two `ROW_NUMBER()` rankings over the same
   `album_links` JOIN `links` pass, partitioned by album — `recency` (the newest link, thumbnail
   or not, which names the grey placeholder) and `cover_rank` (the newest links that *have* a
   thumbnail). The outer filter keeps `recency = 1 OR cover_rank <= COLLAGE_SLOTS`, so exactly
   ≤5 rows come back per album and the collage and the placeholder can never disagree about which
   link is the most recent. `COLLAGE_SLOTS` (4, the 2×2 grid) lives in `src/lib/albums.ts` and is
   imported by the repository, so the grid and the query cannot drift apart.
3. **Album list ordered by `lower(name)`**, then `created_at` as a tiebreaker so the order is
   deterministic when two names differ only in case (which cannot happen, but the tiebreaker
   costs nothing).
4. **`name_key` is the only uniqueness key.** `parseAlbumName` trims, rejects empty/whitespace,
   caps at 100 characters, and returns `nameKey = name.toLowerCase()`; the route maps a unique
   violation to `409` exactly like `updateLink` maps one to `url-taken`.
5. **Rename to the same name is a no-op success** — the repository compares `nameKey` with the
   existing row before checking for a conflict, so a save that changes only capitalisation still
   works (`Anime` → `anime`).
6. **Membership add is idempotent** (`onConflictDoNothing` on the composite key) and reports
   `added: false` for a repeat, so a double click cannot produce an error or a duplicate row.
7. **The delete-a-link path clears memberships** inside `deleteLink` (two statements, in order:
   memberships, then the link). Without it, a deleted link would leave a phantom cover/count in
   an album.
8. **The popup receives its data as props** (album list + this link's album ids) rather than
   fetching, and calls `router.refresh()` after a successful change, which is the pattern the
   star/edit/delete actions already use. Creating an album inside the popup is create-then-add
   (D12): the panel needs the new album's id, so `callApi` now returns the endpoint's `data`
   payload on success (`{ ok: true, data }`) — a backwards-compatible widening that every other
   caller keeps ignoring, instead of guessing the id from the name after a refresh that cannot be
   awaited.
8b. **Two deliberate extractions.** `escapeLikePattern` / `isUniqueViolation` moved to
   `src/db/sql-support.ts` (both `links.ts` and `albums.ts` need them, and `isUniqueViolation` is
   used twice inside `albums.ts` alone), and `scopeCondition` is now exported from `src/db/links.ts`
   so albums enforce the identical divide rule. `listAlbumOptions` exists for the popup: names only,
   no scoped counts, so opening the Links tab does not pay for a cover query. Deleting the dead
   `basePath` prop from `LinkFilters` (it navigated by `pathname` all along) came with the wiring.
9. **No browser popups** anywhere: the checkbox menu is an absolutely-positioned panel inside the
   card, closed by a `Done` button, `Escape`, or an outside click; the collage is plain `<img>`.
10. **The tab strip is always rendered** on both pages, including `/locked`'s empty state, and it
    keeps the lock icon reachable on `/` (the same reason the filter bar is always rendered —
    see the previous feature's note 10).
11. **Dark mode stays a single variant.** New components carry `dark:` utilities and are used by
    both pages; `/locked/albums/[id]` inherits the `dark` wrapper from the locked layout.
12. **Detail pages use `notFound()`** for an unknown/deleted album id, so a stale link gets the
    standard 404 instead of a blank page or a database error.

## 6. Execution checklist (Phase 5 order)

Each step is RED → GREEN on its own module, with the full suite at the checkpoints.

1. `src/lib/validation.ts`: `parseAlbumName`, `parseAlbumLinkInput` (+ `tests/album-validation.test.ts`).
2. `src/db/schema.ts`: `albums` + `album_links`; `npm run db:generate`; review `0003`; apply to
   `local.db`; `albums.ts` and the `links.ts` additions (+ `tests/albums-repository.test.ts`,
   extended `tests/links-repository.test.ts`). **Checkpoint: data layer proven.**
3. `src/lib/link-filters.ts`: tab + `aq` helpers (+ extended `tests/link-filters.test.ts`).
4. API routes: the four handlers (+ `tests/album-routes.test.ts`), plus the membership-cleanup
   case in `tests/link-management-routes.test.ts`.
5. UI parts: `DashboardTabs`, `AlbumCover`, `AlbumCard`, `AlbumActions`, `AlbumGrid`,
   `AlbumCreateForm`, `AlbumSearch`; wire the Albums tab into `/` and `/locked`. **Checkpoint.**
6. Membership UI: `AddToAlbumMenu` and the `LinkGrid`/`LinkCard`/`LinkActions` plumbing; the
   "remove from this album" action on the detail pages.
7. Album detail pages: `/albums/[id]` and `/locked/albums/[id]` with the full filter set.
8. `README.md`, then verify: `npm run test`, `npm run lint`, `npm run build`, plus a live pass on
   `:4200` (create/rename/delete, popup add/remove, filters inside an album, the no-leak
   assertions on `/`, dark rendering of `/locked/albums/[id]`, the unchanged userscript / login /
   locking flows) and the unconfigured-passcode case on a second port.

Database note for step 2 and the deploy: `.env.local` currently points at the hosted Turso
database, so `npm run db:push` there creates the two new tables in production. The local file
`local.db` is migrated separately (same SQL, applied to the file) so both stay in step, and the
step is confirmed with the owner before touching the hosted database.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| A hidden link leaking through an album cover, count, or name | Counts and covers go through `scopeCondition`; an end-to-end assertion searches the `/` HTML for the hidden domain string and for a link title. |
| The album detail page becoming a way around the passcode | It exists twice: the light route filters `scope: "visible"`, the dark one lives under `/locked` behind the same gate. Both are asserted. |
| `deleteLink` leaving orphan memberships | The delete path clears them first; a repository test and a route test pin it. |
| A 100-link page turning the popup into 100 queries | `listAlbumIdsByLink` reads all memberships for the page's links in one query. |
| The two tabs drifting (album list showing the other tab's filters) | `resolveTab` + separate parameter names, and tests for "link search on the albums tab is ignored". |
| Name collisions from case or surrounding whitespace | Stored `name_key`, trimmed input, and a `409` path tested with `Anime` vs `anime`. |
| The migration being applied to Turso but not to `local.db` (or the reverse) | Both are migrated in the same step and re-verified with a table listing query. |
| Scope creep (ordering, bulk add, sharing) | Explicitly listed as out of scope in the requirements. |

## 8. Decisions I made that you may want to overrule

1. **Albums are ordered by name, not by creation date.** You dropped manual ordering, and
   alphabetical is the most predictable for a folder-like list. Say the word if you would rather
   have newest-first.
2. **An album with 0 visible links still appears on `/`** (with a count of 0 and no covers). The
   alternative — hiding it — would make the albums tab show a different set of albums on the two
   pages. The name is a label you chose, so it is not treated as secret; the links inside it are.
3. **The album list is capped at 100** like the link list. If you ever pass that, say so and I
   will add paging instead.
4. **Creating an album from the popup takes two calls** (create, then add) rather than a
   combined endpoint. Simpler and it reuses the tested create path; the UI still ends up with the
   new album checked.
5. **Membership endpoints hang off the link** (`/api/dashboard/links/:id/albums/:albumId`).
   Nothing about an album is exposed through them beyond names you already see in the UI.
6. **"Remove from this album" is an extra card action on the album pages only**, not on `/` or
   `/locked`, where there is no album context. Removing is also possible from the popup.
