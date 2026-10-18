# Bulk assign links to an album — Requirements

Phase 1 output for the `bulk-album-assign` feature. Scope agreed with the owner on 2026-10-18.
This extends the albums feature (`docs/albums/`), whose section 3 explicitly deferred bulk
membership ("Bulk 'put these N links into an album'").

## 1. Goal

Let the owner file **many links into one album in a single action**, from the list they are
already looking at. Filing a link into an album copies nothing: the links keep living in `links`
and keep behaving exactly as they do today (favorites, editing, deleting, locking).

## 2. Scope (in)

1. **Per-card selection.** On the Links tab of `/` and `/locked`, every link card gets a
   checkbox.
2. **Action bar.** As soon as at least one link is selected, an action bar appears with the
   selected count, how many of them are not currently visible, "Add to album", and "Clear".
3. **Select all / clear.** A control above the grid selects every link currently rendered (after
   filters), and the action bar can clear the whole selection.
4. **Album picker in bulk mode.** The same panel the card popup uses, in an add-only mode: one
   click on an album adds every selected link to it, and already-filed links are skipped and
   counted.
5. **One bulk endpoint** so a 20-link selection is one request, not twenty.
6. **Tests** for the selection helpers, the repository call, and the endpoint.

## 3. Out of scope

- **Removing** links from an album in bulk, and any other bulk action (favorite, delete). The
  owner asked for adding only; bulk delete stays deliberately unavailable.
- Bulk selection anywhere other than the Links tab of `/` and `/locked` — the album detail pages
  keep their per-card "Remove from this album".
- Selection in the URL (`?sel=…`); selection lives in the page's memory.
- Drag & drop, and a "move" semantic (an album is a set, so "move" would just be add + remove).
- Album descriptions, nested albums, sharing, permissions, manual ordering.
- The userscript API (`POST` / `GET /api/links`) — its contract, and its indifference to albums,
  stay as they are.
- **No schema change and no migration**: memberships are written to the existing `album_links`.

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | A checkbox on every card plus an action bar that only appears when something is selected | Fewest clicks, and the normal (nothing selected) view is unchanged. Owner's choice over a "select mode" toggle. |
| D2 | The only bulk action is "Add to album" | Exactly what the owner asked for; it keeps the surface small and the destructive-action risk at zero. |
| D3 | The bulk picker is the card popup's panel in an **add-only** mode: clicking an album adds every selected link, and the count of links already in it is reported | One panel to maintain and the owner already knows it; "uncheck = remove all selected" was explicitly declined. |
| D4 | Selection lives in **client memory** (a React context above the grid), not in the URL | A selection is a transient action, and 37-character UUIDs would make `?sel=` long enough to break "Select all". |
| D5 | Selection is **kept when the visible list changes** (filter or search change), and the bar states how many selected links are out of view | Owner's choice. It makes "select 5, then narrow the list to check them" work, at the price of a marker — and a `Clear` that always clears everything. |
| D6 | "Select all" selects every link currently rendered (the filtered page, capped at the existing 100), and the control shows a partial state when only some are selected | "All" must mean "all of what I can see"; anything else would silently act on links the owner never saw. |
| D7 | **One bulk endpoint**: `POST /api/dashboard/albums/:id/links` with `{ linkIds }` | The alternative — the client calling the per-link endpoint N times — is N round trips and leaves the owner with a half-applied selection when one call fails. One request is one transaction and one honest report. |
| D8 | Adding is idempotent: a link already in the album is skipped and counted, never an error | Matches the single-link endpoint (`added: false`) and makes a double click harmless. |
| D9 | Unknown link ids are filtered out before writing, and reported as skipped | `album_links` has no foreign keys (the albums feature's D15), so an unfiltered insert would create a permanent orphan row that no page could ever show or clean up. |
| D10 | After a successful add: the panel closes, the **selection stays**, and the bar reports what happened | Owner's choice: adding the same set to a second album needs no re-selection. Clearing the selection is one click away. |
| D11 | A request may carry at most **200** ids; the list is deduplicated first, and an empty or malformed array is a `400` | The rendered list is capped at 100, so the cap only bounds a hand-made request. Deduplication keeps the counts honest. |
| D12 | The selection context is mounted only on the Links tabs. The per-card checkbox renders nothing when there is no context | The album detail pages and any future use of `LinkGrid` stay untouched without an extra prop threaded through every caller. |
| D13 | The album panel's presentation is separated from its single-link data flow, so one component serves both "toggle one link" and "add all selected" | Avoids a second, drifting copy of the same list (the reason `LinkGrid` and `LinkFilters` are shared today). |

## 5. Data flow

```
/            ?tab=links   ─▶ LinkGrid(selectable)
/locked      ?tab=links   ─▶ LinkGrid(selectable)

  SelectionProvider (client, in LinkGrid)
    ├─ SelectAllToggle   "Select all on this page" + partial state
    ├─ LinkCard → SelectCheckbox        (one per card, keyed by link id)
    └─ SelectionBar      visible while ≥1 selected
         ├─ "7 selected · 2 out of view"
         ├─ AlbumPickerPanel (add-only) ──POST /api/dashboard/albums/:id/links { linkIds }
         │                                 └─ then router.refresh()
         └─ "Clear"

  card popup (unchanged)  ─POST /api/dashboard/links/:id/albums { albumId }
  album tab (unchanged)   ─POST/PATCH/DELETE /api/dashboard/albums…

Bulk add answers { added, alreadyIn, skipped } and touches only `album_links`.
```

The server needs no new read path: the album names the panel offers are already loaded for the
card popup (`listAlbumOptions`), and the selection is a client-side fact.

## 6. Acceptance criteria

1. Every link card on the Links tab of `/` and `/locked` has a checkbox; the album detail pages
   keep their current cards, without checkboxes.
2. No action bar is shown while nothing is selected; selecting one link shows a bar with the
   count, "Add to album", and "Clear".
3. Clearing from the bar deselects everything, including links that are no longer visible.
4. "Select all on this page" selects every rendered link; the control reflects none / some / all.
5. Clicking an album in the bulk panel adds **every** selected link to it, in one request; a
   second click reports the links as already in the album and writes no duplicate row.
6. Links already in the target album are counted separately in the report, not silently ignored.
7. The bulk panel can create a new album and file the whole selection into it in one flow.
8. After a successful add the panel closes, the selection is still there, and the bar states what
   happened (e.g. `3 links added to "Anime"`) until the selection is cleared or changed.
9. When a filter or search hides part of the selection, the bar says how many selected links are
   out of view, and adding still files all of them.
10. A selection survives the `router.refresh()` that follows any card action, so a link can be
    filed into a second album without re-selecting.
11. Unknown or deleted link ids are skipped and reported; no orphan `album_links` row is ever
    created, and the rest of the selection is still applied.
12. Adding to an album that was deleted in another tab answers `404` with a message and a refresh.
13. **No leak:** only visible links are rendered on `/`, so only they can be selected, and the
    bulk endpoint only *writes* memberships — it cannot read or reveal a hidden link. The
    scope-dependent counts on the album pages respond to the new memberships exactly as before.
    (As with the existing single-link endpoint, a hand-made request could name a hidden link id;
    that is the same trust level as today, since ids are UUIDs learnable only after unlocking.)
14. The locked area keeps its dark theme, its passcode gate, and its redirect-on-expired-passcode
    behaviour; the bar and panel are styled for both themes.
15. Authentication, the userscript flow, `POST`/`GET /api/links`, CORS, login/logout, the navbar,
    filters, favorites, locking, manual add, and every albums behaviour from
    `docs/albums/requirements.md` are unchanged.
16. `npm run test`, `npm run lint`, and `npm run build` are green.

## 7. Edge cases to handle

- **Nothing selected** → no bar, no request possible; "Clear" and the panel are unreachable.
- **Selection hidden by a filter** → kept, counted as out of view, still added; `Clear` removes
  them too.
- **"Select all" while a filter is active** → selects the filtered page only.
- **Empty list / no matches** → no select-all control and no checkboxes; the existing empty states
  are unchanged.
- **A selected link deleted in another tab** → reported as skipped; the page refreshes.
- **The same link id twice in one request** → deduplicated; counts stay honest.
- **More than 200 ids in one request** → `400`, nothing written.
- **A malformed body** (missing, not an array, non-string entries, empty strings) → `400`.
- **No albums exist yet** → the bulk panel says so and offers "New album…".
- **The whole rendered page selected (up to 100)** → one request, one transaction.
- **Passcode expires while a selection is open on `/locked`** → the add answers `401` and the
  visitor is sent back to the prompt, with the selection still in memory if they return.
- **Panel interaction** → closes on `Done`, `Escape`, and a click outside, exactly like the card
  popup; each card checkbox and each bar button is keyboard reachable and labelled.
- **Album deleted and recreated with the same name** → unaffected: memberships hang off ids, not
  names.
