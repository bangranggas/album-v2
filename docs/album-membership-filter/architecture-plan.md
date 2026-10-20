# Architecture Plan — Filter links by album membership

**Slug:** `album-membership-filter`
**Status:** Phase 2 (approved and implemented)
**Requirements:** `docs/album-membership-filter/requirements.md`

---

## 1. Approach

Three small, independent layers:

1. **Pure URL logic** (`src/lib/link-filters.ts`) gains one field, one resolver, and one line in
   the href builder. No React, no database.
2. **One SQL predicate** (`src/db/links.ts`) turns `"in" | "none"` into `EXISTS` / `NOT EXISTS`
   over `album_links` joined to `albums` on the caller's scope.
3. **One `<select>`** (`src/components/LinkFilters.tsx`) writes the value into the URL; the two
   Links pages forward it to the repository, and the two album pages strip it.

No schema change, no migration, no API change, and no new dependency.

---

## 2. File map

| File | Action | Purpose |
| --- | --- | --- |
| `src/lib/link-filters.ts` | modify | `album` field, `resolveAlbumFilter`, `hasActiveFilters`, `buildLinksHref` |
| `src/db/links.ts` | modify | `AlbumMembershipFilter`, `albumMembershipCondition`, `ListLinksOptions.albumMembership` |
| `src/components/LinkFilters.tsx` | modify | the Album dropdown; preserve `album` in every navigation; `showAlbumFilter` prop |
| `src/app/(app)/page.tsx` | modify | pass the option to `listLinks`; render the dropdown |
| `src/app/locked/page.tsx` | modify | same for the locked side |
| `src/app/(app)/albums/[id]/page.tsx` | modify | strip `album` from the resolved filters |
| `src/app/locked/albums/[id]/page.tsx` | modify | same |
| `src/components/NoMatches.tsx` | modify | name the album condition; clear it in the reset link |
| `tests/link-filters.test.ts` | modify | resolver, active-state, href order, round-trip |
| `tests/links-repository.test.ts` | modify | `in` / `none`, side scoping, no duplicates, combinations |
| `README.md` | modify | filters section, tests table, probe row |
| `docs/album-membership-filter/*.md` | create | this plan and the requirements |
| `%TEMP%/opencode/e2e-membership-filter.mjs` | create | end-to-end probe (not committed) |

No files are deleted. `SelectCheckbox.tsx` and the other components from the previous feature
are untouched.

---

## 3. Steps

### Step 1 — URL model (`src/lib/link-filters.ts`)

```ts
/** `""` means "no album filter"; the other two are the dropdown's values. */
export type AlbumFilter = "" | "in" | "none";

export interface LinkFilters {
  query: string;
  domain: string;
  album: AlbumFilter;
  favorite: boolean;
}

export function resolveAlbumFilter(raw: RawSearchParams): AlbumFilter {
  const value = firstValue(raw.album).trim().toLowerCase();

  return value === "in" || value === "none" ? value : "";
}
```

- `resolveLinkFilters` calls it and includes `album`.
- `hasActiveFilters` adds `filters.album !== ""`.
- `buildLinksHref` writes `params.set("album", filters.album)` after `domain` and before `q`,
  so the order stays `domain, album, q, favorite`. Existing URLs are unchanged when `album`
  is empty.

### Step 2 — SQL predicate (`src/db/links.ts`)

```ts
export type AlbumMembershipFilter = "in" | "none";

function albumMembershipCondition(
  filter: AlbumMembershipFilter | undefined,
  scope: LinkScope,
): SQL | undefined {
  if (filter === undefined) return undefined;

  // `all` is only used by tests/tools: count membership across both sides.
  const scoped =
    scope === "all" ? sql`` : sql` AND ${albums.scope} = ${scope}`;

  const exists = sql`EXISTS (
    SELECT 1
    FROM ${albumLinks}
    INNER JOIN ${albums} ON ${albums.id} = ${albumLinks.albumId}
    WHERE ${albumLinks.linkId} = ${links.id}${scoped}
  )`;

  return filter === "in" ? exists : sql`NOT ${exists}`;
}
```

- `ListLinksOptions` gains `albumMembership?: AlbumMembershipFilter`.
- `listLinks` pushes the predicate right after the album-id condition.
- `countLinks` is **not** changed: the page's `M` stays the whole side's total (D6).
- `EXISTS` returns one row per link even when it is in several albums, and the correlated
  lookup on `album_links.link_id` uses `album_links_link_idx`.

### Step 3 — The control (`src/components/LinkFilters.tsx`)

- New prop `showAlbumFilter?: boolean` (default `false`), so the two album pages do not get a
  control that cannot change anything (D8).
- Destructure `album` next to `query`, `domain`, `favorite`.
- Add `album` to **every** `navigate({ … })` call: the debounced search, the form submit, the
  domain change, and the favorites toggle.
- New block after Domain:

```tsx
{showAlbumFilter ? (
  <div className="flex flex-col gap-1.5">
    <label htmlFor="link-album" className="…">Album</label>
    <select
      id="link-album"
      value={album}
      onChange={(event) =>
        navigate({ query: text.trim(), domain, album: event.target.value as AlbumFilter, favorite })
      }
      className={`w-full bg-white sm:w-44 dark:bg-slate-950 ${FIELD}`}
    >
      <option value="">All</option>
      <option value="in">In an album</option>
      <option value="none">Not in an album</option>
    </select>
  </div>
) : null}
```

- `Clear filters` resets `{ query: "", domain: "", album: "", favorite: false }`.

### Step 4 — Pages

`src/app/(app)/page.tsx` and `src/app/locked/page.tsx`:

- `listLinks(…, { albumMembership: filters.album === "" ? undefined : filters.album, … })`
  (with their existing `scope`).
- `<LinkFilters … showAlbumFilter />`.

`src/app/(app)/albums/[id]/page.tsx` and `src/app/locked/albums/[id]/page.tsx`:

```ts
const filters = { ...resolveLinkFilters(await searchParams), album: "" as const };
```

so a shared `?album=none` cannot affect the album's list, count line, or empty state (D7),
and the next interaction rebuilds the URL without it.

### Step 5 — "No matches" copy (`src/components/NoMatches.tsx`)

- Add to the description: `filters.album === "in" ? "links in an album" : "links not in any album"`.
- The reset link becomes `{ query: "", domain: "", album: "", favorite: false }`.
- The hint sentence gains "…or album".

### Step 6 — Tests (red first)

`tests/link-filters.test.ts`:

- `NONE` gains `album: ""`.
- `resolveAlbumFilter`: absent, `in`, `none`, `IN`, invalid, empty, repeated, whitespace.
- `hasActiveFilters` is true for each non-empty value.
- `buildLinksHref`: `/?album=in`; full order `domain, album, q, favorite`; round-trip through
  `resolveLinkFilters`; `All` writes nothing.
- `buildTabHref` never carries `album`.

`tests/links-repository.test.ts` (temporary SQLite per test, existing helper):

- Seed: 2 visible links, 2 locked links; a visible album with both visible links; a second
  visible album with one of them; a locked album with one locked link.
- `in` on visible → both visible links, **once each**.
- `none` on visible → none (or the one left out of every album).
- Add a visible link that is only in a locked album (inserted directly) → `none` on visible,
  proving side scoping.
- `in` on locked → only the locked member.
- Combination with `albumId`, `domain`, `query`, `favorite`.
- `limit` applies after the filter.
- `scope: "all"` counts both sides.

Expected: ~15 new unit/integration tests (baseline 830 tests / 31 files).

### Step 7 — Probe

`%TEMP%/opencode/e2e-membership-filter.mjs`, against a fresh production server on `:4300`
with `local.db`:

1. Log in (`DASHBOARD_PASSWORD`) and unlock (`LOCKED_PASSCODE`).
2. Create two visible links and one locked link through `POST /api/dashboard/links`, plus one
   album per side through `POST /api/dashboard/albums`; file one visible and one locked link
   through the membership endpoint.
3. Assert raw HTML (no JS needed):
   - `/?album=in` contains the filed title and not the loose one; count line `1 of N links`;
     the `<option value="in" selected>` is present.
   - `/?album=none` is the inverse.
   - `/?album=junk` behaves like `/` (no `selected` on `in`/`none`).
   - `/locked?album=in` and `none` likewise, and the locked album name never appears on `/`.
   - `/albums/<visible id>?album=none` lists the same links as without the parameter and does
     not render the Album select.
   - The "Clear filters" href contains no `album=`.
4. Delete the created links and albums through the API, then verify the counts return to the
   values from before the probe.
5. Then run the five existing probes unchanged.

### Step 8 — README

- Filters paragraph: the Album dropdown on both Links tabs, its three states, side scoping,
  URL parameter.
- Tests table: new rows for `link-filters` and `links-repository`; probe row.
- File tree: no new source files, so only the descriptions change if needed.

---

## 4. Data flow

```
searchParams ─▶ resolveLinkFilters ─┬─▶ listLinks({ albumMembership, scope, … }) ─▶ rows
                                    └─▶ LinkFilters (value = filters.album)
LinkFilters ─▶ buildLinksHref ─▶ router.replace ─▶ new searchParams
```

Nothing is cached across requests (`force-dynamic`), and nothing new is stored: the filter is
derived entirely from `album_links` + `albums.scope`.

---

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A JOIN-based implementation would duplicate links that sit in several albums. | `EXISTS`, never a join, plus an explicit test. |
| A light page could count a locked album's membership and leak its existence. | The subquery filters `albums.scope = <page scope>`; a test seeds a cross-side membership and asserts it is invisible. |
| Adding a required field to `LinkFilters` silently breaks literals. | TypeScript flags every literal; fix `NoMatches`, the tests, and both album pages in the same commit. |
| The dropdown could appear on album pages by accident. | Opt-in prop (`showAlbumFilter`), plus a probe assertion that those pages do not render it. |
| A shared `?album=` URL could make an album page's count lie. | Album pages strip the field before use. |
| The extra predicate could slow the list query. | `EXISTS` on an indexed `link_id`, evaluated per row after the scope/domain filters; the table is small (hundreds of rows). |

---

## 6. Definition of done

- All acceptance criteria in the requirements are demonstrated by a test or the probe.
- `npm run test` (expected ~845 tests), `npm run lint`, `npm run build` green.
- The new probe and the five existing probes pass on a fresh server.
- `local.db` still contains the owner's 4 links, 2 albums, and 3 locked domains.
- README and `docs/album-membership-filter/` describe the shipped behavior.
- One commit, English message, no debug artifacts.
