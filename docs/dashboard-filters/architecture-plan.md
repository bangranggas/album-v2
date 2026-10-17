# Architecture Plan — Dashboard Domain Filter and Title/URL Search

**Slug:** `dashboard-filters`
**Status:** Awaiting approval (Phase 2)
**Requirements:** `docs/dashboard-filters/requirements.md`

---

## 1. Approach

Add one real column — `links.domain` — derived once during validation, indexed, and
backfilled by a data migration. Filtering then becomes ordinary SQL:

```sql
WHERE domain = ? AND (title LIKE ? ESCAPE '\' OR url LIKE ? ESCAPE '\')
LIMIT 100
```

The dashboard stays a server component that reads `searchParams`; a small client component
owns only the two controls and pushes the new URL. No new API endpoint, no client-side
filtering, no library.

---

## 2. Module boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/link-filters.ts` | Normalise `?q=` / `?domain=` and build the URL back. Pure, no I/O. | — |
| `src/lib/validation.ts` (modified) | Derive `domain` while the URL is already parsed. | zod |
| `src/db/schema.ts` (modified) | Declare `domain` + its index. | drizzle-orm |
| `src/db/links.ts` (modified) | `listLinks({ domain, query, limit })`, `listDomains`, `countLinks`. The only SQL. | drizzle-orm |
| `src/app/(app)/page.tsx` (modified) | Read `searchParams`, run the three queries, pick the right empty state. | repo, filters |
| `src/components/LinkFilters.tsx` (new) | The dropdown, the search box, the clear button; pushes URLs. | `next/navigation`, `link-filters` |
| `src/components/LinkCard.tsx` (modified) | Show the stored `domain` instead of re-parsing the URL. | — |

---

## 3. Data structures

**Schema**

```ts
domain: text("domain").notNull(),            // lowercased host, e.g. "www.indoav.com"
// index("links_domain_idx").on(table.domain)
```

**Migration `drizzle/0001_*.sql`** (generated, then the backfill appended by hand)

```sql
ALTER TABLE `links` ADD COLUMN `domain` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `links_domain_idx` ON `links` (`domain`);
--> statement-breakpoint
UPDATE `links` SET `domain` = lower(
  CASE
    WHEN instr(substr(`url`, instr(`url`, '://') + 3), '/') > 0
      THEN substr(substr(`url`, instr(`url`, '://') + 3), 1,
                  instr(substr(`url`, instr(`url`, '://') + 3), '/') - 1)
    ELSE substr(`url`, instr(`url`, '://') + 3)
  END
) WHERE `domain` = '';
```

The `DEFAULT ''` exists only so the column can be added to a populated table; the backfill
then fills it. The app always writes an explicit value.

**Filter state**

```ts
interface LinkFilters { query: string; domain: string }   // "" means "not filtering"
interface DomainOption { domain: string; count: number }
```

**URL** — `/?domain=<domain>&q=<query>`, each omitted when empty.

---

## 4. File mapping

### Created
| File | Purpose |
| --- | --- |
| `src/lib/link-filters.ts` | `MAX_QUERY_LENGTH`, `MAX_DOMAIN_LENGTH`, `resolveLinkFilters`, `buildLinksHref`, `hasActiveFilters` |
| `src/components/LinkFilters.tsx` | Domain `<select>` + search `<input>` + clear, debounced URL updates |
| `drizzle/0001_*.sql` + `drizzle/meta/0001_snapshot.json` | Column, index, backfill |
| `tests/link-filters.test.ts` | Normalisation, URL building |
| `tests/helpers/…` | unchanged (the helper already reads every `drizzle/*.sql`) |
| `docs/dashboard-filters/*.md` | These documents |

### Modified
| File | Change |
| --- | --- |
| `src/db/schema.ts` | `domain` column + `links_domain_idx` |
| `src/db/links.ts` | `listLinks` gains `domain`/`query`; new `listDomains`, `countLinks`; `upsertLink` stores `input.domain` |
| `src/lib/validation.ts` | `LinkInput` gains `domain`; derive it from the parsed URL |
| `src/app/(app)/page.tsx` | Read `searchParams`, run queries, render filters, choose the empty state |
| `src/components/LinkCard.tsx` | Display `link.domain` (fallback to parsing for a legacy empty value) |
| `tests/links-repository.test.ts` | Domain persistence, filters, counts, `listDomains` |
| `tests/validation.test.ts` | Derived domain (lowercase, port kept, userinfo dropped) |
| `README.md` | Document the filters and the new column |

### Unchanged (deliberately)
`src/app/api/links/route.ts` (the request body is untouched), `src/types/api.ts`,
`src/proxy.ts`, the auth stack, `userscript/**`.

> Note: `toApiLink` keeps returning only the Module 1 fields. `domain` is an internal
> column, so the wire format and the userscript do not change.

---

## 5. Key implementation notes

1. **Escape `LIKE` input.** A tiny helper escapes `\`, `%`, and `_` and the query uses
   `ESCAPE '\'`, so a search for `100%` means "100%", not "100" plus anything.
2. **Order of `WHERE` and `LIMIT`.** Both live in one Drizzle query, so the 100-row cap
   applies to the filtered set — filtering never "loses" rows to the cap.
3. **Three queries per dashboard load** (`listLinks`, `listDomains`, `countLinks`) run via
   `Promise.all` against the same cached libSQL handle.
4. **The dropdown is always built from the whole table**, so an active filter cannot hide
   the option needed to switch to another domain.
5. **URL writes go through one pure builder** (`buildLinksHref`), shared by the client
   component and any server-rendered link, so they cannot drift.
6. **No `useSearchParams`.** The server passes the current values down as props, which keeps
   the client component free of a Suspense requirement.
7. **Debounce lives in the component** (250 ms) and is cancelled on unmount; Enter applies
   immediately.
8. **Empty states are distinct:** no rows at all → `EmptyState`; rows exist but none match →
   a new "no matches" panel that offers to clear the filters.

---

## 6. Execution checklist (Phase 5 order)

1. **RED** `tests/link-filters.test.ts` → **GREEN** `src/lib/link-filters.ts`.
2. **RED** extend `tests/validation.test.ts` for the derived `domain` → **GREEN**
   `src/lib/validation.ts` (returns `domain`).
3. Schema: add `domain` + index, run `npm run db:generate`, then append the backfill
   statement to the generated migration. Apply with `npm run db:push` and confirm the five
   existing rows got their domains.
4. **RED** extend `tests/links-repository.test.ts` → **GREEN** `src/db/links.ts`
   (`listLinks` filters, `listDomains`, `countLinks`, `upsertLink` domain).
5. Build `src/components/LinkFilters.tsx`, update `LinkCard`, rewire
   `src/app/(app)/page.tsx`, and add the "no matches" panel.
6. Update `README.md` (filters + `domain` column).
7. Verify: `npm run test`, `npm run lint`, `npm run build`, then an end-to-end pass on port
   4200 driving `?domain=`/`?q=` and checking the dropdown, counts, and empty states.

**Checkpoints:** after step 4 (data layer proven) and after step 5 (UI complete) before the
README and final verification.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| A migration that adds a `NOT NULL` column fails on the populated table | Add it with `DEFAULT ''`, backfill, and verify against the real `local.db`. |
| The backfill mis-parses an exotic legacy URL | Best-effort only: the stored value is what the dropdown offers and what the filter matches, so the view stays self-consistent; the row remains visible unfiltered. |
| `LIKE` is only ASCII case-insensitive | Documented; acceptable for the titles in use, and consistent for both sides of the comparison. |
| A debounced request racing a fast domain change | The URL is the single source of truth; the last write wins and the server always re-reads `searchParams`. |
| `drizzle-kit generate` producing a destructive diff | Diff the generated SQL before applying; the intended DDL is exactly add-column, add-index, update. |
