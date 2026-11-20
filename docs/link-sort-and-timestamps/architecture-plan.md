# Architecture Plan — Link Sort Order, Dual Timestamps, DB Indexes & Pagination

**Slug:** `link-sort-and-timestamps`
**Status:** Approved (Phase 2)
**Requirements:** `docs/link-sort-and-timestamps/requirements.md`

---

## 1. Approach

1. **Database Schema & Migration (`src/db/schema.ts`, `drizzle/0006_*.sql`)**:
   - Add `links_created_at_idx` on `links.createdAt` and `links_updated_at_idx` on
     `links.updatedAt`.
   - Generate the migration via `drizzle-kit` (or add the migration SQL + journal entry)
     so `createTestDatabase()` automatically applies it in all Vitest suites and
     `npm run db:push` / `npm run db:migrate` applies it to local and Turso databases.
2. **Repository (`src/db/links.ts`)**:
   - Export `type LinkSort = "created" | "updated"` and `type LinkOrder = "desc" | "asc"`.
   - Add `sort?: LinkSort` (default `"created"`) and `order?: LinkOrder` (default `"desc"`)
     to `ListLinksOptions`.
   - Order by `direction(orderColumn), direction(sql\`rowid\`)` where `direction` is
     `asc` when `options.order === "asc"` and `desc` otherwise.
3. **URL Filter State (`src/lib/link-filters.ts`)**:
   - Export `type LinkSort = "created" | "updated"`, `type LinkOrder = "desc" | "asc"`,
     and `MAX_PAGE = 10_000`.
   - Add `sort: LinkSort` (`"created"`), `order: LinkOrder` (`"desc"`), and `page: number`
     (`1`) to `LinkFilters` and `EMPTY_FILTERS`.
   - Add `resolveSort(raw)`, `resolveOrder(raw)`, and `resolvePage(raw)`.
   - Keep `hasActiveFilters` checking only narrowing filters (`query`, `domains`,
     `albums`, `albumNone`, `favorite`).
   - Update `clearLinkFilters(filters)` to preserve `view`, `sort`, and `order` while
     resetting `page: 1`.
   - Update `buildLinksHref(filters, basePath)` to append `sort=updated` (when
     `filters.sort === "updated"`), `order=asc` (when `filters.order === "asc"`), and
     `page=<N>` (when `filters.page > 1`).
4. **Components (`LinkCard`, `LinkList`, `LinkFilters`, `LinkPagination`, `LinkGrid`)**:
   - `LinkCard.tsx`: Show both `Created <time>` and `Updated <time>`.
   - `LinkList.tsx`: Show both `Created` and `Updated` columns on desktop and both
     timestamps on mobile.
   - `LinkFilters.tsx`: Add the **Sort** toggle (`Created` | `Updated`). Reset `page: 1`
     when changing search, modal filters, favorites, or sort; keep `page` when toggling
     `view`.
   - `LinkPagination.tsx` (new): Render Previous / Page N / Next links when
     `page > 1 || hasMore`.
   - `LinkGrid.tsx`: Accept `hasMore?: boolean`, render `LinkPagination` below the
     grid/list, and handle an empty page when `filters.page > 1` (e.g. a hand-edited
     `?page=99`) with a link back to page 1 even if no filters are active.
5. **Pages (`src/app/(app)/page.tsx`, `src/app/(app)/albums/[id]/page.tsx`,
   `src/app/locked/page.tsx`, `src/app/locked/albums/[id]/page.tsx`)**:
   - Query `listLinks` with `sort: filters.sort`, `limit: PAGE_LIMIT + 1`, and
     `offset: (filters.page - 1) * PAGE_LIMIT`.
   - Slice the first `PAGE_LIMIT` rows and pass `hasMore={rows.length > PAGE_LIMIT}` to
     `LinkGrid`.

---

## 2. File Mapping

### Created
| File | Purpose |
| --- | --- |
| `docs/link-sort-and-timestamps/requirements.md` | Phase 1 requirements |
| `docs/link-sort-and-timestamps/architecture-plan.md` | Phase 2 architecture plan |
| `drizzle/0006_*.sql` & `drizzle/meta/*` | SQL migration adding `links_created_at_idx` & `links_updated_at_idx` |
| `src/components/LinkPagination.tsx` | Previous / Page N / Next pagination controls |

### Modified
| File | Change |
| --- | --- |
| `src/db/schema.ts` | Add `links_created_at_idx` and `links_updated_at_idx` |
| `src/db/links.ts` | Add `sort?: LinkSort` to `ListLinksOptions`, default `createdAt DESC` |
| `src/lib/link-filters.ts` | Add `sort` and `page` to `LinkFilters`, `resolveSort`, `resolvePage`, `buildLinksHref`, `clearLinkFilters` |
| `src/components/LinkFilters.tsx` | Add Sort control (`Created` / `Updated`), reset `page: 1` on filter/sort changes |
| `src/components/LinkCard.tsx` | Display both `Created` and `Updated` timestamps |
| `src/components/LinkList.tsx` | Display both `Created` and `Updated` columns/timestamps |
| `src/components/LinkGrid.tsx` | Accept `hasMore`, render `LinkPagination` |
| `src/app/(app)/page.tsx` | Pass `sort`, `limit: PAGE_LIMIT + 1`, `offset`, `hasMore` |
| `src/app/(app)/albums/[id]/page.tsx` | Pass `sort`, `limit: PAGE_LIMIT + 1`, `offset`, `hasMore` |
| `src/app/locked/page.tsx` | Pass `sort`, `limit: PAGE_LIMIT + 1`, `offset`, `hasMore` |
| `src/app/locked/albums/[id]/page.tsx` | Pass `sort`, `limit: PAGE_LIMIT + 1`, `offset`, `hasMore` |
| `tests/link-filters.test.ts` | Unit tests for `sort` and `page` URL resolution, clearing, and building |
| `tests/links-repository.test.ts` | Unit tests for default `createdAt` sort, `updatedAt` sort, and index existence |
| `tests/link-card-affordances.test.ts` | Unit tests for dual timestamps in `LinkCard` & `LinkList` and `LinkPagination` |

---

## 3. Execution Steps (TDD)

1. **Step 1 — Schema & Migration (`0006`) + Repository (`src/db/links.ts`)**:
   - **RED:** Write failing tests in `tests/links-repository.test.ts` for default
     `createdAt` ordering (across edits and re-saves) and `sort: "updated"` ordering.
   - **GREEN:** Update `src/db/schema.ts`, generate migration `0006`, and update
     `src/db/links.ts`.
2. **Step 2 — URL Filter State (`src/lib/link-filters.ts`)**:
   - **RED:** Write failing tests in `tests/link-filters.test.ts` for `sort` and `page`.
   - **GREEN:** Implement `resolveSort`, `resolvePage`, and update `LinkFilters` helpers
     in `src/lib/link-filters.ts`.
3. **Step 3 — UI Components & Pages**:
   - **RED:** Write failing markup tests in `tests/link-card-affordances.test.ts` for
     `LinkCard`, `LinkList` (both `Created` and `Updated` rendered), and
     `LinkPagination`.
   - **GREEN:** Update `LinkCard.tsx`, `LinkList.tsx`, `LinkFilters.tsx`,
     `LinkPagination.tsx`, `LinkGrid.tsx`, and the 4 page files.
4. **Step 4 — Final Verification**:
   - Run `npm test`, `npm run lint`, and `npm run build`.
