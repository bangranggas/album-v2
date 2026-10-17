# Requirements — Locked Domains, Link Management, Favorites, and Manual Add

**Slug:** `locked-domains-and-link-management`
**Status:** Awaiting approval (Phase 2)
**Depends on:** `docs/dashboard-filters/requirements.md`, `docs/dashboard-login-navbar/requirements.md`

This document covers four related changes requested together. They are delivered as one
feature because they share the same data model and the same card/filter components.

---

## 1. Goal

1. **Locked domains.** Mark some domains as *locked*. Their links disappear completely from
   the normal dashboard and live behind a passcode on a dedicated, dark-themed page, which is
   also where the locked domain list is managed.
2. **Edit and delete.** Links can be edited (title, url, thumbnail) and deleted — on the
   normal dashboard and on the locked page alike.
3. **Favorites.** A link can be starred, and the dashboard can be filtered down to favorites
   only, on both pages.
4. **Manual add.** A link can be added by hand from the web, without the userscript.

---

## 2. Scope (in)

### 2.1 Locked domains

- A new table holds the set of locked domains. Locking is a property of the **domain**, not
  of a row, so it also hides every link saved to that domain in the future.
- **Hidden means hidden.** On `/`, links whose domain is locked are excluded from the list,
  the domain dropdown, the search results, and the count line. A locked domain name never
  appears on `/` — not in the dropdown, not as a suggestion, nowhere.
- A **passcode**, read from a new environment variable, guards the locked area. It is a
  single shared passcode, like the dashboard password.
- The locked area lives at `/locked`, requires the dashboard login **and** the passcode, and
  is styled **dark** for its whole subtree, including the passcode prompt.
- `/locked` shows:
  - the same filter bar as the dashboard (domain dropdown limited to locked domains, plus the
    favorites filter),
  - the same card grid, with the same edit/delete/favorite actions,
  - the manual add form,
  - a **lock management panel**: every locked domain with a count and a remove control, plus
    an input to lock another domain (offering known domain names as suggestions).
- The lock icon is an **icon-only** button in the filter bar of `/`. Clicking it goes to
  `/locked`; without a valid passcode cookie that redirects to the dark passcode prompt.
- Access lasts **1 hour** from entering the passcode, and a "Lock now" control ends it
  immediately.

### 2.2 Edit and delete

- Every card gets an action row: favorite (star), edit (pencil), delete (trash).
- **Edit** opens an inline form on the card for `title`, `url`, and `thumbnail`; it can also
  be cancelled, discarding the draft.
- Changing the URL recomputes the domain, so a link can move between domains (and therefore
  in or out of the locked set).
- **Delete** is confirmed inline, in two steps ("Delete" → "Confirm delete" / "Cancel"),
  never with a browser popup. Deletion is permanent.
- Both actions work identically on `/` and `/locked`.

### 2.3 Favorites

- `links.is_favorite` is a real column, defaulting to off.
- The star on a card toggles it, with no page reload.
- A **Favorites** toggle in the filter bar narrows both pages to favorites (`?favorite=1`),
  combinable with the domain filter and the search text.
- Favorites are not hidden by locking: a favorite link inside a locked domain is still only
  visible on the locked page.

### 2.4 Manual add

- An **Add link** control on `/` and `/locked` opens a compact form: `url` (required),
  `title` (optional), `thumbnail` (optional).
- An empty title is derived from the URL, e.g. `example.com/article`.
- The same validation as the userscript path applies (absolute http(s) URL, length caps).
- On `/locked`, adding a link whose domain is **not** locked says so and points at the lock
  panel, because the new link would otherwise appear on the visible dashboard.

---

## 3. Out of scope

- Per-domain passcodes, per-link hiding, or a "locked" flag on a single link.
- User accounts, roles, or audit history of edits.
- Bulk operations (multi-select edit/delete), import/export, tags, or notes.
- Reordering, sorting options, or server-side pagination (the 100-row cap still applies per
  scope).
- Metadata scraping (fetching a page's real title/thumbnail server-side) — the project stays
  free of scraping, so a manual add takes the title you type.
- Changing `GET /api/links` (the userscript's read API) or the userscript itself.

---

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Locking is per domain, stored in its own table | A future link on that domain must be hidden too; a per-row flag would leak it. |
| D2 | Hidden excludes list, dropdown, search, and counts | Requested; a name appearing in a dropdown would already be a leak. |
| D3 | The locked area needs the dashboard session **and** the passcode | Two independent secrets; the passcode alone must not open a locked page to a stranger. |
| D4 | A separate signed cookie (`lc_locked`, 1 hour) | Requested lifetime, and a shorter one than the 7-day login because the area is sensitive. |
| D5 | The passcode is never used as an HMAC key directly | Both cookie types share one tested token implementation but use different signature contexts, so a dashboard cookie can never be replayed as a locked cookie — even if the two secrets happen to be identical. |
| D6 | The locked subtree is dark, always (not system-dependent) | Requested "pastikan laman ini dibuat dark", and a consistent dark identity makes the mode unmistakable. |
| D7 | Edit/delete/favorite go through session-gated route handlers | Consistent with the existing login flow (route handler + `router.refresh()`); no new state library, no server actions. |
| D8 | The userscript's `POST`/`GET /api/links` keeps its `x-secret-key` auth and its CORS behaviour | The userscript must keep working untouched. |
| D9 | Delete is a hard delete | Requested "delete"; no trash bin was asked for, and a soft-delete column would complicate every query. |
| D10 | False-link rows are not re-validated on read | Editing validates on write; old rows keep rendering even if a policy changes later. |
| D11 | The filter bar is now always visible on `/` | With locked domains, "no visible links" no longer means "nothing saved", and the lock icon must stay reachable. |
| D12 | A manual add with an empty title derives `host + path` | Keeps `title` mandatory in the database while allowing a fast paste-only workflow. |

---

## 5. Data flow

```
/ (All links)                    /locked (dark)                       /locked/unlock (dark)
  dashboard session                dashboard session + lc_locked        dashboard session
  scope = visible                  scope = locked                       passcode form
  lock icon ──────────────────────▶ redirect if no passcode ───────────▶ POST /api/locked/unlock
                                                                          └─ sets lc_locked (1h)

POST   /api/dashboard/links           session  ── add a link (manual)
PATCH  /api/dashboard/links/:id       session  ── edit title/url/thumbnail, toggle favorite
DELETE /api/dashboard/links/:id       session  ── delete permanently

POST   /api/locked/unlock             session              ── verify passcode, set lc_locked
POST   /api/locked/lock               session              ── clear lc_locked
POST   /api/locked/domains            session + lc_locked  ── lock a domain
DELETE /api/locked/domains/:domain    session + lc_locked  ── unlock a domain
```

Scope is applied in SQL, next to the existing filters, so no layer above it can accidentally
show a locked link:

```sql
-- visible : WHERE domain NOT IN (SELECT domain FROM locked_domains)
-- locked  : WHERE domain     IN (SELECT domain FROM locked_domains)
```

---

## 6. Acceptance criteria

1. Locking `example.com` from `/locked` removes its links from `/`, from the dropdown, from
   search results, and from the count line, after a refresh.
2. The locked domain name appears nowhere in the HTML of `/`.
3. The lock icon in the filter bar is an icon only (no visible text label) and navigates to
   `/locked`.
4. Visiting `/locked` without the passcode shows the dark passcode prompt; a wrong passcode
   shows an error and sets no cookie; the correct passcode shows the locked list.
5. The locked pages are dark; the light dashboard is unchanged.
6. The passcode session expires after 1 hour, and "Lock now" ends it immediately, so
   `/locked` asks for the passcode again.
7. `/locked` lists only links whose domain is locked, with its filter bar, favorites filter,
   edit/delete/favorite actions, and the manual add form.
8. The lock management panel lists locked domains with counts, can add a domain, and can
   remove one; removing it makes the links visible on `/` again.
9. Editing a card's title updates it in place after a refresh; editing the URL to another
   domain moves the link (including into and out of the locked set).
10. Editing a URL to one that already exists is refused with a clear message and changes
    nothing.
11. Deleting asks for confirmation inline and then removes the card; a cancel keeps it.
12. Clicking a card's star persists the favorite; the Favorites toggle then shows only starred
    links, and it combines with domain and search filters on both pages.
13. Adding a link manually on `/` creates it and shows it in the list; an empty title becomes
    `host + path`.
14. Adding a link manually on `/locked` for a domain that is not locked warns that the link
    will appear on `/`.
15. Invalid manual input (a relative URL, an empty URL, a too-long field) is rejected with a
    message, and nothing is written.
16. `LOCKED_PASSCODE` unset or blank: `/locked` returns `503` and the passcode prompt
    explains it — the unlocked dashboard keeps working normally.
17. A tampered or expired `lc_locked` cookie is rejected; a valid `lc_session` cookie alone
    never grants access to `/locked`.
18. The userscript flow, `POST`/`GET /api/links`, CORS, login, logout, the navbar, and the
    existing filters behave exactly as before.
19. `npm run test`, `npm run lint`, and `npm run build` are green.

---

## 7. Edge cases to handle

- **No passcode configured** → `/locked` answers `503` with instructions; `/locked/unlock`
  explains it instead of showing a form that cannot succeed.
- **No locked domains yet** → `/locked` shows an empty state explaining how to lock one.
- **A locked domain with no links** → listed in the panel with a count of 0.
- **Locking a domain that has no links yet** → allowed (pre-emptive hiding).
- **Unlocking while its links are open elsewhere** → they simply reappear on `/`.
- **Removing the last locked domain** → the panel shows its empty state.
- **A link moved into a locked domain by editing its URL** → it leaves `/` immediately.
- **`?domain=` pointing at a locked domain on `/`** → zero results (not an error, and the
  name is not echoed back as a chip or suggestion).
- **`?favorite=1` with no favorites** → the "no matches" panel, with a way to clear filters.
- **A stale card** (the link was deleted in another tab) → the action reports "not found" and
  the list refreshes instead of pretending success.
- **Deleting the last link on a page** → the list (or its empty state) updates.
- **A very long title/url in the inline editor** → capped by the same validation as the API.
- **Passcode brute force** → failed attempts are logged (`locked_unlock_failed`) with the
  client IP, like the dashboard login.

---

## 8. Amendment — 2026-10-18 (no minimum length for the two secrets)

Requested by the owner: *"hilangkan requirement passcode dan login password untuk minimal 16
karakter. Tolong buat bebas saja."* Both `DASHBOARD_PASSWORD` and `LOCKED_PASSCODE` may now be
any value; the 16-character minimum is gone.

| # | Amended rule |
| --- | --- |
| A1 | `MIN_PASSWORD_LENGTH` and `MIN_PASSCODE_LENGTH` no longer exist. |
| A2 | "Configured" means *not blank*: `undefined`, `""`, and a whitespace-only value are still unconfigured and keep answering `503`. Everything else — one character upwards — is accepted. |
| A3 | The `503` messages no longer mention a length. |
| A4 | Nothing else changes: both secrets are still compared in constant time over the raw value (spaces stay significant), the cookies keep their signature contexts and TTLs, and the `503` bodies/status codes are the same. |

Supersedes decision D7 of `docs/dashboard-login-navbar/requirements.md` and decision 2 of the
feature's architecture plan (§8 there); implementation note 14 in that plan records the change.
A long random value is still the recommended choice, and the README says so.
