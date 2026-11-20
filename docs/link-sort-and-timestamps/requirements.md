# Requirements — Link Sort Order, Dual Timestamps, DB Indexes & Pagination

**Slug:** `link-sort-and-timestamps`
**Status:** Approved (Phase 1)
**Depends on:** `docs/link-list-and-multi-filter`, `docs/agent-bridge`

---

## 1. Goal

1. **Preserve Original Upload Order by Default:** Order links by `createdAt DESC, rowid DESC`
   by default so that when Hermes Agent adds/edits a `summary` (or when a link is edited
   or re-saved), it stays in its original upload position rather than jumping to the top.
2. **Flexible Sort Control:** Add a **Sort** toggle (`Created` | `Updated`) in the
   dashboard filter bar (`?sort=updated`) so the user can view links ordered either by
   initial upload date (`createdAt`) or last update date (`updatedAt`).
3. **Display Both Timestamps:** Show both `createdAt` (Created) and `updatedAt` (Updated)
   on every link card (`LinkCard`) and table row (`LinkList`).
4. **Turso Free-Tier Performance Indexes:** Add database indexes on `links.created_at`
   and `links.updated_at` so `ORDER BY ... LIMIT ...` queries use B-Tree index scans
   instead of full-table scans.
5. **Pagination:** Allow browsing past the first 100 links via `?page=N` (1-based,
   100 links per page) using the `(limit + 1)` lookahead pattern so no extra `COUNT(*)`
   query is needed to detect whether a next page exists.

---

## 2. Scope

### 2.1 Database Indexes (`src/db/schema.ts` & Drizzle migration `0006`)

- Add `index("links_created_at_idx").on(table.createdAt)` and
  `index("links_updated_at_idx").on(table.updatedAt)` to `links`.
- Generate a Drizzle SQL migration (`drizzle/0006_*.sql`) creating both indexes.

### 2.2 Repository Ordering (`src/db/links.ts`)

- Add `LinkSort = "created" | "updated"` and `LinkOrder = "desc" | "asc"`, plus
  `sort?: LinkSort` and `order?: LinkOrder` to `ListLinksOptions`.
- Default sort is `"created"` and default order is `"desc"` (`ORDER BY links.created_at DESC, links.rowid DESC`).
- When `order === "asc"`, order ascending (`ORDER BY <col> ASC, links.rowid ASC`).
- Editing a link (`updateLink`) or re-saving (`upsertLink` / `saveLinkForAgent`) still
  updates `updatedAt` while leaving `createdAt` untouched.

### 2.3 URL State: Sort, Order & Pagination (`src/lib/link-filters.ts`)

- Extend `LinkFilters` with:
  - `sort: LinkSort` (`"created" | "updated"`, default `"created"`)
  - `order: LinkOrder` (`"desc" | "asc"`, default `"desc"`)
  - `page: number` (positive integer `>= 1`, default `1`, capped at `MAX_PAGE = 10_000`)
- `resolveSort(raw)`: returns `"updated"` when `raw.sort` is `"updated"` (case-insensitive,
  trimmed); otherwise `"created"`.
- `resolveOrder(raw)`: returns `"asc"` when `raw.order` is `"asc"` (case-insensitive,
  trimmed); otherwise `"desc"`.
- `resolvePage(raw)`: parses a 1-based integer `>= 1` from `raw.page`; invalid, zero,
  negative, or non-numeric values fall back to `1`.
- `hasActiveFilters(filters)`: returns `true` only when a narrowing filter (`query`,
  `domains`, `albums`, `albumNone`, `favorite`) is active. Neither `view`, `sort`, `order`,
  nor `page` is a narrowing filter.
- `clearLinkFilters(filters)`: resets narrowing filters and resets `page` to `1`, while
  preserving `view`, `sort`, and `order`.
- Changing any filter or sort/order in `LinkFilters` resets `page` to `1`; switching `view`
  (`grid` ↔ `list`) keeps the current `page`, `sort`, and `order`.
- `buildLinksHref(filters, basePath)`:
  - Writes `sort=updated` only when `filters.sort === "updated"`.
  - Writes `order=asc` only when `filters.order === "asc"`.
  - Writes `page=<N>` only when `filters.page > 1`.

### 2.4 Dashboard Filter Bar & Pagination Bar

- **`LinkFilters.tsx`**:
  - Adds a **Sort** segmented button group (`Created` / `Updated`) next to **View**
    (`Grid` / `List`).
  - Resets `page: 1` whenever search text, modal filters, favorites, or sort changes.
  - Preserves `page` when toggling `view` (`Grid` / `List`).
- **`LinkPagination.tsx` (rendered by `LinkGrid.tsx`)**:
  - Pages fetch `limit: PAGE_LIMIT + 1` (`101`) with `offset: (filters.page - 1) * PAGE_LIMIT`.
  - `hasMore = rows.length > PAGE_LIMIT`, and the page renders `rows.slice(0, PAGE_LIMIT)`.
  - When `filters.page > 1` or `hasMore` is true, renders a clean pagination bar below
    the grid/list with **Previous** (`page - 1`), current page indicator (`Page N`),
    and **Next** (`page + 1`) links built via `buildLinksHref`.
  - Works seamlessly with `SelectionProvider` (selections made on page 1 remain tracked
    as `outOfView` when navigating to page 2).

### 2.5 Displaying Both `createdAt` and `updatedAt`

- **`LinkCard.tsx`**:
  - Displays both `Created <relative>` (`link.createdAt`) and `Updated <relative>`
    (`link.updatedAt`) in the card metadata line.
- **`LinkList.tsx`**:
  - Desktop table has both **Created** (`link.createdAt`) and **Updated**
    (`link.updatedAt`) columns.
  - Mobile folded metadata shows both `Created <relative>` and `Updated <relative>`.

---

## 3. URL Contract

| Parameter | Meaning | Default |
| --- | --- | --- |
| `sort` | `updated` = sort by `updatedAt DESC` | Omitted (`created` = sort by `createdAt DESC`) |
| `page` | `2`, `3`, … = 1-based page number (`100` links/page) | Omitted (`1`) |

Parameter order in `buildLinksHref`:
`domain` → `domainExclude` → `albumNone` / (`album` → `albumExclude`) → `q` → `favorite` → `sort` → `view` → `page`.

---

## 4. Edge Cases

| Case | Expected behaviour |
| --- | --- |
| Agent updates `summary` | `updatedAt` updates, `createdAt` stays. Under default `sort=created`, link position does not move. Under `sort=updated`, link moves to top. |
| Re-save via userscript / AddLinkForm | `updatedAt` updates, `createdAt` stays. Under default `sort=created`, link position does not move. |
| Invalid `?sort=xyz` or `?page=-5` / `?page=abc` | Normalises to `sort: "created"` and `page: 1`. |
| `?page=5` when fewer than 400 links match | Query returns 0 rows on page 5; `LinkGrid` shows a "No links on this page" / "Back to page 1" or `Previous` pagination control so the user is never stranded. |
| Changing search/filter/sort while on `?page=3` | Resets to `page: 1` so the user does not land on an empty high page number. |
| Toggling `Grid` ↔ `List` while on `?page=2&sort=updated` | Keeps both `page=2` and `sort=updated`. |
