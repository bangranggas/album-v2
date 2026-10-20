# Requirements — Filter links by album membership

**Slug:** `album-membership-filter`
**Status:** Phase 1 (approved)
**Depends on:** `docs/albums/requirements.md`, `docs/album-scope/requirements.md`,
`docs/dashboard-filters/requirements.md`

---

## 1. Goal

Answer one question from the Links tab, without opening every album:

> Which links have been filed into an album, and which are still loose?

A third filter joins search, domain, and favorites. Like the others it runs in SQL and lives
in the URL, so the view can be reloaded, bookmarked, and shared.

---

## 2. Scope (in)

### 2.1 The control

- A dropdown labelled **Album**, placed after **Domain** in the filter bar.
- Three options:
  | Label | Value | Meaning |
  | --- | --- | --- |
  | All | `""` | no membership restriction |
  | In an album | `in` | belongs to at least one album |
  | Not in an album | `none` | belongs to no album |
- Rendered on **both Links tabs**: `/` (visible links) and `/locked` (hidden links).
- **Not** rendered on an album's own page (`/albums/<id>`, `/locked/albums/<id>`), where every
  link is already a member by definition.

### 2.2 What "in an album" means

- The membership must be in an album **on the page's own side**. A visible link whose only
  memberships are in locked albums counts as *not in an album* on `/`, and the label on its
  card agrees (both read the same side-scoped data).
- A link that sits in two or three albums is returned **once**: the filter is an existence
  test, not a join that multiplies rows.
- Membership is independent of the album's name, cover, or count: the filter never reveals
  a hidden album to the light page, and never reveals a visible one to `/locked`.

### 2.3 Combination and counting

- The album filter combines with search, domain, and favorites using **AND**.
- The 100-row cap applies **after** filtering, so narrowing never loses a match to the cap.
- The count line keeps its current shape: `N links` when nothing is filtered, `N of M links`
  while any filter is active, where **M is the total number of links on that side** (not the
  number of matches). This mirrors the existing domain/search behavior.
- The domain dropdown's counts keep describing the whole side (they are not narrowed by this
  filter), so switching domain always works.

### 2.4 The URL

- `?album=in` and `?album=none`; the parameter is omitted for **All**.
- Parameter order written by `buildLinksHref`: `domain`, `album`, `q`, `favorite`.
- `Clear filters` (in the bar and in the "no matches" state) removes it.
- Switching tabs drops it, like every other link filter.
- Album pages ignore it: `?album=…` on an album URL is stripped before the page builds its
  filter state, so its count line and empty states cannot be made to lie by a shared link.

### 2.5 Empty states

- No matches while filtering → the existing **"No links match your filters"** panel (with the
  album condition named in its sentence), never the "no links yet" onboarding state.
- The side has no albums at all → "In an album" legitimately shows zero matches; the filter
  stays available and usable.

---

## 3. Out of scope

- Choosing a **specific** album from the Links tab (that is what the Albums tab is for).
- Multi-select albums, or combining several album conditions.
- The album detail pages (see 2.1).
- Changes to search, sorting, the 100-row cap, or pagination.
- Any caching, region, or rendering-performance work (tracked separately).
- Schema changes or migrations: every piece of data this needs already exists.

---

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | A dropdown, not toggle buttons | Chosen by the owner; it matches the Domain control and expresses all three states in one place. |
| D2 | Side-scoped membership in SQL | The lock rule is enforced where the data is read, so a light page cannot count a hidden album's membership. |
| D3 | `?album=in\|none`, omitted for All | Consistent with the other filters: bookmarkable, shareable, back-button friendly. |
| D4 | `EXISTS` / `NOT EXISTS` subquery | Returns one row per link regardless of how many albums it is in; uses `album_links_link_idx` and needs no schema change. |
| D5 | The repository option is `albumMembership: "in" \| "none"` | Keeps the URL vocabulary (`""`) out of the database layer, mirroring `favorite`. |
| D6 | The total stays the whole side | Preserves the meaning of `N of M` documented in `dashboard-filters`; the shown number is already capped by the page limit. |
| D7 | Album pages strip the parameter | A shared `?album=none` URL must not make an album page claim a filtered total it is not applying. |
| D8 | Not shown on album pages | The answer there is always "in an album"; showing it would be a control that cannot change anything. |

---

## 5. Data flow

```
Browser  ──GET /?album=in&domain=…&q=…──▶ (app)/page.tsx (server)
                                            ├─ resolveLinkFilters(searchParams)   pure
                                            ├─ listLinks(db, { albumMembership, scope, … })
                                            │     WHERE … AND EXISTS (
                                            │       SELECT 1 FROM album_links
                                            │       JOIN albums ON albums.id = album_links.album_id
                                            │       WHERE album_links.link_id = links.id
                                            │         AND albums.scope = <scope>)
                                            └─ LinkFilters (client) ── router.replace() ──▶ new URL
```

The locked page is the same flow with `scope = 'locked'`.

---

## 6. Acceptance criteria

1. The Links tab on `/` and `/locked` shows an **Album** dropdown with `All`, `In an album`,
   and `Not in an album`; album detail pages do not.
2. Choosing **In an album** lists exactly the links that belong to at least one album on that
   side, once each, and the URL contains `?album=in`.
3. Choosing **Not in an album** lists exactly the links with no album on that side, and the
   URL contains `?album=none`.
4. Choosing **All** removes the parameter and restores the unfiltered list.
5. The filter combines with search, domain, and favorites (all four AND).
6. The count reads `N of M links` while the album filter is active, with M unchanged from the
   unfiltered total.
7. The domain dropdown still lists every domain on that side with its whole-side count.
8. "Clear filters" resets search, domain, favorites, and album in one action.
9. Switching tabs never carries `album` (or any other filter) across.
10. Reloading a filtered URL, and using back/forward, reproduces the same view.
11. A link in two albums appears once under "In an album".
12. A visible link that only belongs to a locked album counts as "Not in an album" on `/`,
    and no locked album name, count, or cover appears anywhere in the light page's HTML.
13. An invalid, empty, or repeated `?album=` value falls back to **All** (first value wins).
14. No matches shows the "No links match your filters" state, not the onboarding state.
15. Opening `/albums/<id>?album=none` leaves the album's own list, count, and empty state
    unaffected.
16. `npm run test`, `npm run lint`, and `npm run build` are green.
17. The new end-to-end probe and the existing five probes pass against a fresh production
    server, and `local.db` still holds the owner's albums and links afterwards.

---

## 7. Edge cases to handle

- `?album=` empty, whitespace, `?album=maybe`, `?album=IN`, `?album=in&album=none` → first
  recognized value, or All.
- A link whose album membership is in the other side's album (seeded by data, not by the UI)
  → not a member on this side, and its card shows no label here.
- An album deleted while the filter is active → its links fall back to "Not in an album" on
  the next render; no stale ids are kept in the URL.
- A side with zero albums → "In an album" returns zero; the control stays rendered, like the
  Domain dropdown with one domain.
- More than 100 matches → the cap is applied to the filtered set, as today.
- Database unreachable → the existing `SetupProblem` panel, unchanged.
- The repository's `scope: "all"` (used by tests/tools, never by a page) → membership is
  counted across albums of both sides, with no scope clause.
- Repeated filtering must not duplicate rows (a link in 3 albums still appears once).
