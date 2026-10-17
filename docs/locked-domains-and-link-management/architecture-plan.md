# Architecture Plan — Locked Domains, Link Management, Favorites, and Manual Add

**Slug:** `locked-domains-and-link-management`
**Status:** Awaiting approval (Phase 2)
**Requirements:** `docs/locked-domains-and-link-management/requirements.md`

---

## 1. Approach

Four changes, one data model:

1. **Two independent secrets.** `DASHBOARD_PASSWORD` (7-day session) keeps its meaning; a new
   `LOCKED_PASSCODE` signs a second, shorter-lived cookie for the locked area. Both cookies
   are produced by *one* tested token implementation, parameterised by a signature context so
   the two can never be swapped for each other.
2. **Scope is a repository concept, applied in SQL.** Every read takes
   `scope: "visible" | "locked" | "all"`, rendered as `domain NOT IN (SELECT domain FROM
   locked_domains)` or `domain IN (...)` (and no condition at all for `"all"`). Nothing above
   the repository can forget it, and the dropdown/count derive from the same scope.
3. **Locked domains are their own table**, because locking must also hide links saved later.
4. **Link mutations are session-gated route handlers** (`POST`/`PATCH`/`DELETE`), reused by
   both pages; the client calls them and then `router.refresh()`, exactly like the login form.

The dark theme is CSS-scoped, not duplicated markup: `globals.css` gets a class-based `dark`
variant, the `/locked` layout puts `class="dark"` on its wrapper, and the shared components
get `dark:` utilities.

---

## 2. Module boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/signed-token.ts` (new) | Sign/verify `"<expiry>.<hmac>"` for a given context. Pure. | node:crypto |
| `src/lib/session.ts` (modified) | Dashboard session: cookie name, 7-day TTL, wraps `signed-token`. | signed-token |
| `src/lib/locked-session.ts` (new) | Locked session: `lc_locked`, 1-hour TTL, own context. | signed-token |
| `src/lib/locked-auth.ts` (new) | Passcode configuration check, constant-time compare, gate decision. | locked-session |
| `src/lib/api-auth.ts` (new) | "Does this request carry a valid session / locked cookie?" for route handlers. | session, locked-session |
| `src/lib/api-response.ts` (new) | One place that builds `{ ok }` JSON responses and 401/404/409/503 bodies. | types/api |
| `src/lib/link-filters.ts` (modified) | `?q=`, `?domain=`, **`?favorite=1`**, URL building, count label. Pure. | — |
| `src/lib/validation.ts` (modified) | `parseUploadLinkInput` (userscript), `parseManualLinkInput` (optional title), `parseLinkPatch`, `parseLockedDomain`. | zod |
| `src/lib/redirect.ts` (modified) | `resolveNextPath` gains `blockedPrefixes`, so the locked flow also refuses `/locked/unlock`. | — |
| `src/db/schema.ts` (modified) | `links.is_favorite`, new `locked_domains` table. | drizzle |
| `src/db/links.ts` (modified) | Scope + favorite filters; `getLinkById`, `updateLink`, `deleteLink`, `listAllDomains`. | drizzle |
| `src/db/locked-domains.ts` (new) | `listLockedDomains`, `lockDomain`, `unlockDomain`. | drizzle |
| `src/app/api/dashboard/links/*` (new) | Session-gated add / edit / delete. | repository, validation |
| `src/app/api/locked/*` (new) | Unlock, lock, lock/unlock a domain. | locked-auth, repository |
| `src/app/locked/*` (new) | Dark passcode prompt + dark locked dashboard. | repository, components |
| `src/components/LinkActions.tsx` (new) | Star, inline edit, two-step delete. | dashboard API |
| `src/components/AddLinkForm.tsx` (new) | Manual add. | dashboard API |
| `src/components/LockedDomainsPanel.tsx` (new) | Manage the locked domain list. | locked API |
| `src/components/LinkGrid.tsx` (new) | The shared card grid + "no matches" panel. | LinkCard, NoMatches |

`src/proxy.ts`, `src/lib/nav.ts`, the userscript, and `POST`/`GET /api/links` are deliberately
**unchanged** — the proxy already gates `/locked` (it is neither `api` nor `login`), which is
exactly the double-gate the feature wants.

---

## 3. Data structures

### 3.1 Schema

```ts
// links (added)
isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),

// new
export const lockedDomains = sqliteTable("locked_domains", {
  domain: text("domain").primaryKey(),      // lowercased host, same shape as links.domain
  createdAt: integer("created_at").notNull(),
});
export type LockedDomain = typeof lockedDomains.$inferSelect;
```

Migration `drizzle/0002_*.sql` (generated, then reviewed):

```sql
ALTER TABLE `links` ADD `is_favorite` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `locked_domains` (`domain` text PRIMARY KEY NOT NULL, `created_at` integer NOT NULL);
```

No backfill is needed: the default covers every existing row, and `locked_domains` starts
empty (nothing is hidden until the owner says so).

### 3.2 Environment

| Name | Rule |
| --- | --- |
| `LOCKED_PASSCODE` | Required for the locked area. Any non-blank value (no minimum length); missing or blank → `/locked` answers `503`. |

### 3.3 Cookies

| Cookie | Signed with | Context string | TTL | Attributes |
| --- | --- | --- | --- | --- |
| `lc_session` (existing) | `DASHBOARD_PASSWORD` | `link-collector/dashboard-session` | 7 days | `HttpOnly; SameSite=Lax; Path=/; Secure` in production |
| `lc_locked` (new) | `LOCKED_PASSCODE` | `link-collector/locked-session` | 1 hour | identical |

Because the context differs, a token minted for one cookie never verifies for the other, even
if the owner sets both secrets to the same value.

### 3.4 Repository API

```ts
type LinkScope = "visible" | "locked" | "all";

listLinks(db, { limit?, domain?, query?, favorite?, scope? })   // scope defaults to "visible"
listDomains(db, { scope? })                                     // dropdown, scoped
listAllDomains(db)                                              // locked page: suggestions
countLinks(db, { scope? })                                      // "N of M" basis
getLinkById(db, id)
updateLink(db, id, { title?, url?, domain?, thumbnail?, isFavorite? })
  → { ok: true; link } | { ok: false; reason: "not-found" | "url-taken" }
deleteLink(db, id) → boolean

listLockedDomains(db) → { domain: string; count: number; createdAt: number }[]
lockDomain(db, domain) → boolean          // false when already locked (idempotent)
unlockDomain(db, domain) → boolean        // false when it was not locked
```

Scope SQL, rendered once and reused:

```ts
const inLockedScope = (): SQL => sql`${links.domain} IN (SELECT ${lockedDomains.domain} FROM ${lockedDomains})`;
const inVisibleScope = (): SQL => sql`${links.domain} NOT IN (SELECT ${lockedDomains.domain} FROM ${lockedDomains})`;
```

### 3.5 `?favorite=` filter

`resolveLinkFilters` gains `favorite: boolean` (`1`/`true`/`on` → true; anything else → false),
and `buildLinksHref` writes `favorite=1` last. The locked page uses the same helpers, so both
pages share one URL vocabulary.

### 3.6 API contracts

All new endpoints are same-origin, session-gated, and have no CORS headers (unlike
`/api/links`, which exists for the cross-origin userscript).

| Endpoint | Guard | Body / params | Success | Failures |
| --- | --- | --- | --- | --- |
| `POST /api/dashboard/links` | session | `{url, title?, thumbnail?}` | `200 {link, inserted}` | `400`, `401`, `503`, `500` |
| `PATCH /api/dashboard/links/:id` | session | any of `{title, url, thumbnail, isFavorite}` | `200 {link}` | `400`, `401`, `404`, `409` (url taken), `500` |
| `DELETE /api/dashboard/links/:id` | session | — | `200 {deleted:true}` | `401`, `404`, `500` |
| `POST /api/locked/unlock` | session | `{passcode}` | `200 {ok:true}` + `lc_locked` | `400`, `401`, `503` |
| `POST /api/locked/lock` | session + locked | — | `200 {ok:true}` + cookie cleared | `401`, `503` |
| `POST /api/locked/domains` | session + locked | `{domain}` | `200 {domain, created}` | `400`, `401`, `500` |
| `DELETE /api/locked/domains/:domain` | session + locked | — | `200 {removed}` | `401`, `404`, `500` |

New analytics events, following the existing structured-log style:
`dashboard_link_created`, `dashboard_link_updated`, `dashboard_link_deleted`,
`dashboard_link_conflict`, `locked_unlock_succeeded`, `locked_unlock_failed`,
`locked_domain_locked`, `locked_domain_unlocked`.

`ApiLink` gains `domain` and `isFavorite` (purely additive; the userscript ignores unknown
fields, and `toApiLink` is the single mapper).

---

## 4. File mapping

### Created

| File | Purpose |
| --- | --- |
| `src/lib/signed-token.ts` | Context-parameterised `signToken` / `verifyToken` |
| `src/lib/locked-session.ts` | `LOCKED_COOKIE_NAME`, `LOCKED_TTL_MS`, sign/verify |
| `src/lib/locked-auth.ts` | `isLockedPasscodeConfigured`, `verifyLockedPasscode`, `evaluateLockedGate` |
| `src/lib/api-auth.ts` | `hasDashboardSession(request)`, `hasLockedSession(request)` |
| `src/lib/api-response.ts` | `jsonResponse`, `unauthorized`, `notFound`, `conflict`, `unconfigured` |
| `src/db/locked-domains.ts` | Locked-domain CRUD + counts |
| `src/app/api/dashboard/links/route.ts` | `POST` manual add |
| `src/app/api/dashboard/links/[id]/route.ts` | `PATCH` edit / favorite, `DELETE` |
| `src/app/api/locked/unlock/route.ts` | Verify passcode, set `lc_locked` |
| `src/app/api/locked/lock/route.ts` | Clear `lc_locked` |
| `src/app/api/locked/domains/route.ts` | `POST` lock a domain |
| `src/app/api/locked/domains/[domain]/route.ts` | `DELETE` unlock a domain |
| `src/app/locked/layout.tsx` | Dark wrapper (`class="dark"`, `bg-slate-950`) + dark header |
| `src/app/locked/page.tsx` | Locked dashboard (gate → prompt, filters, grid, panel, add form) |
| `src/app/locked/unlock/page.tsx` + `unlock-form.tsx` | Dark passcode prompt |
| `src/components/LinkGrid.tsx` | Shared grid + empty/no-match states |
| `src/components/LinkActions.tsx` | Star, inline edit, two-step delete |
| `src/components/AddLinkForm.tsx` | Manual add (warns on `/locked` when the domain is not locked) |
| `src/components/LockedDomainsPanel.tsx` | Locked-domain list, add, remove |
| `drizzle/0002_*.sql` + `drizzle/meta/0002_snapshot.json` | Schema change |
| `tests/signed-token.test.ts`, `tests/locked-session.test.ts`, `tests/locked-auth.test.ts` | Token + gate logic |
| `tests/locked-domains-repository.test.ts` | Locked-domain CRUD, counts, scope interaction |
| `tests/link-management-routes.test.ts` | `POST`/`PATCH`/`DELETE` handlers |
| `tests/locked-routes.test.ts` | unlock / lock / domains handlers |

### Modified

| File | Change |
| --- | --- |
| `src/app/globals.css` | `@custom-variant dark (&:where(.dark, .dark *))` so the locked subtree can be dark without changing the light theme |
| `src/lib/session.ts` | Delegate to `signed-token` (same exports, same behaviour — existing tests must not change) |
| `src/lib/redirect.ts` | `resolveNextPath(raw, { blockedPrefixes })`, default `["/login"]` |
| `src/lib/link-filters.ts` | `favorite` filter, `favorite=1` in the URL, `formatLinkCount` |
| `src/lib/validation.ts` | Shared field core; `parseManualLinkInput`, `parseLinkPatch`, `parseLockedDomain` |
| `src/db/schema.ts` | `is_favorite`, `locked_domains` |
| `src/db/links.ts` | Scope, favorite filter, `getLinkById`, `updateLink`, `deleteLink`, `listAllDomains` |
| `src/types/api.ts` | `ApiLink` gains `domain` + `isFavorite` |
| `src/app/(app)/page.tsx` | Visible scope, always-rendered filter bar, `LinkGrid`, `AddLinkForm` |
| `src/components/LinkCard.tsx` | `dark:` utilities, favorite badge, renders `LinkActions` |
| `src/components/LinkFilters.tsx` | `dark:` utilities, Favorites toggle, icon-only lock button, scope-aware dropdown |
| `src/components/NoMatches.tsx` | `dark:` utilities, mentions the active filters (incl. favorites) |
| `tests/links-repository.test.ts`, `tests/link-filters.test.ts`, `tests/validation.test.ts`, `tests/redirect.test.ts` | Cover the new behaviour |
| `.env.example` | `LOCKED_PASSCODE`, and fix the stale "HTTP Basic Auth" wording on `DASHBOARD_PASSWORD` |
| `README.md` | Locked area, passcode, edit/delete/favorite, manual add, events |

### Unchanged (deliberately)

`src/proxy.ts` (its matcher already gates `/locked`), `src/lib/nav.ts` (the lock control lives
in the filter bar, as requested), `src/app/api/links/route.ts`, `src/types` CORS behaviour,
`userscript/**`.

---

## 5. Key implementation notes

1. **Hidden must be unescapable.** Scope is applied inside the repository, and `/` passes
   `scope: "visible"` everywhere including `countLinks` and `listDomains`. A test asserts that
   a locked link is absent from the list, the dropdown, the count, and search results.
2. **No leak through suggestions.** The lock panel's datalist is the only place that lists
   *visible* domain names, and it only renders on `/locked`, behind the passcode.
3. **`resolveNextPath` blocks `/locked/unlock`**, so a passcode prompt cannot redirect back to
   itself; `?next=` keeps its open-redirect guards from the login work.
4. **Item-scoped mutation routes validate the id** (UUID shape) and return `404` for an
   unknown row, so a stale card reports "not found" instead of a silent success.
5. **URL conflicts are explicit.** `updateLink` pre-checks the target URL and still catches the
   unique-index error as a safety net, both reported as `409 url-taken`; the edit form shows
   "that URL is already saved" and keeps the draft.
6. **The manual add reuses `upsertLink`.** Pasting an existing URL updates its title instead
   of failing, which matches how the userscript behaves.
7. **Delete confirmation is inline** (button → "Confirm delete" / "Cancel"), never
   `window.confirm`, keeping with the "no browser popups" rule already established.
8. **The passcode is verified in constant time** with the same helper the dashboard password
   uses, and failures are logged with the client IP.
9. **The dark theme is one variant, not a second theme.** `dark:` utilities are added to the
   shared components; `class="dark"` on the locked wrapper activates them, and nothing changes
   on `/`.
10. **Filter bar on `/` is now always rendered** (D11 in the requirements): with locked
    domains, "no visible links" can coexist with a full locked list, and the lock icon must
    stay reachable. The onboarding copy still appears below it when nothing is saved at all.
11. **The 100-row cap applies per scope**, unchanged in character from the filters work.
12. **`ScopeOptions.scope` gained a third value, `"all"`**, during step 6: making `"visible"`
    the repository default (so a page cannot forget to filter) also made `GET /api/links` —
    the userscript's read endpoint — hide hidden links. Since that endpoint is a machine
    interface behind `SECRET_KEY`, it now asks for `"all"` explicitly, and two repository
    tests plus an API test pin the behaviour. The endpoint is still the only caller.
13. **Error-log events are paired with success events** (`dashboard_link_created` vs.
    `dashboard_link_create_failed`, and so on) so a failed mutation is visible in the logs
    without having to infer it from an absent success line.
14. **The minimum length for both secrets was removed at the owner's request** (2026-10-18):
    `MIN_PASSWORD_LENGTH` and `MIN_PASSCODE_LENGTH` are gone, and `isDashboardPasswordConfigured`
    / `isLockedPasscodeConfigured` now accept any value that is not blank (a whitespace-only
    value still counts as unconfigured, so a stray empty-looking variable cannot lock the app
    in or, worse, act as a credential). Everything else is unchanged: blank or missing ⇒ `503`,
    and the `503` messages no longer quote a length. Passwords and passcodes are still compared
    in constant time over the raw value, so leading/trailing spaces stay significant. This
    supersedes decision 2 in §8.

---

## 6. Execution checklist (Phase 5 order)

Each numbered step is RED → GREEN on its own module, with the whole suite run at the
checkpoints.

1. `signed-token.ts` + `tests/signed-token.test.ts`; rewrite `session.ts` on top of it and
   confirm `tests/session.test.ts` still passes untouched. **Checkpoint.**
2. `locked-session.ts` + `locked-auth.ts` (+ tests).
3. `redirect.ts` `blockedPrefixes` (+ tests); `link-filters.ts` `favorite` + `formatLinkCount`
   (+ tests).
4. Schema: `is_favorite` + `locked_domains`, `npm run db:generate`, review `0002`, apply to
   `local.db`; `src/db/locked-domains.ts` and the `links.ts` additions (+ tests).
   **Checkpoint: data layer proven.**
5. `validation.ts`: `parseManualLinkInput`, `parseLinkPatch`, `parseLockedDomain` (+ tests).
6. API: `api-auth.ts`, `api-response.ts`, the dashboard link routes and the locked routes
   (+ tests).
7. UI: `globals.css` dark variant, `LinkGrid`, `LinkActions`, `AddLinkForm`,
   `LockedDomainsPanel`, rewire `/`, the `/locked` layout, page, unlock page. **Checkpoint.**
8. `.env.example`, `README.md`, then verify: `npm run test`, `npm run lint`, `npm run build`,
   plus an end-to-end pass on port 4200 (locked round trip, favorites, edit/delete, manual
   add, "no leak" assertions, and the unchanged userscript/login/filter flows) and the
   `503`-when-unconfigured case on a second port.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| A locked link leaking into `/` through a forgotten query | Scope lives in the repository and is asserted end-to-end (HTML must not contain the domain string). |
| The two cookies being interchangeable | One token implementation, two distinct signature contexts, plus a test that a session token fails as a locked token. |
| Dark styling bleeding into the light dashboard | The variant only matches inside `.dark`; `/` is asserted to contain no `dark` wrapper. |
| Genericising `session.ts` breaking the existing auth | `tests/session.test.ts`, `tests/proxy.test.ts`, and the auth e2e must pass **unchanged**. |
| `ALTER TABLE ... NOT NULL` on the populated `local.db` | The column is added with `DEFAULT false`; applied and verified against the real file. |
| Editing a URL into a locked domain looking like data loss | The edit response refreshes the list; the card moves or disappears with its scope. |
| A stale page fighting the new cookie (1-hour expiry mid-session) | Any locked API call returns `401`, and the UI redirects to the passcode prompt. |
| Scope creep (tags, soft delete, scraping) | Explicitly listed as out of scope in the requirements. |

---

## 8. Decisions I made that you may want to overrule

1. **`GET`/`POST /api/links` (the userscript API) still returns locked links.** It already
   requires `SECRET_KEY` and is machine access, not the interface you look at; hiding would
   also mean the userscript's own reads change. Say the word if you want it to hide them too
   (`?include_locked=1` to opt back in).
2. ~~**`LOCKED_PASSCODE` must be at least 16 characters**~~ — **superseded on 2026-10-18**: the
   owner asked for the minimum to be dropped, so both secrets now accept any non-blank value
   (see §5 note 14). Short values are still allowed but are weaker; a long passphrase remains
   the recommended choice.
3. **Locking/unlocking (the policy) needs both secrets; editing a link needs only the
   dashboard session.** Link ids are UUIDs and are only discoverable after unlocking, so write
   access adds no exposure, and the locked page reuses the same edit/delete endpoints as `/`.
4. **The filter bar is always shown on `/`** so the lock icon is reachable even when every
   saved link is hidden.
