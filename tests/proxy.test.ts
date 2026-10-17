import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { config, proxy } from "@/proxy";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  signSession,
} from "@/lib/session";

const PASSWORD = "correct-horse-battery";
const NOW = Date.now();

function request(
  path = "/",
  options: { token?: string | null; url?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};

  if (options.token !== undefined && options.token !== null) {
    headers.cookie = `${SESSION_COOKIE_NAME}=${options.token}`;
  }

  return new NextRequest(new URL(options.url ?? `https://app.test${path}`), {
    headers,
  });
}

describe("proxy gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets an authenticated request through", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const token = signSession({ now: NOW, secret: PASSWORD });

    expect(proxy(request("/", { token }))).toBeUndefined();
  });

  it("redirects an anonymous visitor to the login page", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = proxy(request("/"));

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(
      "https://app.test/login?next=%2F",
    );
  });

  it("remembers the requested page, including its query string", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = proxy(request("/links?page=2"));

    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/links?page=2");
  });

  it("never sends a Basic Auth challenge, so no browser popup appears", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const response = proxy(request("/"));

    expect(response?.headers.get("www-authenticate")).toBeNull();
  });

  it("redirects an expired session", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const token = signSession({
      now: NOW - SESSION_TTL_MS - 1000,
      secret: PASSWORD,
    });

    expect(proxy(request("/", { token }))?.status).toBe(307);
  });

  it("redirects a forged session", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    expect(proxy(request("/", { token: "1234.deadbeef" }))?.status).toBe(307);
  });

  it("redirects a session signed with a different password", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", PASSWORD);

    const token = signSession({ now: NOW, secret: "an-old-password-value" });

    expect(proxy(request("/", { token }))?.status).toBe(307);
  });

  it("fails closed with a 503 when the password is not configured", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");

    const response = proxy(request("/"));

    expect(response?.status).toBe(503);
    expect(response?.headers.get("location")).toBeNull();
  });

  it("fails closed when the configured password is too short", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "short");

    expect(proxy(request("/"))?.status).toBe(503);
  });
});

describe("proxy matcher", () => {
  // Next matches the matcher against the whole path, so anchor the pattern here
  // too instead of letting the regex match a substring mid-path.
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/", "/links", "/anything/deep"])(
    "guards %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );

  it.each([
    "/login",
    "/logout",
    "/api/links",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/health",
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
  ])("leaves %s ungated", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
