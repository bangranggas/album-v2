import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HermesGuide } from "@/components/HermesGuide";
import { NAV_ITEMS } from "@/lib/nav";
import { originFromHeaders } from "@/lib/request-origin";

function headers(entries: Record<string, string>) {
  return new Headers(entries);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("navbar", () => {
  it("keeps Links first and adds a Docs entry that points at /docs", () => {
    expect(NAV_ITEMS[0]).toEqual({ href: "/", label: "Links" });
    expect(NAV_ITEMS).toContainEqual({ href: "/docs", label: "Docs" });
  });
});

describe("originFromHeaders", () => {
  it("prefers the forwarded host and protocol (what Vercel sends)", () => {
    expect(
      originFromHeaders(
        headers({
          "x-forwarded-host": "links.example.app",
          "x-forwarded-proto": "https",
          host: "internal:3000",
        }),
      ),
    ).toBe("https://links.example.app");
  });

  it("falls back to host, using http for localhost and https elsewhere", () => {
    expect(originFromHeaders(headers({ host: "localhost:4200" }))).toBe("http://localhost:4200");
    expect(originFromHeaders(headers({ host: "links.example.app" }))).toBe(
      "https://links.example.app",
    );
  });

  it("returns null when no host is known, and ignores a malformed one", () => {
    expect(originFromHeaders(headers({}))).toBeNull();
    expect(originFromHeaders(headers({ host: "bad host/with spaces" }))).toBeNull();
  });
});

describe("HermesGuide", () => {
  const html = (baseUrl = "https://links.example.app") =>
    renderToString(createElement(HermesGuide, { baseUrl }));

  it("shows this deployment's address in the setup commands", () => {
    expect(html("https://links.example.app")).toContain(
      "LC_BASE_URL=https://links.example.app",
    );
  });

  it("covers install, the commands, the rules and troubleshooting", () => {
    const page = html();

    for (const part of [
      "agent-skill/link-collector",
      "LC_AGENT_KEY",
      "python lc.py search",
      "--no-album",
      "--passcode",
      "--confirm",
      "20 words",
      "401",
      "403",
      "503",
    ]) {
      expect(page).toContain(part);
    }
  });

  it("explains the private space and the delete confirmation to the owner", () => {
    const page = html();

    expect(page).toMatch(/passcode/i);
    expect(page).toMatch(/never (stores|saves|remembers)/i);
    expect(page).toMatch(/nothing is deleted until/i);
  });

  it("never prints a configured secret", () => {
    vi.stubEnv("AGENT_API_KEY", "agent-key-should-not-appear");
    vi.stubEnv("LOCKED_PASSCODE", "passcode-should-not-appear");
    vi.stubEnv("DASHBOARD_PASSWORD", "dashboard-should-not-appear");

    const page = html();

    expect(page).not.toContain("should-not-appear");
  });
});
