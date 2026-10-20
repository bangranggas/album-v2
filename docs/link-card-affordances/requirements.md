# Link card affordances — requirements

**Status:** Phase 1 (approved)
**Depends on:** the albums feature (`docs/albums/`), bulk filing (`docs/bulk-album-assign/`),
and per-side albums (`docs/album-scope/`).

## Problems

1. **Selecting a link is a tiny target.** The bulk-selection checkbox is a 16 px box in the
   corner of the cover. The cover itself — the largest thing on the card — does nothing when
   clicked, so filing several links means aiming at that box every time.
2. **Membership is invisible.** Once a link is in an album, the card says nothing about it. The
   only way to find out is to open the folder popup on every card and read the ticked boxes.

## Scope

Two changes to the **link card**, on both sides of the lock (`/` and `/locked`):

- R1: clicking the cover toggles the card's selection.
- R2: the card shows the names of the albums that already hold the link.

No database change, no new endpoint, no new dependency. The data the label needs
(`albums` + `memberAlbumIds`) is already loaded per page and already scoped to that page's
side; the label only formats it.

## R1 — Cover click toggles selection

- **Where:** on the pages that have bulk selection, i.e. the two Links tabs. Those pages render
  a `SelectionProvider`, and the cover becomes the checkbox's `<label>`, so a click anywhere on
  the cover (thumbnail, or the host placeholder when there is no thumbnail) ticks the box.
- **Toggle:** a second click unticks it. The checkbox stays the single source of truth; there
  is no separate state.
- **Not on album detail pages:** those have no `SelectionProvider` (nothing is selectable
  there), so the cover stays inert exactly as it is today.
- **Accessibility is unchanged:** one focus stop — the checkbox — with the same accessible name
  (`Select <title>`), same keyboard behaviour. The label is only a bigger pointer target.
- Clicking the checkbox itself still toggles once (the label does not double-fire).

## R2 — "In: …" album names on the card

- **Content:** every card whose link is in at least one album of the page's own side shows
  `In Anime, Work, Ideas` under the title. A link in no album shows nothing.
- **Order:** the page's album order (by name), not the order ids happen to come back in.
- **Links:** each name is a link to that album's detail page on the same side —
  `/albums/<id>` on the light page, `/locked/albums/<id>` in the hidden area.
- **Overflow:** at most **3** names are shown; the rest collapse into `+N`, whose native
  tooltip (`title`) lists the remaining names. No popup, no extra click target.
- **Placement:** between the title and the host/relative-time line, as small muted text, so it
  reads as metadata rather than an action.
- **Every card that has the data:** both Links tabs and both album detail pages. On an album's
  page the album being viewed is included (the label answers "which albums is this in?").
- **Missing data is silent:** no album list passed, an empty membership list, or an id whose
  album no longer exists (deleted in another tab) all render nothing — never a blank chip or a
  dangling link.

## Lock-scope rules (non-negotiable)

- The label never queries anything: it maps ids from `listAlbumIdsByLink(db, ids, scope)` to the
  page's own `listAlbumOptions(db, scope)`.
- Therefore a locked album's name cannot appear on `/`, and a visible album's name cannot appear
  in the hidden area — the same guarantee the album lists already have
  (`docs/album-scope/` D5/D6).
- R1 is pure UI state (`SelectionProvider`), which lives in the page's memory only.

## Edge cases

| Case | Expected |
| --- | --- |
| Link in 0 albums | No label line at all |
| Link in exactly 3 albums | All three names, no `+N` |
| Link in 4+ albums | First three + `+N` with the rest in the tooltip |
| Link in an album deleted since the page loaded | That id is omitted; no broken link |
| Very long album name (up to 100 chars) | Label wraps and is clamped to two lines |
| Card on an album detail page | Label includes the current album; cover stays inert |
| Add/remove via the folder popup | `router.refresh()` re-renders the card, so the label updates |
| Dark theme | Same colours as the existing muted metadata |
| Card with no thumbnail | The placeholder cover is clickable too (it is the cover) |
| Click on the favorite badge | The badge sits above the cover (it carries its own tooltip), so that 24 px corner does not select |

## Non-goals

- No "open link" behaviour on the cover (the `Open link` button stays the way to open it).
- No change to the bulk bar, "Select all", the folder popup, or any endpoint.
- No new runtime dependency and no client-side fetch: the label is server-rendered.

## Acceptance criteria

1. Clicking a card's thumbnail ticks its checkbox; clicking again unticks it (verified by a
   render test for the markup/handler wiring and by a live probe for the rendered pages).
2. On `/`, a link in `Anime` and `Work` shows `In Anime, Work`, both linking to their album
   pages; a locked album never appears there.
3. On `/locked`, the same link shows the locked albums it belongs to, and `+N` appears past
   three.
4. Album detail pages show the same label, current album included.
5. Unit tests, lint and build stay green; the live probes pass; no `local.db` data is touched.
