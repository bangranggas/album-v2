# Requirements — Link Card UI/UX Revamp

**Slug:** `link-card-revamp`
**Status:** Approved (Phase 1)
**Depends on:** `docs/link-card-affordances`, `docs/link-sort-and-timestamps`

---

## 1. Goal

Redesign `LinkCard` so its information hierarchy is scannable, visually distinct, and
compact, without losing any existing functionality or accessibility contracts.

---

## 2. Scope

1. **Keep Cover Selection Intact (`LinkCover`)**:
   - Clicking the cover/thumbnail continues to toggle bulk selection on selectable pages.
2. **Clear Visual Hierarchy in the Card Body (`LinkCard`)**:
   - **Header Row (Domain & Timestamp)**:
     - Show the domain (`host`) as a subtle pill/badge at the top of the card body.
     - Show the upload timestamp (`Created <relative>`).
     - Show `Updated <relative>` **only when the link has been updated after creation**
       (`link.updatedAt > link.createdAt`), so unedited links are not cluttered with two
       identical timestamps.
   - **Clickable Title**:
     - The link title (`<h2>`) wraps an `<a href={link.url} target="_blank" rel="noopener noreferrer">`
       so users can click the title directly to open the link.
   - **Distinct Summary (`LinkSummary`)**:
     - Styled with a subtle left accent border and muted background/typography so the AI/owner
       summary visually stands apart from the title and metadata.
   - **Album Membership Chips (`AlbumMembershipLabel`)**:
     - Keep the accessible `In <Album>` links and `+N` overflow tooltip while styling album
       links as clean, clickable pill badges.
3. **Unified Action Footer (`LinkCard` + `LinkActions`)**:
   - Place the primary `Open` external link button alongside the 5 icon actions (`Favorite`,
     `Album`, `Fetch thumbnail`, `Edit`, `Delete`) in a single bottom footer bar separated by a
     subtle border (`border-t`), eliminating the stacked full-width button + second icon row.
   - When `LinkActions` enters `editing` or `confirming` (delete) mode, the inline form/confirm
     expands cleanly inside the footer area.
4. **Consistency in `LinkList` (Mobile sub-line)**:
   - On mobile in `LinkList`, show `Updated <relative>` only when `link.updatedAt > link.createdAt`
     (while the desktop table still has the dedicated `Created` and `Updated` columns).
