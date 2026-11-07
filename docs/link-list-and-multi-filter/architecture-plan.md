# Architecture Plan — List View and Multi-Category Filter Modal

**Slug:** `link-list-and-multi-filter`
**Status:** Awaiting approval (Phase 2)
**Requirements:** `docs/link-list-and-multi-filter/requirements.md`

---

## 1. Approach

Keep the server-rendered, URL-as-source-of-truth architecture. Extend the filter
state from scalar values to two include/exclude lists per category, normalise them in
one pure module, and translate them to SQL conditions in the existing repository.
The modal is a controlled client component over the same pure state helpers; it never
queries anything itself.

---

## 2. Module boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/link-filters.ts` (modified) | Parse/normalise the URL, build it back, count active filters. Pure. | — |
| `src/lib/filter-selection.ts` (new) | Pure include/exclude state helpers shared by the modal and its tests. | — |
| `src/db/links.ts` (modified) | Apply domain/album include-exclude conditions in SQL. | drizzle-orm |
| `src/components/MultiCategoryFilterModal.tsx` (new) | The generic modal: sidebar, search, All, dual-list, footer. | `filter-selection` |
| `src/components/LinkFilters.tsx` (rewritten) | Search, Filter button, view switch, favorites, clear, lock; adapts app state to the modal. | modal, `link-filters` |
| `src/components/LinkList.tsx` (new) | Detailed row rendering. | `LinkCover`, `LinkCard` pieces |
| `src/components/LinkGrid.tsx` (modified) | Pick grid or list from `filters.view`. | `LinkList` |
| `src/components/NoMatches.tsx` (modified) | Describe the new filters; clear while keeping the view. | `link-filters` |
| Four page files (modified) | Pass the new filter options and album names down. | repository |

---

## 3. Data structures

### 3.1 App filter state

```ts
export interface CategorySelection {
  include: string[];
  exclude: string[];
}

export type LinkView = "grid" | "list";

export interface LinkFilters {
  query: string;
  domains: CategorySelection;   // domain strings
  albums: CategorySelection;    // album ids
  albumNone: boolean;           // "Not in an album"
  favorite: boolean;
  view: LinkView;
}
```

`EMPTY_CATEGORY` / `EMPTY_FILTERS` constants keep every default in one place.
`clearLinkFilters(filters)` resets every filter but preserves `view`.

### 3.2 Modal state

```ts
export type FilterColumn = "include" | "exclude";
export type FilterSelection = Record<string, CategorySelection>;

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterCategory {
  id: string;
  label: string;
  options: readonly FilterOption[];
  /** Pinned, exclusive toggles such as "Not in an album". */
  specials?: readonly FilterOption[];
}
```

The modal's `onApply(selection)` returns exactly `FilterSelection`.

### 3.3 Repository options (additive)

```ts
export interface ValueSelection {
  include: readonly string[];
  exclude: readonly string[];
}

export interface ListLinksOptions extends ScopeOptions {
  // ...existing...
  domains?: ValueSelection;
  albums?: ValueSelection;      // album ids, scope-checked in SQL
}
```

`albumMembership` stays and carries the "Not in an album" case (`"none"`); the page
maps `filters.albumNone` onto it. The legacy `domain?: string` shorthand stays for the
existing repository tests and is ANDed with `domains`.

---

## 4. SQL

Domain include/exclude use `inArray` / `notInArray` on `links.domain` (the column is
`NOT NULL`, so `NOT IN` is safe).

Album include/exclude share one scope-aware `EXISTS` fragment:

```sql
EXISTS (
  SELECT 1
  FROM album_links al
  INNER JOIN albums a ON a.id = al.album_id
  WHERE al.link_id = links.id
    AND a.scope = :scope
    AND al.album_id IN (:ids)
)
```

- include: the fragment above;
- exclude: `NOT (fragment)`;
- both: include AND exclude;
- `albumNone`: the existing `NOT EXISTS` membership condition.

The scope join means a light page cannot be filtered by a locked album's membership
and vice versa, even if the URL names one.

---

## 5. Component behaviour

### 5.1 `MultiCategoryFilterModal`

- Mounted only while open (`{open ? <Modal/> : null}`), so the draft starts from the
  committed value without a sync effect.
- Local state: `draft`, `activeCategoryId`, per-category search text.
- Initialising a category puts **every option in Include (checked)** when there are no
  committed excludes, and re-applies committed excludes uncheck to the Exclude side
  (a legacy include whitelist is honoured the same way). The columns therefore mirror
  each other: every option is on exactly one side.
- `toggleMembership` flips one value: unchecking in Include moves it to Exclude, and
  checking in Exclude moves it back to Include. The pure helper keeps the lists
  disjoint.
- The All control is tri-state (none / some / all of the **filtered** options) and
  moves the whole visible set: checked → Include, cleared → Exclude.
- Specials are rendered as pill buttons; checking one includes only it and pushes
  every ordinary option to Exclude; checking an option clears the special.
- Each option's count badge sits on the right of the label with distinct styling.
- Footer: Clear re-builds the draft with every option included; Apply calls `onApply`.
- Closes on X, backdrop click, and Escape; the search input is focused on open.
- Light and dark classes, matching the rest of the dashboard.

### 5.2 Adapter in `LinkFilters`

```ts
const ALBUM_NONE = "__none__";
```

- Modal value receives the committed category selections; the Album category maps
  `albumNone` to the special value and vice versa.
- The adapter persists **only the excluded values** (`include: []`), so:
  - the URL stays compact (`?domainExclude=…` instead of the full included list);
  - a domain or album added to the database later is included by default;
  - legacy `?domain=` whitelist links still resolve and are re-encoded on Apply.
- The Filter badge counts the excluded values per category plus `albumNone`.

### 5.3 List view

`LinkGrid` reads `filters.view`:

- `grid` → today's `<ul class="grid …">` with `LinkCard`;
- `list` → `<LinkList>`: a detail **table** (Title, Domain, Albums, Updated,
  Actions) with no thumbnails.

Both stay inside the existing `SelectionProvider` / `SelectAllToggle` /
`SelectionBar` wrapper, so bulk selection keeps working in either view.

The table is a client component: clicking a row opens the link in a new tab (the title
is a plain link too), clicks on the action buttons or the selection checkbox do not
open it, and a `tabIndex` row opens on Enter. `LinkList` reuses `LinkActions` and
`AlbumMembershipLabel`, so the list view never changes what a link can do.

---

## 6. File mapping

### Created
| File | Purpose |
| --- | --- |
| `src/lib/filter-selection.ts` | Pure include/exclude helpers |
| `src/components/MultiCategoryFilterModal.tsx` | Generic filter modal |
| `src/components/LinkList.tsx` | Detailed list rows |
| `tests/filter-selection.test.ts` | Modal state rules |
| `docs/link-list-and-multi-filter/*.md` | These documents |

### Modified
| File | Change |
| --- | --- |
| `src/lib/link-filters.ts` | New filter shape, repeated params, view, clear helper |
| `src/db/links.ts` | `domains` / `albums` selections |
| `src/components/LinkFilters.tsx` | New bar + modal adapter |
| `src/components/LinkGrid.tsx` | Grid/list switch |
| `src/components/NoMatches.tsx` | New descriptions + clear href |
| `src/app/(app)/page.tsx` | Pass selections and albums |
| `src/app/(app)/albums/[id]/page.tsx` | Drop album selection, pass view |
| `src/app/locked/page.tsx` | Pass selections and albums |
| `src/app/locked/albums/[id]/page.tsx` | Drop album selection, pass view |
| `tests/link-filters.test.ts` | Rewritten for the new URL contract |
| `tests/links-repository.test.ts` | Domain/album include-exclude coverage |

### Unchanged (deliberately)
Schema, migrations, ingestion API, userscript, auth, album CRUD, selection logic.

---

## 7. Execution checklist (TDD)

1. **RED** `tests/filter-selection.test.ts` → **GREEN** `src/lib/filter-selection.ts`.
2. **RED** rewrite `tests/link-filters.test.ts` → **GREEN** `src/lib/link-filters.ts`.
3. **RED** extend `tests/links-repository.test.ts` → **GREEN** `src/db/links.ts`.
4. Build `MultiCategoryFilterModal.tsx`.
5. Rewrite `LinkFilters.tsx`; build `LinkList.tsx`; wire `LinkGrid` and `NoMatches`.
6. Update the four pages.
7. Verify: `npm run test`, `npm run lint`, `npm run build`, then a manual pass on
   port 4200 for grid/list, include/exclude, not-in-album, legacy URLs, the album
   page, and the locked page.

**Checkpoints:** after step 3 (data layer proven) and after step 6 (UI complete).

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| URL grows with many values | Cap values per list and per value length in the resolver. |
| A value in both columns | Normaliser keeps include only; the UI also enforces it. |
| Deleted album id in an old URL | Matches nothing, is visible by id in the modal, and Clear removes it. |
| Locked album id on the light page | The SQL `EXISTS` joins `albums.scope`, so it cannot match. |
| Debounced search racing a modal Apply | Both write the full filter object through the same URL builder; the last navigation wins and the server re-reads the URL. |
| List rows breaking bulk selection | Both views render inside the same selection provider and reuse `LinkCover`'s checkbox. |
