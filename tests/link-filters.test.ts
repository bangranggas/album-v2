import { describe, expect, it } from "vitest";

import {
  buildLinksHref,
  hasActiveFilters,
  MAX_DOMAIN_LENGTH,
  MAX_QUERY_LENGTH,
  resolveLinkFilters,
} from "@/lib/link-filters";

function searchOf(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("resolveLinkFilters", () => {
  it("returns empty filters for no parameters", () => {
    expect(resolveLinkFilters({})).toEqual({ query: "", domain: "" });
  });

  it("keeps a plain query and domain", () => {
    expect(resolveLinkFilters({ q: "hotel", domain: "example.com" })).toEqual({
      query: "hotel",
      domain: "example.com",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveLinkFilters({ q: "  hotel  ", domain: " example.com " })).toEqual({
      query: "hotel",
      domain: "example.com",
    });
  });

  it("treats whitespace-only values as no filter", () => {
    expect(resolveLinkFilters({ q: "   ", domain: "\t" })).toEqual({
      query: "",
      domain: "",
    });
  });

  it("lowercases the domain, because stored domains are lowercased", () => {
    expect(resolveLinkFilters({ domain: "Example.COM" }).domain).toBe("example.com");
  });

  it("does not lowercase the query, which is matched case-insensitively anyway", () => {
    expect(resolveLinkFilters({ q: "HoTeL" }).query).toBe("HoTeL");
  });

  it("takes the first value when a parameter repeats", () => {
    expect(resolveLinkFilters({ q: ["one", "two"], domain: ["a.com", "b.com"] })).toEqual(
      { query: "one", domain: "a.com" },
    );
  });

  it("caps an over-long query instead of ignoring it", () => {
    const filters = resolveLinkFilters({ q: "a".repeat(MAX_QUERY_LENGTH + 50) });

    expect(filters.query).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("caps an over-long domain", () => {
    const filters = resolveLinkFilters({ domain: "a".repeat(MAX_DOMAIN_LENGTH + 10) });

    expect(filters.domain).toHaveLength(MAX_DOMAIN_LENGTH);
  });

  it("keeps punctuation, which is matched literally", () => {
    expect(resolveLinkFilters({ q: "100%_off" }).query).toBe("100%_off");
  });

  it("does not throw on an undefined value inside a repeated parameter", () => {
    expect(resolveLinkFilters({ q: [] }).query).toBe("");
  });
});

describe("hasActiveFilters", () => {
  it("is false when nothing is filtered", () => {
    expect(hasActiveFilters({ query: "", domain: "" })).toBe(false);
  });

  it("is true when only the query is set", () => {
    expect(hasActiveFilters({ query: "hotel", domain: "" })).toBe(true);
  });

  it("is true when only the domain is set", () => {
    expect(hasActiveFilters({ query: "", domain: "example.com" })).toBe(true);
  });
});

describe("buildLinksHref", () => {
  it("returns the bare path when nothing is filtered", () => {
    expect(buildLinksHref({ query: "", domain: "" })).toBe("/");
  });

  it("writes only the domain when there is no query", () => {
    expect(buildLinksHref({ query: "", domain: "example.com" })).toBe(
      "/?domain=example.com",
    );
  });

  it("writes only the query when there is no domain", () => {
    expect(buildLinksHref({ query: "hotel", domain: "" })).toBe("/?q=hotel");
  });

  it("writes both, domain first", () => {
    expect(buildLinksHref({ query: "hotel", domain: "example.com" })).toBe(
      "/?domain=example.com&q=hotel",
    );
  });

  it("encodes characters that cannot appear raw in a URL", () => {
    const href = buildLinksHref({ query: "a & b?c=d", domain: "" });

    expect(href).not.toContain(" ");
    expect(href).not.toContain("&b");
    expect(searchOf(href).get("q")).toBe("a & b?c=d");
  });

  it("round-trips through resolveLinkFilters", () => {
    const filters = { query: "maen di hotel", domain: "www.indoav.com" };

    expect(resolveLinkFilters(Object.fromEntries(searchOf(buildLinksHref(filters))))).toEqual(
      filters,
    );
  });

  it("supports a different base path", () => {
    expect(buildLinksHref({ query: "", domain: "example.com" }, "/links")).toBe(
      "/links?domain=example.com",
    );
  });
});
