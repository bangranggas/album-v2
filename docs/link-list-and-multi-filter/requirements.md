# Requirements — List View and Multi-Category Filter Modal

**Slug:** `link-list-and-multi-filter`
**Status:** Awaiting approval (Phase 1)
**Depends on:** `docs/dashboard-filters`, `docs/album-membership-filter`, `docs/albums`, `docs/album-scope`

---

## 1. Goal

Replace the single-value Domain/Album dropdowns with one filter experience that can
include **and** exclude several values per category, and add a detailed list view next
to the existing card grid.

---

## 2. Scope

### 2.1 View mode (grid / list)

- The filter bar gets a two-state view switch: **Grid** (today's card grid) and
  **List** (a detailed row list).
- The choice lives in the URL as `view=list`; the default (grid) writes no parameter.
  A refresh, bookmark, shared link, and the back button all agree.
- Applies to every page that renders links: the Links tab, an album's page, and the
  locked twins.
- The list is a **detail table** with no thumbnails: a Title column (linked), Domain,
  Albums, Updated, and a rightmost Actions column with the same per-link actions as a
  card (favorite, add to album, thumbnail, edit, delete, remove-from-album).
- **Clicking anywhere on a row opens the link** in a new tab; clicks on the action
  buttons or the selection checkbox do not open it.
- The bulk-selection checkbox (where the page is selectable) leads each row instead of
  riding on a cover image.
- Switching the view is **not** a filter: it does not make the "Clear filters" button
  appear, and clearing filters keeps the chosen view.

### 2.2 Album filter

- The Album category lists **every album on the current side** (visible vs locked),
  by name, instead of the three fixed choices. Each album shows its link count.
- It also offers a pinned **Not in an album** option for links filed into no album on
  that side.
- "Not in an album" is mutually exclusive with any concrete album selection: turning
  it on pushes every album to the excluded side; checking an album turns it off.
- Album values travel as **album ids** so renaming an album cannot break a saved URL.
  Names are only the display label.
- On an album's own page the Album category is hidden: every link there is already in
  that album, so the category would have nothing meaningful to say.

### 2.3 Multi-category filter modal

A reusable client component, `MultiCategoryFilterModal`, with:

1. **Container and header** — title "Filter", close (X) button.
2. **Footer** — "Clear filter" (restores every option to included) and "Apply"
   (commit and close).
3. **Left navigation sidebar** — vertical category list (Domain, Album). The active
   category is highlighted. The sidebar scrolls independently when the list is long.
4. **Right content panel** for the active category:
   - a search box filtering that category's values;
   - an All / Select All control;
   - two independent, scrollable checkbox columns: **Include** and **Exclude**;
   - **every option starts checked in Include** — a fresh modal filters nothing;
   - **unchecking an option moves it to Exclude** (still unchecked); checking it in
     Exclude moves it back to Include. Checked = include, unchecked = exclude, so a
     value can never be on both sides;
   - each option's **count badge** (e.g. a domain's link total) sits on the right of
     the label, in a different colour so it reads as a count, not part of the name;
   - the pinned special option ("Not in an album") renders as a toggle button above
     the columns and is exclusive with the option columns.
5. **Return value** — a JSON object keyed by category id, each with `include` and
   `exclude` arrays:

   ```json
   {
     "domain": { "include": ["example.com"], "exclude": ["ads.example"] },
     "album": { "include": ["<album-id>"], "exclude": [] }
   }
   ```

   The app adapter maps the Album category's special value to the `albumNone` flag,
   strips it from the id lists, and persists **only the excluded values** — the
   included set is "everything that is not excluded", so a value added to the database
   later is included by default, exactly as the modal shows.

### 2.4 Filter bar

After this change the bar contains:

- the free-text search (debounced, unchanged);
- a **Filter** button that opens the modal, with a badge counting active values;
- the Grid/List view switch;
- the Favorites toggle;
- "Clear filters" when anything is filtered;
- the existing lock button where it is already shown.

The Domain and Album `<select>` elements are removed from the bar.

---

## 3. URL contract

| Parameter | Meaning | Notes |
| --- | --- | --- |
| `q` | title/url search | unchanged |
| `domain` | domain **include** | repeated; a single value is the legacy form |
| `domainExclude` | domain **exclude** | repeated |
| `album` | album id **include** | repeated |
| `albumExclude` | album id **exclude** | repeated |
| `albumNone` | `1` = "Not in an album" | clears album include/exclude |
| `favorite` | `1` = favorites only | unchanged |
| `view` | `list` | omitted for grid |

Legacy links keep working:

- `?domain=example.com` still means "include that domain".
- `?album=none` becomes `albumNone=1`.
- `?album=in` becomes "no album filter" (the new UI no longer has an "in any album"
  choice; it must not hide every link).

Normalisation rules:

- values are trimmed, de-duplicated, and capped per value and per list;
- domains are lowercased;
- a value present in both columns is kept only in **include**;
- `albumNone` wins over any album include/exclude values;
- unknown album ids simply match nothing.

---

## 4. Edge cases

| Case | Expected behaviour |
| --- | --- |
| Album renamed or deleted | Saved URLs use ids; a deleted id matches nothing and is shown by its id in the modal until removed. |
| Category with no options | Right panel says there is nothing to filter; All control is disabled. |
| Search hides the checked values | Checks are preserved; only the visible subset is affected by All. |
| Special option checked, then an album checked | Special clears itself, album selection applies. |
| Locked page | Categories only offer that side's domains and albums; the SQL also re-checks scope. |
| Album page | Album category hidden; domain include/exclude still works. |
| No matches | The existing "no matches" panel describes the new filters and clears them while keeping the view. |
| 100-row page cap | Unchanged: filters run in SQL, so the cap applies to the filtered set. |

## 5. Non-goals

- No new database tables or migrations.
- No client-side filtering of the link list.
- No saved/named filter presets.
- No changes to the ingestion API or the userscript.
