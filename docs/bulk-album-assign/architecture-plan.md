# Bulk assign links to an album — Architecture Plan

Phase 2 output for `docs/bulk-album-assign/requirements.md` (approved scope). No code until this
plan is approved. Inherits every decision of `docs/albums/architecture-plan.md` that this feature
does not explicitly revisit.

## 1. Approach

The feature is **client-side selection plus one new write endpoint**. There is no schema change, no
migration, and no new read path: the album names the picker offers are already loaded for the card
popup (`listAlbumOptions`), and "which links are selected" is a fact that only exists in the
browser.

Four properties drive the design:

1. **Selection is UI state, the write is a transaction.** The browser keeps a set of link ids; the
   server receives them once and writes memberships in one statement, so a 20-link selection can
   never be half applied.
2. **The scope rule is untouched.** `/` renders only visible links, so only visible links can be
   selected, and the bulk endpoint only *writes*. Nothing in this feature reads a link, an album,
   or a count through a new path — the existing scoped queries do all the revealing, or not.
3. **One panel, two modes.** The card popup and the bulk bar share one presentation component
   (`AlbumPickerPanel`); the single-link flow keeps its toggling checkboxes, the bulk flow is
   add-only. This is the same reasoning that keeps `LinkGrid`/`LinkFilters` shared today.
4. **Every mutation still ends in `router.refresh()`.** The bulk add behaves like every other card
   action, so the album tab, the counts, and the covers update themselves; no cache to maintain.

The selection context is mounted **inside `LinkGrid`** and only when the grid is asked to be
selectable, so the album detail pages — the other two callers of `LinkGrid` — are unchanged.

## 2. Module boundaries

| Layer | Responsibility |
| --- | --- |
| `src/lib/link-selection.ts` (new) | Pure selection helpers: toggle, union, remove, visible/out-of-view partition, the bar's label, the post-action report. No React, no I/O. |
| `src/lib/validation.ts` (extended) | `parseBulkAlbumLinkInput` + `MAX_BULK_LINK_IDS`; the only place a request's id array is trimmed, deduplicated, and capped. |
| `src/lib/dashboard-api.ts` (extended) | `readCreatedAlbumId` and `readBulkAddCounts`: the two defensive readers of the payloads the client flows need. |
| `src/db/albums.ts` (extended) | `addLinksToAlbum` — the only new SQL: existence checks, then one idempotent insert. |
| `src/app/api/dashboard/albums/[id]/links/route.ts` (new) | Session-gated `POST`; validation, `404` for a missing album, the `{ added, alreadyIn, skipped }` report. |
| `src/components/SelectionProvider.tsx` (new) | The React context and its state (`readonly string[]` of selected ids) plus the `useSelection()` hook. |
| `src/components/AlbumPickerPanel.tsx` (new) | The shared panel chrome: header, album list, inline "New album" form, error line, `Done`. Modes: `toggle` (one link) and `addOnly` (the selection). |
| `src/components/AddToAlbumMenu.tsx` (rewritten) | Keeps the popup's data flow and optimistic toggling; renders `AlbumPickerPanel` in `toggle` mode. |
| `src/components/SelectCheckbox.tsx` (new) | One card's checkbox; renders nothing when there is no selection context. |
| `src/components/SelectAllToggle.tsx` (new) | "Select all on this page" above the grid; reflects none / some / all. |
| `src/components/SelectionBar.tsx` (new) | The floating bar: count, out-of-view marker, "Add to album" (opens the panel), "Clear", and the report line. |
| `src/components/LinkGrid.tsx` (extended) | Optional `selectable` prop: wraps the grid in the provider and renders the toggle + the bar. |
| Pages | `/` and `/locked` (Links tab) pass `selectable`; nothing else changes. |

## 3. Data structures

### 3.1 Validation (`src/lib/validation.ts`)

```ts
/** Most ids one bulk request may carry; the rendered list is capped at 100. */
export const MAX_BULK_LINK_IDS = 200;

export interface BulkAlbumLinkInput {
  /** Deduplicated, trimmed, order preserved. Never empty. */
  linkIds: string[];
}

export function parseBulkAlbumLinkInput(raw: unknown): ParseResult<BulkAlbumLinkInput>;
```

Rules (each one a test): the body must be a plain object; `linkIds` must be an array; every entry
must be a string that is non-blank after `trim()`; the array must be non-empty; the *deduplicated*
length must be `<= MAX_BULK_LINK_IDS`. Messages follow the existing `field: reason` shape
(`linkIds: must be an array of link ids`), so the route can reuse `describeIssue`'s style.

### 3.2 Repository (`src/db/albums.ts`)

```ts
export type BulkAddResult = {
  added: number;
  alreadyIn: number;
  skipped: number;
};

export async function addLinksToAlbum(
  db: Database,
  albumId: string,
  linkIds: readonly string[],
): Promise<BulkAddResult | "album-not-found">;
```

Behaviour:

1. `SELECT id FROM albums WHERE id = ?` → `"album-not-found"` (the route answers `404`).
2. `SELECT id FROM links WHERE id IN (…)` → ids that do not exist are **skipped**, never inserted
   (D9: `album_links` has no foreign keys, so an unchecked insert would leave a permanent orphan).
3. `SELECT link_id FROM album_links WHERE album_id = ? AND link_id IN (…)` → those are `alreadyIn`.
4. One `INSERT … ON CONFLICT DO NOTHING` for the remainder, in a single statement → `added`.
5. `added + alreadyIn + skipped` must equal the deduplicated request length (asserted in tests).

An empty `linkIds` array is a no-op that returns `{ added: 0, alreadyIn: 0, skipped: 0 }`; the route
never lets it through, but the repository stays total.

The read-then-write pair runs inside `db.transaction` so the reported counts describe the same
instant the insert saw. The write itself is idempotent, so a rare race can only make a count
slightly stale — never a duplicate row.

### 3.3 Selection helpers (`src/lib/link-selection.ts`)

```ts
export function toggleSelection(selected: readonly string[], id: string): string[];
export function addToSelection(selected: readonly string[], ids: readonly string[]): string[];
export function removeFromSelection(selected: readonly string[], ids: readonly string[]): string[];
export function partitionSelection(
  selected: readonly string[],
  visibleIds: readonly string[],
): { visible: string[]; outOfView: string[] };
export function selectionLabel(selectedCount: number, outOfViewCount: number): string;
export function bulkAddReport(
  result: { added: number; alreadyIn: number; skipped: number },
  albumName: string,
): string;
```

- `addToSelection` unions and deduplicates, preserving first-seen order, so "Select all" clicked
  twice cannot grow the array.
- `removeFromSelection` is what lets "Select all" uncheck itself: it drops only the rendered ids,
  so a selection that is partly out of view survives.
- `partitionSelection` returns the selected ids that the current page shows and those it does not
  (D5: selection survives a filter change, and the bar must say how many are out of view).
- `selectionLabel(7, 2)` → `"7 links selected · 2 links out of view"`; `selectionLabel(7, 0)` →
  `"7 links selected"`; nothing selected → `"Nothing selected"`.
- `bulkAddReport({ added: 3, alreadyIn: 0, skipped: 0 }, "Anime")` → `3 links added to “Anime”`;
  further clauses are added for `alreadyIn` (`3 links added to “Anime”, 2 already there`) and
  `skipped` (`…, 1 link skipped`), and a run that added nothing says so rather than claiming
  success (`Nothing added: 2 links were already in “Anime”`). Singular/plural follows the existing
  count-formatting style.

## 4. Endpoint contract

`POST /api/dashboard/albums/:id/links` — session-gated (dashboard cookie), no CORS (same-origin,
like the other dashboard routes), `dynamic = "force-dynamic"`.

| Case | Status | Body |
| --- | --- | --- |
| Applied | `200` | `{ "added": 3, "alreadyIn": 2, "skipped": 1 }` |
| No session | `401` | `unauthorized()` |
| Body is not JSON | `400` | `invalidJson()` |
| `linkIds` missing / not an array / blank entry / empty / over the cap | `400` | `validationError(message)` |
| Album does not exist | `404` | `notFound("That album no longer exists.")` |
| Password not configured | `503` | the existing `serviceUnavailable()` path from `requireDashboardSession` |

Logging mirrors the single-link route: `dashboard_album_links_added` on success (with `album_id`,
`added`, `already_in`, `skipped`, `ip_address`) and `dashboard_album_links_add_failed` with a
`reason` on every refusal. The client treats `401` on `/locked` like any other expired-passcode
response (the existing `callApi` redirect path).

## 5. Component design

### 5.1 `SelectionProvider` + `useSelection`

```ts
interface SelectionContextValue {
  selectedIds: readonly string[];
  isSelected(id: string): boolean;
  toggle(id: string): void;
  selectMany(ids: readonly string[]): void;
  removeMany(ids: readonly string[]): void;
  clear(): void;
}
```

`useSelection()` returns `SelectionContextValue | null`. `SelectCheckbox` renders `null` when the
context is absent, which is how the album detail pages stay checkbox-free without a threaded prop
(D12). State is a plain array in `useState`; every update replaces it, so React re-renders exactly
the consumers that read it. The provider is a client component; its children are the
server-rendered cards, which is a supported RSC pattern and keeps `LinkCard` a server component.

### 5.2 `AlbumPickerPanel`

```ts
interface AlbumPickerPanelProps {
  mode: "toggle" | "addOnly";
  albums: readonly AlbumOption[];
  /** toggle: the link's albums. */
  memberAlbumIds?: readonly string[];
  /** addOnly: how many links the action applies to, for the header. */
  selectionCount?: number;
  /** toggle: the new checkbox state. */
  onToggle?: (albumId: string, checked: boolean) => void;
  /** addOnly: an album row was clicked. */
  onPick?: (albumId: string) => void;
  /** Creates an album, then files the link(s) into it; resolves to an error message or null. */
  onCreate: (name: string) => Promise<string | null>;
  onDone: () => void;
  /** Drops the caller's error when the visitor starts a fresh interaction. */
  onClearError: () => void;
  busy: boolean;
  error: string | null;
  /** The element holding the trigger and the panel; outside clicks close it. */
  containerRef: RefObject<HTMLDivElement | null>;
}
```

The panel owns only what is purely presentational: `newName`, the `creating` flag, focus and
`Escape`/outside-click dismissal (moved out of `AddToAlbumMenu` unchanged). The parent owns `busy`
and `error`, and resets the error when a new action starts — exactly as `AddToAlbumMenu` does today.
`onCreate` returning `string | null` keeps the two callers in charge of their own request sequence
while the form and its error display stay in one place.

### 5.3 Bar, checkbox, select-all

- `SelectCheckbox` renders an `<input type="checkbox">` overlaid on the card's cover (top-left,
  `absolute`, on a light chip so it stays visible over any thumbnail), with
  `aria-label={"Select " + link.title}`. The parent `<article>` is not clickable, so nothing else
  fires.
- `SelectAllToggle` sits above the grid: one checkbox plus `Select all on this page (12)`. Checked
  when every rendered id is selected, indeterminate when only some are. Clicking selects all
  rendered ids (union, D6) or, when all are already selected, deselects them.
- `SelectionBar` is a `fixed bottom-4 left-1/2 -translate-x-1/2` pill (Gmail-style) so a selection
  made at the bottom of a 100-card list does not require scrolling back up. It renders nothing when
  nothing is selected. Contents: `selectionLabel(...)`, an "Add to album" button that opens
  `AlbumPickerPanel` in `addOnly` mode anchored above the bar, "Clear", and the report line after a
  successful add. The picker and its panel are the existing `AddToAlbumMenu` pattern, so the
  `busy`/`error`/refresh behaviour is identical.
- The report is stored together with the selection it describes (`{ key, text }`, shown only while
  `key` still matches the current selection), so changing the selection drops a stale report without
  an effect or an extra render.
- When `selectable`, the grid's wrapper gets bottom padding so the fixed bar cannot cover the last
  row's actions.

## 6. Wiring

```
/            ?tab=links   ─▶ <LinkGrid … selectable />   (visible scope)
/locked      ?tab=links   ─▶ <LinkGrid … selectable />   (locked scope + dark)

LinkGrid(selectable)
  └─ <SelectionProvider>
       ├─ <SelectAllToggle visibleIds={ids} />
       ├─ <ul>… <LinkCard> → <SelectCheckbox linkId label /> …</ul>
       └─ <SelectionBar visibleIds={ids} albums={albums} locked={locked} />
```

The two album detail pages keep calling `LinkGrid` without `selectable`; `memberships` keeps
feeding the per-card popup there and on the Links tab. Nothing else in the page changes: the tab
strip, the filters, the count line, and the empty states are untouched.

## 7. Test plan (written before the implementation)

| File | Covers |
| --- | --- |
| `tests/link-selection.test.ts` (new) | toggle on/off; union + dedupe + order; remove; partition with all/some/none visible; labels for 0/1/2 out of view; report text for each combination of `added`/`alreadyIn`/`skipped`, including `added === 0` and the album name with quotes. |
| `tests/album-validation.test.ts` (extend) | `parseBulkAlbumLinkInput`: valid list; trimming; dedupe; non-object; missing/`null`/non-array `linkIds`; empty array; non-string entries; blank entries; `MAX_BULK_LINK_IDS` boundary (exactly the cap is fine, cap + 1 rejected *after* dedupe). |
| `tests/albums-repository.test.ts` (extend) | `addLinksToAlbum`: all new; mixed new + already-in + unknown; unknown album; empty list; idempotent repeat run; counts always sum to the request length; **no orphan rows** (`album_links` holds rows only for real links); other albums and other links untouched. |
| `tests/album-routes.test.ts` (extend) | `POST /api/dashboard/albums/:id/links`: `200` + counts; `400` for every malformed shape; `401` without a session; `503` when the password is not configured; `404` for a missing album; the logged event names and payload fields. |
| `tests/dashboard-api.test.ts` (extend) | The two payload readers: a well-formed album id / count triple, and `null` for every shape that cannot be trusted (a negative or missing count included). |

The pure helpers and the repository are unit-testable without a browser; the components are covered
by `npm run build` (types) and by the live checks in section 9.

## 8. Execution order (Phase 5)

1. `src/lib/link-selection.ts` + `tests/link-selection.test.ts` (RED → GREEN).
2. `parseBulkAlbumLinkInput` + validation tests.
3. `addLinksToAlbum` + repository tests.
4. The route + route tests.
5. **Refactor only:** extract `AlbumPickerPanel` and move `AddToAlbumMenu` onto it; full suite plus
   a `build` prove the card popup is unchanged before anything new is added.
6. `SelectionProvider`, `SelectCheckbox`, `SelectAllToggle`, `SelectionBar`, `LinkGrid.selectable`,
   and the two page props (with `readCreatedAlbumId` / `readBulkAddCounts` in `dashboard-api.ts`,
   test first).
7. README (endpoint table, a short "Bulk add" note, the tests table); `npm run test`,
   `npm run lint`, `npm run build`.
8. Live checks against a real server (section 9), then Phase 6 cleanup and one commit.

## 9. Verification

**HTTP-level (scripted, like the existing e2e):** the new endpoint's happy path, idempotency,
malformed bodies, `401`, and `404`; the rendered Links tab contains one `type="checkbox"` per
rendered card and the "Select all on this page" control; the album detail pages contain **no**
selection checkbox; the visible scope is unchanged (no hidden link, title, or count leaks into `/`).

**Browser-level (manual checklist for the owner, since the selection is client state that an HTTP
probe cannot exercise):** select two cards → the bar shows `2 selected`; add them to an album → the
panel closes, the report names the album, the selection is still there, and the album tab shows
them; filter or search so one selected card disappears → the bar says `1 out of view` and the add
still files both; "Select all on this page" selects every card; "Clear" empties the selection; a
second add of the same selection reports "already there" and changes nothing.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Selection is client state, so a broken checkbox silently breaks the feature | Keep every decision in the pure `link-selection.ts` helpers under unit tests; the components only wire props to them. |
| The shared panel changes the card popup's behaviour during the refactor | Step 5 is a behaviour-preserving refactor with the existing suite and a build before the new UI exists. |
| The floating bar covers content, especially on mobile | It only exists while something is selected, and the selectable grid reserves bottom padding. |
| A hand-made request could file a hidden link id from the light page | Same trust model as today's single-link endpoint: ids are UUIDs learnable only after unlocking, and the endpoint cannot *read* anything. Documented in the requirements' AC13. |
| `router.refresh()` could remount the provider and lose a selection | The provider's position in the tree is stable; verified in the browser checklist (`refresh` after an add keeps the selection). |
