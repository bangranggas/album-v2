# Requirements — Dashboard Domain Filter and Title/URL Search

**Slug:** `dashboard-filters`
**Status:** Awaiting approval (Phase 2)
**Depends on:** `docs/dashboard-login-navbar/requirements.md`

---

## 1. Goal

Let the dashboard user narrow the list of saved links by **domain** (a dropdown built from
the domains that actually exist) and by **free-text search** over the link **title and
URL/domain**. Filtering runs **in the database**, and the current filter state lives **in
the URL** so a filtered view can be reloaded, bookmarked, and shared.

---

## 2. Scope (in)

### 2.1 Domain filter
- A `<select>` in the dashboard header listing **only domains that exist in the database**,
  with a leading "All domains" option.
- Each option shows the domain and how many links it has (e.g. `www.indoav.com (2)`).
- Options are **always** computed from the whole table, not from the current result set, so
  switching from one domain to another always works.
- The list is ordered alphabetically.

### 2.2 Search
- A single text input that matches the link **title** OR the **url** (which covers the
  domain), case-insensitively, as a substring.
- Literal `%` and `_` typed by the user are treated as ordinary characters, not as SQL
  wildcards.
- Typing is debounced (~250 ms) so one keystroke does not equal one request; Enter applies
  immediately.

### 2.3 Filters combine
- Domain and query narrow the result together (AND).
- A "Clear filters" control appears only while a filter is active.
- The result count reads `N links` unfiltered and `N of M links` while filtered, where M is
  the total number of saved links.

### 2.4 Filters live in the URL
- `/?domain=www.indoav.com&q=hotel` — both parameters are optional.
- Reloading, bookmarking, or sharing the URL reproduces the same view.
- Applying a filter uses `router.replace` (no history spam) and does not jump the scroll
  position.

### 2.5 The domain becomes data, not a guess
- `links` gains a `domain` column (indexed), derived from the URL **once**, at the point
  where the URL is already parsed during validation.
- The userscript and `POST /api/links` request body are **unchanged**: the client still
  sends only `url`, `title`, `thumbnail`.
- Existing rows are backfilled by the migration, so no manual step is needed.

---

## 3. Out of scope

- Filtering or searching on `GET /api/links` (the userscript's read API stays as it is).
- Multi-select domains, date ranges, tag filters, or user-defined sort order.
- Server-side pagination: the dashboard still shows at most the 100 most recent matches.
- Remembering filters across visits (they live in the URL only, by request).
- Full-text search, fuzzy matching, or relevance ranking.

---

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Filtering in the database, not in the browser | Chosen by the owner; it also makes the count and the domain list reflect the whole table. |
| D2 | A stored, indexed `domain` column | Keeps `WHERE domain = ?` a simple indexed equality instead of a URL-parsing expression repeated in SQL. |
| D3 | The domain is derived in `parseLinkInput` | The URL is already parsed there, so derivation happens exactly once and is unit-tested. |
| D4 | Search covers title **and** url | Chosen by the owner. Matching the url also matches the domain. |
| D5 | Filters in the URL as `?q=` and `?domain=` | Chosen by the owner; bookmarkable and shareable. |
| D6 | `LIKE` with an escape clause | SQLite's `LIKE` is case-insensitive for ASCII, and escaping keeps `%`/`_` literal. |
| D7 | The 100-row cap stays | Unchanged from Module 1; the cap applies to the filtered result set. |
| D8 | `listDomains` excludes an empty domain | A row whose backfill failed still shows under "All domains" and via search, but is not offered as a filter value. |

---

## 5. Data flow

```
Browser  ──GET /?domain=www.indoav.com&q=hotel──▶ (app)/page.tsx (server)
                                                   ├─ resolveLinkFilters(searchParams)   pure
                                                   ├─ listLinks(db, { domain, query, limit })  WHERE + LIMIT
                                                   ├─ listDomains(db)                    GROUP BY domain
                                                   └─ countLinks(db)                     total for "N of M"
                                                 ▼
                                               LinkFilters (client) ── router.replace() ──▶ new URL
                                               LinkCard grid (server-rendered)

userscript ──POST /api/links {url,title,thumbnail}──▶ parseLinkInput derives domain ──▶ upsertLink stores it
```

---

## 6. Acceptance criteria

1. The dashboard shows a domain dropdown whose options are exactly the distinct domains in
   the database, plus "All domains".
2. Choosing a domain reloads the view with only that domain's links, and the URL contains
   `?domain=...`.
3. Typing in the search box narrows the list to links whose title or URL contains the text,
   after a short debounce; the URL contains `?q=...`.
4. Search is case-insensitive (`HOTEL` finds `hotel`).
5. A `%` or `_` in the search text matches those characters literally.
6. Domain and search combine, and the URL carries both parameters.
7. The count reads `N of M links` while a filter is active, and `N links` when not.
8. "Clear filters" resets both, and the URL returns to `/`.
9. Reloading a filtered URL reproduces the same filtered view; navigating back works.
10. Searching for something with no match shows a "no links match" state with a clear
    action, not the "no links yet" onboarding state.
11. A user with no links at all still sees the original onboarding empty state (no filter
    bar needed to make sense of it).
12. Saving a link records its domain, so it appears in the dropdown immediately.
13. The userscript flow, `POST /api/links`, `GET /api/links`, CORS, login, and the navbar
    all behave exactly as before.
14. `npm run test` (all suites), `npm run lint`, and `npm run build` are green.

---

## 7. Edge cases to handle

- `?domain=` empty, whitespace, repeated (`?domain=a&domain=b`), or absurdly long → treated
  as "all domains"; the first repeated value wins.
- `?q=` empty or whitespace → treated as "no search".
- `?q=` longer than the cap → truncated to the cap.
- `?domain=Example.com` → lowercased before comparison, because stored domains are
  lowercased.
- `?domain=nonexistent.example` → zero results with the "no match" state (not an error).
- A row saved before this change whose URL is unusual → backfilled best-effort; if the
  domain came out empty it is excluded from the dropdown but still listed normally.
- Filtering while the database is unreachable → the existing "database is not reachable"
  panel, unchanged.
- Only one domain in the database → the dropdown still renders and works.
