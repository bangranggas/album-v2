# Architecture Plan — Dashboard Login Page, Navbar, and Turso Setup Guide

**Slug:** `dashboard-login-navbar`
**Status:** Awaiting approval (Phase 2)
**Requirements:** `docs/dashboard-login-navbar/requirements.md`

---

## 1. Approach

Keep the Module 1 architecture and swap only the dashboard gate: instead of reading an
`Authorization: Basic` header, `proxy.ts` reads a **signed session cookie**. Login and
logout become small route handlers under `/api/auth/*` (already excluded from the gate,
so they can create the very session the gate checks). The dashboard moves into a route
group `(app)` whose layout renders the new navbar, leaving `/login` navbar-free.

No new runtime dependency, no new environment variable, no session table.

---

## 2. Module boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/session.ts` | Sign/verify the session token. Pure crypto, no Next.js, no I/O. | `node:crypto`, `@/lib/auth` (`constantTimeEqual`) |
| `src/lib/dashboard-auth.ts` | Decide the gate outcome and check a submitted password. Pure logic. | `@/lib/session` |
| `src/lib/nav.ts` | The navbar item list (the extension point for future modules). | — |
| `src/proxy.ts` | Turn a gate decision into HTTP (allow / `302 /login` / `503`). | `next/server`, `@/lib/dashboard-auth` |
| `src/app/api/auth/login/route.ts` | Validate the password, set the session cookie, log the attempt. | `next/server`, `@/lib/dashboard-auth`, `@/lib/logger` |
| `src/app/api/auth/logout/route.ts` | Clear the session cookie. | `next/server` |
| `src/app/login/page.tsx` | Server-rendered login shell: redirect if already in, unconfigured state, `next` validation. | `next/headers`, `next/navigation`, `@/lib/dashboard-auth` |
| `src/app/login/login-form.tsx` | Client form: one password field, submit, show error, navigate. | `next/navigation` |
| `src/app/(app)/layout.tsx` | Renders the navbar around authenticated pages. | `@/components/Navbar` |
| `src/components/Navbar.tsx` | Brand + nav links + logout. | `@/lib/nav` |
| `src/components/NavLinks.tsx` | Client sub-component that highlights the active item. | `next/navigation` |
| `src/components/LogoutButton.tsx` | Client button that POSTs to `/api/auth/logout`. | `next/navigation` |

---

## 3. Data structures

**Session token** — `"<expiresAtMs>.<hmacSha256Hex>"`, where the signature covers the
expiry string only. Stateless; nothing is stored server-side.

**Signing key** — `HMAC-SHA256(secret = DASHBOARD_PASSWORD, message = "link-collector/dashboard-session")`,
hex. Purpose-bound so the password is never used directly as a key.

**Cookie** — `lc_session=<token>`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when
`NODE_ENV === "production"`, `Max-Age=604800` (7 days).

**Gate decision** (`evaluateDashboardGate`) →
`{ action: "allow" } | { action: "redirect" } | { action: "unconfigured" }`.

**Login request** — `POST /api/auth/login`, body `{ "password": string }`.

**Login responses**

| Status | Body | Cookie |
| --- | --- | --- |
| 200 | `{ ok: true }` | `lc_session` set |
| 400 | `{ ok: false, error: { code: "INVALID_JSON", ... } }` | none |
| 401 | `{ ok: false, error: { code: "UNAUTHORIZED", ... } }` | none |
| 503 | `{ ok: false, error: { code: "UNCONFIGURED", ... } }` | none |

Error bodies reuse `apiError()` from `src/types/api.ts` so the wire format stays uniform.

---

## 4. File mapping

### Created
| File | Purpose |
| --- | --- |
| `src/lib/session.ts` | `SESSION_COOKIE_NAME`, `SESSION_TTL_MS`, `signSession`, `verifySession` |
| `src/lib/dashboard-auth.ts` | `MIN_PASSWORD_LENGTH`, `isDashboardPasswordConfigured`, `verifyDashboardPassword`, `evaluateDashboardGate` |
| `src/lib/nav.ts` | `NAV_ITEMS: { href, label }[]` |
| `src/app/api/auth/login/route.ts` | `POST` login |
| `src/app/api/auth/logout/route.ts` | `POST` logout |
| `src/app/login/page.tsx` | Login page (server) |
| `src/app/login/login-form.tsx` | Login form (client) |
| `src/app/(app)/layout.tsx` | Navbar layout for authenticated pages |
| `src/app/(app)/page.tsx` | Dashboard, moved unchanged from `src/app/page.tsx` |
| `src/components/Navbar.tsx` | Top navigation |
| `src/components/NavLinks.tsx` | Active-aware nav links (client) |
| `src/components/LogoutButton.tsx` | Logout control (client) |
| `tests/session.test.ts` | Session sign/verify unit tests |
| `tests/dashboard-auth.test.ts` | Gate + password check unit tests |
| `tests/auth-routes.test.ts` | Login/logout route handler tests |
| `docs/dashboard-login-navbar/*.md` | These documents |

### Modified
| File | Change |
| --- | --- |
| `src/proxy.ts` | Cookie-based gate; `302 /login?next=...`; matcher excludes `login`/`logout`; keeps `503` for unconfigured |
| `README.md` | Login section, navbar notes, **Turso setup guide**, test table, project layout, security notes |

### Deleted
| File | Reason |
| --- | --- |
| `src/lib/basic-auth.ts` | Replaced by `src/lib/dashboard-auth.ts` |
| `tests/basic-auth.test.ts` | Replaced by `tests/dashboard-auth.test.ts` |
| `src/app/page.tsx` | Moved to `src/app/(app)/page.tsx` (both would claim `/`) |

### Unchanged (deliberately)
`src/lib/auth.ts` (`SECRET_KEY`), all of `src/db/**`, `src/app/api/links/route.ts`,
`src/app/api/health/route.ts`, `src/types/api.ts`, `userscript/**`, `src/lib/{logger,time,validation}.ts`.

---

## 5. Key implementation notes

1. **DRY:** `constantTimeEqual` already exists in `src/lib/auth.ts` and is exported —
   `dashboard-auth.ts` imports it instead of defining a third copy.
2. **`proxy.ts` stays a pure gate.** It only checks the session; it never verifies a
   password. This is why the decision logic is split from the response logic, mirroring
   the existing `evaluateDashboardGate` design.
3. **No open redirect.** The `next` value is accepted only when it starts with a single
   `/` and is not `/login`; otherwise it falls back to `/`.
4. **Next 16 async APIs:** `cookies()` and page `searchParams` are awaited.
5. **`/login` and `(app)`** are siblings; the route group adds no URL segment, so the
   dashboard stays at `/`.
6. **Cookie writing in tests:** the primary implementation uses `NextResponse.json(...)`
   plus `response.cookies.set(...)`. If `next/server` misbehaves under Vitest, the
   fallback is to build the `Set-Cookie` string in `src/lib/session.ts`
   (`serializeSessionCookie`) and attach it as a header, which also makes the cookie
   attributes unit-testable. *(Risk noted; resolved in Phase 3.)*

---

## 6. Execution checklist (Phase 5 order)

1. **RED** `tests/session.test.ts` → **GREEN** `src/lib/session.ts`.
2. **RED** `tests/dashboard-auth.test.ts` → **GREEN** `src/lib/dashboard-auth.ts`;
   delete `basic-auth.ts` + its test.
3. **RED** `tests/auth-routes.test.ts` → **GREEN** login/logout route handlers.
4. Rewrite `src/proxy.ts` for the session gate.
5. Add `src/lib/nav.ts` + `Navbar`/`NavLinks`/`LogoutButton`.
6. Create the `(app)` route group (move `page.tsx`, add layout); delete the old page.
7. Add `/login` page + form.
8. Update `README.md` (login, navbar, Turso guide, test table, layout, security).
9. Verify: `npm run test`, `npm run lint`, `npm run build`, then an end-to-end pass on
   port 4200 (redirect, wrong password, cookie set, dashboard, logout, tampering,
   `503` when unconfigured) — and confirm the Module 1 userscript flow still works.

**Checkpoint after step 4** (gate working end to end) and **after step 7** (UI complete)
before the README and final verification.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Moving `page.tsx` breaks the `/` route | Move and delete in the same step, then `build` + smoke-test `/`. |
| `Set-Cookie` guard issues under Vitest | Fallback noted in §5.6. |
| Client components in the navbar break the server-rendered dashboard | Only the small `NavLinks`/`LogoutButton` are client; the dashboard stays a server component. |
| Session cookie silently shared across environments | Signature depends on `DASHBOARD_PASSWORD`, so a cookie from another deployment fails verification. |
