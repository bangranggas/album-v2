# Architecture Plan — Link Card UI/UX Revamp

**Slug:** `link-card-revamp`
**Status:** Approved (Phase 2)
**Requirements:** `docs/link-card-revamp/requirements.md`

---

## 1. Component Changes

| File | Change |
| --- | --- |
| `src/components/LinkCard.tsx` | Restructure card layout: top domain badge + conditional `Created` / `Updated` (`updatedAt > createdAt`) metadata row, clickable `<h2><a href={link.url}>` title, distinct summary & album pills section, and unified bottom footer bar with compact `Open link` button + `LinkActions`. |
| `src/components/LinkSummary.tsx` | Style summary with a subtle left border (`border-l-2`) and comfortable line height so it reads as an annotation rather than a second title. |
| `src/components/AlbumMembershipLabel.tsx` | Style album links as compact rounded pill badges while preserving `In`, `, `, `<a href="/albums/...">Name</a>`, and `+N` (`title="..."`) markup contract. |
| `src/components/LinkActions.tsx` | Support a compact `headerAction` (or inline layout) so the `Open link` button sits on the same row as the action icons when `mode === "idle"`, and yields full width when `mode === "editing"` or `"confirming"`. |
| `src/components/LinkList.tsx` | On the mobile folded line, show `Updated` only when `link.updatedAt > link.createdAt` (desktop table keeps both `Created` and `Updated` columns). |
| `tests/link-card-affordances.test.ts` | Add tests verifying `Updated` is hidden on `LinkCard` when `updatedAt === createdAt`, shown when `updatedAt > createdAt`, and that the card title links to `link.url`. |

---

## 2. Execution Steps (TDD)

1. **RED:** Update `tests/link-card-affordances.test.ts` to assert:
   - `LinkCard` shows both `Created` and `Updated` when `updatedAt > createdAt`.
   - `LinkCard` shows only `Created` (and not `Updated`) when `updatedAt === createdAt`.
   - `LinkCard` renders a clickable title link to `link.url`.
2. **GREEN:** Update `LinkCard.tsx`, `LinkSummary.tsx`, `AlbumMembershipLabel.tsx`,
   `LinkActions.tsx`, and `LinkList.tsx`.
3. **VERIFY:** Run `npm.cmd test` and `npm.cmd run lint`.
