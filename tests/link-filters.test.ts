import { describe, expect, it } from "vitest";

import {
  buildAlbumsHref,
  buildLinksHref,
  buildTabHref,
  formatLinkCount,
  hasActiveFilters,
  MAX_ALBUM_QUERY_LENGTH,
  MAX_DOMAIN_LENGTH,
  MAX_QUERY_LENGTH,
  resolveAlbumQuery,
  resolveLinkFilters,
  resolveTab,
  type LinkFilters,
} from "@/lib/link-filters";

const NONE: LinkFilters = {
  query: "",
  domain: "",
  album: "",
  favorite: false,
};

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
      album: "",
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

  describe("album membership", () => {
    it("is All when the parameter is absent", () => {
      expect(resolveLinkFilters({}).album).toBe("");
    });

    it.each(["in", "none", "IN", " None "])(
      "reads %s as a membership filter",
      (value) => {
        expect(resolveLinkFilters({ album: value }).album).toBe(
          value.trim().toLowerCase(),
        );
      },
    );

    it.each(["", "   ", "all", "yes", "maybe", "2"])(
      "falls back to All for %s",
      (value) => {
        expect(resolveLinkFilters({ album: value }).album).toBe("");
      },
    );

    it("uses the first value when the parameter repeats", () => {
      expect(resolveLinkFilters({ album: ["in", "none"] }).album).toBe("in");
      expect(resolveLinkFilters({ album: ["junk", "none"] }).album).toBe("");
    });

    it("does not throw on an empty repeated parameter", () => {
      expect(resolveLinkFilters({ album: [] }).album).toBe("");
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

  it("is true for each album membership value", () => {
    expect(hasActiveFilters({ ...NONE, album: "in" })).toBe(true);
    expect(hasActiveFilters({ ...NONE, album: "none" })).toBe(true);
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
      buildLinksHref({
        query: "hotel",
        domain: "example.com",
        album: "",
        favorite: true,
      }),
    ).toBe("/?domain=example.com&q=hotel&favorite=1");
  });

  it("writes the album filter after the domain", () => {
    expect(buildLinksHref({ ...NONE, domain: "example.com", album: "in" })).toBe(
      "/?domain=example.com&album=in",
    );
  });

  it("writes the album filter on its own", () => {
    expect(buildLinksHref({ ...NONE, album: "none" })).toBe("/?album=none");
  });

  it("writes the full filter set in a stable order", () => {
    expect(
      buildLinksHref({
        query: "hotel",
        domain: "example.com",
        album: "in",
        favorite: true,
      }),
    ).toBe("/?domain=example.com&album=in&q=hotel&favorite=1");
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
      album: "none",
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

describe("resolveTab", () => {
  it("defaults to the links tab", () => {
    expect(resolveTab({})).toBe("links");
  });

  it.each(["albums", "album", "Albums", "ALBUMS"])(
    "reads %s as the albums tab",
    (value) => {
      expect(resolveTab({ tab: value })).toBe("albums");
    },
  );

  it.each(["links", "", "junk", "album 1"])(
    "reads %s as the links tab",
    (value) => {
      expect(resolveTab({ tab: value })).toBe("links");
    },
  );

  it("uses the first value when the parameter repeats", () => {
    expect(resolveTab({ tab: ["albums", "links"] })).toBe("albums");
    expect(resolveTab({ tab: ["links", "albums"] })).toBe("links");
  });
});

describe("resolveAlbumQuery", () => {
  it("is empty without a parameter", () => {
    expect(resolveAlbumQuery({})).toBe("");
  });

  it("keeps and trims the album search", () => {
    expect(resolveAlbumQuery({ aq: "  Anime  " })).toBe("Anime");
  });

  it("treats a whitespace-only value as no search", () => {
    expect(resolveAlbumQuery({ aq: "   " })).toBe("");
  });

  it("caps an over-long value", () => {
    expect(
      resolveAlbumQuery({ aq: "a".repeat(MAX_ALBUM_QUERY_LENGTH + 20) }),
    ).toHaveLength(MAX_ALBUM_QUERY_LENGTH);
  });

  it("ignores the links tab's own query parameter", () => {
    expect(resolveAlbumQuery({ q: "anime" })).toBe("");
  });

  it("uses the first value when the parameter repeats", () => {
    expect(resolveAlbumQuery({ aq: ["one", "two"] })).toBe("one");
  });

  it("does not throw on an empty repeated parameter", () => {
    expect(resolveAlbumQuery({ aq: [] })).toBe("");
  });
});

describe("buildTabHref", () => {
  it("points the links tab at the bare path", () => {
    expect(buildTabHref("links")).toBe("/");
  });

  it("marks the albums tab in the query string", () => {
    expect(buildTabHref("albums")).toBe("/?tab=albums");
  });

  it("supports the locked base path", () => {
    expect(buildTabHref("albums", "/locked")).toBe("/locked?tab=albums");
  });

  it("drops the other tab's filters, so switching tabs starts clean", () => {
    expect(buildTabHref("albums")).not.toContain("q=");
    expect(buildTabHref("albums")).not.toContain("album=");
    expect(buildTabHref("links")).not.toContain("tab=");
  });

  it("round-trips through resolveTab", () => {
    expect(resolveTab(Object.fromEntries(searchOf(buildTabHref("albums"))))).toBe(
      "albums",
    );
    expect(resolveTab(Object.fromEntries(searchOf(buildTabHref("links"))))).toBe(
      "links",
    );
  });
});

describe("buildAlbumsHref", () => {
  it("keeps the albums tab with no search", () => {
    expect(buildAlbumsHref("")).toBe("/?tab=albums");
  });

  it("writes the album search after the tab", () => {
    expect(buildAlbumsHref("Anime")).toBe("/?tab=albums&aq=Anime");
  });

  it("encodes characters that cannot appear raw in a URL", () => {
    const href = buildAlbumsHref("my album & more");

    expect(href).not.toContain(" ");
    expect(searchOf(href).get("aq")).toBe("my album & more");
  });

  it("supports the locked base path", () => {
    expect(buildAlbumsHref("Anime", "/locked")).toBe("/locked?tab=albums&aq=Anime");
  });

  it("round-trips through the resolvers", () => {
    const href = buildAlbumsHref("Anime");
    const params = Object.fromEntries(searchOf(href));

    expect(resolveTab(params)).toBe("albums");
    expect(resolveAlbumQuery(params)).toBe("Anime");
  });
});
