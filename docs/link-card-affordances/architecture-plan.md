# Link card affordances — architecture plan

**Status:** Phase 2 (approved and implemented)
**Requirements:** `docs/link-card-affordances/requirements.md`

## Overview

Both changes live in the **link card** and use data the pages already query:

```
/ , /locked (Links tab)                    album detail pages
  loadLinks()                               loadAlbum()
    listAlbumOptions(db, scope) ──┐            already loads `albums` + `memberships`
    listAlbumIdsByLink(db, ids,   │            (scoped to the page's side)
                            scope)┘
            │
            ▼
      <LinkGrid albums memberships basePath>
            │
            ▼
      <LinkCard link albums memberAlbumIds basePath>
        ├─ <LinkCover>                 R1: cover = checkbox <label>
        └─ <AlbumMembershipLabel>      R2: "In Anime, Work +2"
```

No query, endpoint, schema, or client-fetch change. R2 is a pure mapping of
`memberAlbumIds` → names from the page's own `albums` list (both already side-scoped), and R1 is
selection state that already lives in `SelectionProvider`.

## Steps

1. **Pure formatting helper + tests (red → green)**
   - `src/lib/albums.ts`: `MEMBERSHIP_PREVIEW_LIMIT = 3` and
     `membershipPreview(memberAlbumIds, albums, limit?)` → `{ shown, hidden }`.
     It walks `albums` (the page's name-ordered list) and keeps those whose id is a member, so
     the order is the Albums tab's order and ids for deleted albums are dropped.
   - `tests/albums-lib.test.ts`: empty input, 1/3/4 members, ordering by album list, unknown
     ids ignored, custom limit.

2. **R1 — the cover becomes the checkbox's label**
   - New `src/components/LinkCover.tsx` (`"use client"`): renders the thumbnail (or the host
     placeholder) inside a `<label class="absolute inset-0 ...">` that also renders the existing
     checkbox. Without a `SelectionProvider` (album pages) it renders exactly today's static
     markup. Same accessible name (`Select <title>`), same single focus stop.
   - Delete `src/components/SelectCheckbox.tsx` (its only caller is `LinkCard`); the checkbox
     markup moves into `LinkCover`.
   - `<img>` element and its `referrerPolicy`/`loading` attributes stay as they are.
   - Tests (`tests/link-card-affordances.test.*`): server-render with `react-dom/server`
     (`renderToStaticMarkup`) — no provider ⇒ no checkbox/label, same image; provider ⇒ a
     `<label>` containing one `<input type="checkbox" aria-label="Select …">` and the image;
     exactly one control, so a click cannot double-toggle.

3. **R2 — membership label**
   - New `src/components/AlbumMembershipLabel.tsx` (server component, no hooks): takes
     `{ albumIds, albums, basePath }`, calls `membershipPreview`, renders
     `In <a>Anime</a>, <a>Work</a> <span title="Ideas, Later">+2</span>`, or `null` when there is
     nothing to show.
   - Links via `albumHref(id, basePath)`, so light and dark pages each link to their own route.
   - Styling: `text-[11px]`, muted, `line-clamp-2`, same palette as the host/time line.
   - Render tests: names + hrefs, current-album inclusion, 4 ⇒ 3 names + `+1` and the tooltip
     text, empty ⇒ no output.

4. **Wire the card**
   - `LinkCard`: new optional `basePath = "/"`; replace the inline cover block with
     `<LinkCover …>`; add `<AlbumMembershipLabel>` under the title when `albums` is provided.
   - `LinkGrid`: pass `basePath` down.
   - Four pages already pass `albums`/`memberships`; no page change needed.

5. **Docs + verification**
   - README: card description (cover click, `In:` label, `+N`), tests table row, file tree.
   - Live probe `e2e-card-affordances.mjs` (temp dir): cover is a `<label>` on `/` and not on
     an album page; `In …` lists the right albums; `+N` past three; album detail includes the
     current album; locked album names absent from `/`; cleanup only probe rows.
   - Gates: `npm run test`, `npm run lint`, `npm run build`, then the probe against a fresh
     production server; confirm `local.db` still has the user's 2 albums / 4 links / 3 domains.

## File map

| File | Change |
| --- | --- |
| `src/lib/albums.ts` | + `MEMBERSHIP_PREVIEW_LIMIT`, `membershipPreview()` |
| `src/components/LinkCover.tsx` | new — cover + label-wrapped checkbox |
| `src/components/AlbumMembershipLabel.tsx` | new — `In: …` line |
| `src/components/LinkCard.tsx` | use both, + `basePath` |
| `src/components/LinkGrid.tsx` | pass `basePath` |
| `src/components/SelectCheckbox.tsx` | deleted (folded into `LinkCover`) |
| `tests/albums-lib.test.ts` | + helper tests |
| `tests/link-card-affordances.test.ts` | new — server-render tests |
| `vitest.config.mts` | only if esbuild needs `jsx: "automatic"` (verified in step 2) |
| `README.md` | card behaviour, tests table, file tree |
| `docs/link-card-affordances/*` | this plan + requirements |

## Testing strategy

- **Unit:** `membershipPreview` is the only decision with branches (limit, order, unknown ids).
- **Render (node, no DOM dependency):** both components' markup and link targets, and that the
  cover is non-interactive outside a selection context. This catches the two regressions that
  matter — a checkbox on album pages, or a label with the wrong accessible name.
- **Live probe:** the four real pages, using two throwaway albums on each side (created and
  deleted by the probe) to prove the label's side scoping and `+N`.
- **Manual:** one click on a thumbnail (the probe cannot click; the label/input markup is the
  guarantee that the browser toggles it).

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A `<label>` double-toggles when the checkbox itself is clicked | Native browsers do not re-dispatch for a click on the control inside its own label; the render test asserts a single input and no extra handler |
| An extra focus stop or duplicate announcement | The checkbox remains the only control; the label adds no tabindex and no ARIA of its own |
| Album names leak across the lock | The label receives only the page's scoped list; the probe asserts locked names never appear on `/` |
| Cards grow tall with many albums | Hard cap of 3 names + `+N`, clamped to two lines |
| `LinkCard` becomes a client component | It is not: `LinkCover` is the only client piece, `LinkCard` stays a server component |
| Vitest cannot transform JSX | Step 2 checks it; if needed, add `esbuild: { jsx: "automatic" }` to `vitest.config.mts` (test-only) |

## Out of scope

- Moving the `Open link` action onto the cover, drag-to-select, or keyboard shortcuts.
- Showing album names in the bulk bar or in `Select all`.
- Any change to `album_links`, the album APIs, or the per-side rules.
