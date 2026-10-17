import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, verifySession } from "@/lib/session";

const PASSWORD = "correct-horse-battery";

function loginRequest(body: unknown, raw?: string): Request {
  return new Request("https://app.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

/** Extracts the session cookie value from a `set-cookie` header. */
function sessionCookieValue(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (header === null) return null;

  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`).exec(header);
  return match ? (match[1] ?? null) : null;
}

function spyOnConsole() {
  return {
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

function loggedEvents(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => {
    const parsed = JSON.parse(String(call[0])) as { event: string };
    return parsed.event;
  });
}

describe("POST /api/auth/login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts the configured password and issues a session cookie", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);
    const console_ = spyOnConsole();

    const response = await login(loginRequest({ password: PASSWORD }));
    const token = sessionCookieValue(response);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(token).not.toBeNull();
    expect(
      verifySession(token, { now: Date.now(), secret: PASSWORD }).valid,
    ).toBe(true);

    expect(loggedEvents(console_.info)).toContain("dashboard_login_succeeded");
  });

  it("marks the cookie HttpOnly, SameSite=Lax, Path=/, with a seven day max age", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = await login(loginRequest({ password: PASSWORD }));
    const header = response.headers.get("set-cookie") ?? "";

    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
    expect(header).toMatch(
      new RegExp(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`, "i"),
    );
  });

  it("omits Secure outside production and sets it in production", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    vi.stubEnv("NODE_ENV", "test");
    const devResponse = await login(loginRequest({ password: PASSWORD }));
    expect(devResponse.headers.get("set-cookie")).not.toMatch(/Secure/i);

    vi.stubEnv("NODE_ENV", "production");
    const prodResponse = await login(loginRequest({ password: PASSWORD }));
    expect(prodResponse.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("rejects a wrong password without issuing a cookie", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);
    const console_ = spyOnConsole();

    const response = await login(loginRequest({ password: "wrong-password-here" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    expect(sessionCookieValue(response)).toBeNull();
    expect(loggedEvents(console_.error)).toContain("dashboard_login_failed");
  });

  it("does not accept the password in a username field", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = await login(loginRequest({ username: PASSWORD }));

    expect(response.status).toBe(400);
    expect(sessionCookieValue(response)).toBeNull();
  });

  it("rejects an empty password", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = await login(loginRequest({ password: "" }));

    expect(response.status).toBe(400);
    expect(sessionCookieValue(response)).toBeNull();
  });

  it("rejects a body that is not valid JSON", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = await login(loginRequest(null, "not json at all"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_JSON" },
    });
    expect(sessionCookieValue(response)).toBeNull();
  });

  it("rejects a non-object body", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = await login(loginRequest(null, '"just-a-string"'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("accepts a password containing spaces exactly as typed", async () => {
    const spaced = "correct horse battery";
    vi.stubEnv("DASHBOARD_PASSWORD", spaced);

    const response = await login(loginRequest({ password: spaced }));

    expect(response.status).toBe(200);
  });

  it("reports 503 when the dashboard password is not configured", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const console_ = spyOnConsole();

    const response = await login(loginRequest({ password: PASSWORD }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNCONFIGURED" },
    });
    expect(sessionCookieValue(response)).toBeNull();
    expect(loggedEvents(console_.error)).toContain("dashboard_login_failed");
  });

  it("reports 503 when the configured password is too short", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "short");

    const response = await login(loginRequest({ password: "short" }));

    expect(response.status).toBe(503);
  });
});

describe("POST /api/auth/logout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clears the session cookie", async () => {
    const response = await logout();

    expect(response.status).toBe(200);
    expect(sessionCookieValue(response)).toBe("");

    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/Max-Age=0/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\//i);
  });
});
