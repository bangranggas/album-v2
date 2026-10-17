import { afterEach, describe, expect, it, vi } from "vitest";

import { extractDomain, extractIp, logEvent } from "@/lib/logger";

describe("extractDomain", () => {
  it("returns the lowercased hostname", () => {
    expect(extractDomain("https://WWW.Example.COM/article?x=1")).toBe(
      "www.example.com",
    );
  });

  it("keeps the port when present", () => {
    expect(extractDomain("http://localhost:3000/links")).toBe("localhost:3000");
  });

  it.each([
    ["an empty string", ""],
    ["a relative path", "/article"],
    ["a bare word", "not a url"],
  ])("returns 'invalid' for %s", (_label, value) => {
    expect(extractDomain(value)).toBe("invalid");
  });
});

describe("extractIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const request = new Request("https://app.test/api/links", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" },
    });

    expect(extractIp(request)).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace", () => {
    const request = new Request("https://app.test/api/links", {
      headers: { "x-forwarded-for": "  203.0.113.7  " },
    });

    expect(extractIp(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    const request = new Request("https://app.test/api/links", {
      headers: { "x-real-ip": "198.51.100.9" },
    });

    expect(extractIp(request)).toBe("198.51.100.9");
  });

  it("returns 'unknown' when no forwarding header exists", () => {
    const request = new Request("https://app.test/api/links");

    expect(extractIp(request)).toBe("unknown");
  });

  it("returns 'unknown' for an empty forwarding header", () => {
    const request = new Request("https://app.test/api/links", {
      headers: { "x-forwarded-for": "   " },
    });

    expect(extractIp(request)).toBe("unknown");
  });
});

describe("logEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a single JSON line containing the event and its properties", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logEvent("api_link_saved", { url_domain: "example.com", latency_ms: 12 });

    expect(spy).toHaveBeenCalledTimes(1);

    const [line] = spy.mock.calls[0] ?? [];
    const parsed = JSON.parse(String(line));

    expect(parsed).toMatchObject({
      level: "info",
      event: "api_link_saved",
      url_domain: "example.com",
      latency_ms: 12,
    });
    expect(typeof parsed.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
  });

  it("uses the error level for failures", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logEvent("api_error", { route: "/api/links", message: "boom" }, "error");

    expect(spy).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("boom");
  });

  it("never throws when the payload cannot be serialized", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logEvent("api_error", { circular })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
