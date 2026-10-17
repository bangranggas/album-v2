import { describe, expect, it } from "vitest";

import {
  buildLinksHref,
  formatLinkCount,
  hasActiveFilters,
  MAX_DOMAIN_LENGTH,
  MAX_QUERY_LENGTH,
  resolveLinkFilters,
  type LinkFilters,
} from "@/lib/link-filters";

const NONE: LinkFilters = { query: "", domain: "", favorite: false };

function searchOf(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("resolveLinkFilters", () => {
  it("returns empty filters for no parameters", () => {
    expect(resolveLinkFilters({})).toEqual(NONE);
  });

  it("keeps a plain query and domain", () => {
    expect(resolveLinkFilters({ q: "hotel", domain: "example.com" })).toEqual({
      ...NONE,
      query: "hotel",
      domain: "example.com",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveLinkFilters({ q: "  hotel  ", domain: " example.com " })).toEqual({
      query: "hotel",
      domain: "example.com",
      favorite: false,
    });
  });

  it("treats whitespace-only values as no filter", () => {
    expect(resolveLinkFilters({ q: "   ", domain: "\t" })).toEqual(NONE);
  });

  it("lowercases the domain, because stored domains are lowercased", () => {
    expect(resolveLinkFilters({ domain: "Example.COM" }).domain).toBe("example.com");
  });

  it("does not lowercase the query, which is matched case-insensitively anyway", () => {
    expect(resolveLinkFilters({ q: "HoTeL" }).query).toBe("HoTeL");
  });

  it("takes the first value when a parameter repeats", () => {
    expect(resolveLinkFilters({ q: ["one", "two"], domain: ["a.com", "b.com"] })).toEqual(
      { ...NONE, query: "one", domain: "a.com" },
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

  describe("favorites", () => {
    it("is off when the parameter is absent", () => {
      expect(resolveLinkFilters({}).favorite).toBe(false);
    });

    it.each(["1", "true", "on", "TRUE", "yes"])(
      "is on for %s",
      (value) => {
        expect(resolveLinkFilters({ favorite: value }).favorite).toBe(true);
      },
    );

    it.each(["", "0", "false", "no", "junk", "2"])(
      "is off for %s",
      (value) => {
        expect(resolveLinkFilters({ favorite: value }).favorite).toBe(false);
      },
    );

    it("uses the first value when the parameter repeats", () => {
      expect(resolveLinkFilters({ favorite: ["1", "0"] }).favorite).toBe(true);
    });
  });
});

describe("hasActiveFilters", () => {
  it("is false when nothing is filtered", () => {
    expect(hasActiveFilters(NONE)).toBe(false);
  });

  it("is true when only the query is set", () => {
    expect(hasActiveFilters({ ...NONE, query: "hotel" })).toBe(true);
  });

  it("is true when only the domain is set", () => {
    expect(hasActiveFilters({ ...NONE, domain: "example.com" })).toBe(true);
  });

  it("is true when only favorites are selected", () => {
    expect(hasActiveFilters({ ...NONE, favorite: true })).toBe(true);
  });
});

describe("buildLinksHref", () => {
  it("returns the bare path when nothing is filtered", () => {
    expect(buildLinksHref(NONE)).toBe("/");
  });

  it("writes only the domain when there is no query", () => {
    expect(buildLinksHref({ ...NONE, domain: "example.com" })).toBe(
      "/?domain=example.com",
    );
  });

  it("writes only the query when there is no domain", () => {
    expect(buildLinksHref({ ...NONE, query: "hotel" })).toBe("/?q=hotel");
  });

  it("writes both, domain first", () => {
    expect(buildLinksHref({ ...NONE, query: "hotel", domain: "example.com" })).toBe(
      "/?domain=example.com&q=hotel",
    );
  });

  it("writes the favorites flag last, after the other filters", () => {
    expect(
      buildLinksHref({ query: "hotel", domain: "example.com", favorite: true }),
    ).toBe("/?domain=example.com&q=hotel&favorite=1");
  });

  it("writes favorites on its own", () => {
    expect(buildLinksHref({ ...NONE, favorite: true })).toBe("/?favorite=1");
  });

  it("encodes characters that cannot appear raw in a URL", () => {
    const href = buildLinksHref({ ...NONE, query: "a & b?c=d" });

    expect(href).not.toContain(" ");
    expect(href).not.toContain("&b");
    expect(searchOf(href).get("q")).toBe("a & b?c=d");
  });

  it("round-trips through resolveLinkFilters", () => {
    const filters: LinkFilters = {
      query: "maen di hotel",
      domain: "www.indoav.com",
      favorite: true,
    };

    expect(resolveLinkFilters(Object.fromEntries(searchOf(buildLinksHref(filters))))).toEqual(
      filters,
    );
  });

  it("supports a different base path", () => {
    expect(buildLinksHref({ ...NONE, domain: "example.com" }, "/links")).toBe(
      "/links?domain=example.com",
    );
  });
});

describe("formatLinkCount", () => {
  it("states the total when nothing is filtered", () => {
    expect(formatLinkCount(5, 5, false)).toBe("5 links");
  });

  it("uses the singular for one link", () => {
    expect(formatLinkCount(1, 1, false)).toBe("1 link");
  });

  it("reads as 'shown of total' while filtering", () => {
    expect(formatLinkCount(3, 5, true)).toBe("3 of 5 links");
  });

  it("stays singular on a filtered set of one", () => {
    expect(formatLinkCount(1, 1, true)).toBe("1 of 1 link");
  });

  it("handles an empty result set", () => {
    expect(formatLinkCount(0, 5, true)).toBe("0 of 5 links");
    expect(formatLinkCount(0, 0, false)).toBe("0 links");
  });
});
