import { describe, expect, it } from "vitest";

import {
  buildAlbumsHref,
  buildLinksHref,
  buildTabHref,
  clearLinkFilters,
  EMPTY_FILTERS,
  formatLinkCount,
  hasActiveFilters,
  MAX_ALBUM_ID_LENGTH,
  MAX_ALBUM_QUERY_LENGTH,
  MAX_DOMAIN_LENGTH,
  MAX_FILTER_VALUES,
  MAX_QUERY_LENGTH,
  resolveAlbumQuery,
  resolveLinkFilters,
  resolveTab,
  withoutAlbumFilter,
  type LinkFilters,
} from "@/lib/link-filters";

const NONE: LinkFilters = EMPTY_FILTERS;

/** Repeated parameters are the point of the new contract, so keep every value. */
function rawOf(href: string): Record<string, string[]> {
  const query = href.slice(href.indexOf("?") + 1);
  const raw: Record<string, string[]> = {};

  for (const [key, value] of new URLSearchParams(query)) {
    (raw[key] ??= []).push(value);
  }

  return raw;
}

describe("resolveLinkFilters", () => {
  it("returns empty filters for no parameters", () => {
    expect(resolveLinkFilters({})).toEqual(NONE);
  });

  it("keeps a plain query and domain include", () => {
    expect(resolveLinkFilters({ q: "hotel", domain: "example.com" })).toEqual({
      ...NONE,
      query: "hotel",
      domains: { include: ["example.com"], exclude: [] },
    });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveLinkFilters({ q: "  hotel  ", domain: " example.com " })).toEqual({
      ...NONE,
      query: "hotel",
      domains: { include: ["example.com"], exclude: [] },
    });
  });

  it("treats whitespace-only values as no filter", () => {
    expect(resolveLinkFilters({ q: "   ", domain: "\t" })).toEqual(NONE);
  });

  it("lowercases domains, because stored domains are lowercased", () => {
    expect(resolveLinkFilters({ domain: "Example.COM" }).domains.include).toEqual([
      "example.com",
    ]);
    expect(
      resolveLinkFilters({ domainExclude: "Ads.Example" }).domains.exclude,
    ).toEqual(["ads.example"]);
  });

  it("does not lowercase the query, which is matched case-insensitively anyway", () => {
    expect(resolveLinkFilters({ q: "HoTeL" }).query).toBe("HoTeL");
  });

  it("takes every repeated value, not just the first", () => {
    expect(
      resolveLinkFilters({ domain: ["a.com", "b.com", "a.com"] }).domains,
    ).toEqual({ include: ["a.com", "b.com"], exclude: [] });
  });

  it("reads domain includes and excludes independently", () => {
    expect(
      resolveLinkFilters({
        domain: ["a.com", "b.com"],
        domainExclude: ["c.com", "D.COM"],
      }).domains,
    ).toEqual({
      include: ["a.com", "b.com"],
      exclude: ["c.com", "d.com"],
    });
  });

  it("keeps a value only in include when it appears in both lists", () => {
    expect(
      resolveLinkFilters({
        domain: ["a.com"],
        domainExclude: ["a.com", "b.com"],
      }).domains,
    ).toEqual({ include: ["a.com"], exclude: ["b.com"] });
  });

  it("caps an over-long query instead of ignoring it", () => {
    const filters = resolveLinkFilters({ q: "a".repeat(MAX_QUERY_LENGTH + 50) });

    expect(filters.query).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("caps an over-long domain", () => {
    const filters = resolveLinkFilters({ domain: "a".repeat(MAX_DOMAIN_LENGTH + 10) });

    expect(filters.domains.include[0]).toHaveLength(MAX_DOMAIN_LENGTH);
  });

  it("caps the number of values per list", () => {
    const values = Array.from(
      { length: MAX_FILTER_VALUES + 10 },
      (_unused, index) => `d${index}.com`,
    );

    expect(resolveLinkFilters({ domain: values }).domains.include).toHaveLength(
      MAX_FILTER_VALUES,
    );
  });

  it("keeps punctuation, which is matched literally", () => {
    expect(resolveLinkFilters({ q: "100%_off" }).query).toBe("100%_off");
  });

  it("does not throw on an undefined value inside a repeated parameter", () => {
    expect(resolveLinkFilters({ q: [] }).query).toBe("");
    expect(resolveLinkFilters({ domain: [] }).domains).toEqual({
      include: [],
      exclude: [],
    });
  });

  describe("albums", () => {
    it("keeps album ids as include and exclude values", () => {
      expect(
        resolveLinkFilters({
          album: ["album-1", "album-2"],
          albumExclude: ["album-3"],
        }).albums,
      ).toEqual({
        include: ["album-1", "album-2"],
        exclude: ["album-3"],
      });
    });

    it("caps an over-long album id", () => {
      const filters = resolveLinkFilters({ album: "a".repeat(MAX_ALBUM_ID_LENGTH + 10) });

      expect(filters.albums.include[0]).toHaveLength(MAX_ALBUM_ID_LENGTH);
    });

    it("reads the legacy ?album=none as the not-in-an-album option", () => {
      expect(resolveLinkFilters({ album: "none" }).albumNone).toBe(true);
      expect(resolveLinkFilters({ album: "none" }).albums).toEqual({
        include: [],
        exclude: [],
      });
    });

    it("reads the explicit albumNone flag", () => {
      expect(resolveLinkFilters({ albumNone: "1" }).albumNone).toBe(true);
    });

    it.each(["", "0", "false", "no", "junk"])(
      "leaves the flag off for %s",
      (value) => {
        expect(resolveLinkFilters({ albumNone: value }).albumNone).toBe(false);
      },
    );

    it("clears album selections when not-in-an-album is on", () => {
      expect(
        resolveLinkFilters({
          albumNone: "1",
          album: ["album-1"],
          albumExclude: ["album-2"],
        }).albums,
      ).toEqual({ include: [], exclude: [] });
    });

    it("ignores the legacy ?album=in instead of treating it as an id", () => {
      expect(resolveLinkFilters({ album: "in" })).toEqual(NONE);
    });

    it("keeps real ids next to a legacy token", () => {
      expect(resolveLinkFilters({ album: ["in", "album-1"] }).albums).toEqual({
        include: ["album-1"],
        exclude: [],
      });
    });
  });

  describe("favorites", () => {
    it("is off when the parameter is absent", () => {
      expect(resolveLinkFilters({}).favorite).toBe(false);
    });

    it.each(["1", "true", "on", "TRUE", "yes"])("is on for %s", (value) => {
      expect(resolveLinkFilters({ favorite: value }).favorite).toBe(true);
    });

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

  describe("view", () => {
    it("defaults to the grid", () => {
      expect(resolveLinkFilters({}).view).toBe("grid");
    });

    it.each(["list", "LIST", " List "])("reads %s as the list view", (value) => {
      expect(resolveLinkFilters({ view: value }).view).toBe("list");
    });

    it.each(["", "grid", "junk", "cards"])(
      "reads %s as the grid view",
      (value) => {
        expect(resolveLinkFilters({ view: value }).view).toBe("grid");
      },
    );
  });
});

describe("hasActiveFilters", () => {
  it("is false when nothing is filtered", () => {
    expect(hasActiveFilters(NONE)).toBe(false);
  });

  it("is false when only the view is list", () => {
    expect(hasActiveFilters({ ...NONE, view: "list" })).toBe(false);
  });

  it("is true when only the query is set", () => {
    expect(hasActiveFilters({ ...NONE, query: "hotel" })).toBe(true);
  });

  it("is true for a domain include or exclude", () => {
    expect(
      hasActiveFilters({ ...NONE, domains: { include: ["a.com"], exclude: [] } }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...NONE, domains: { include: [], exclude: ["a.com"] } }),
    ).toBe(true);
  });

  it("is true for an album include, exclude, or the special option", () => {
    expect(
      hasActiveFilters({ ...NONE, albums: { include: ["album-1"], exclude: [] } }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...NONE, albums: { include: [], exclude: ["album-1"] } }),
    ).toBe(true);
    expect(hasActiveFilters({ ...NONE, albumNone: true })).toBe(true);
  });

  it("is true when only favorites are selected", () => {
    expect(hasActiveFilters({ ...NONE, favorite: true })).toBe(true);
  });
});

describe("clearLinkFilters", () => {
  it("clears every filter", () => {
    expect(
      clearLinkFilters({
        query: "hotel",
        domains: { include: ["a.com"], exclude: ["b.com"] },
        albums: { include: ["album-1"], exclude: ["album-2"] },
        albumNone: true,
        favorite: true,
        view: "grid",
      }),
    ).toEqual(NONE);
  });

  it("keeps the chosen view, which is not a filter", () => {
    expect(clearLinkFilters({ ...NONE, view: "list" }).view).toBe("list");
  });
});

describe("withoutAlbumFilter", () => {
  it("drops both album lists and the special option", () => {
    expect(
      withoutAlbumFilter({
        ...NONE,
        albums: { include: ["album-1"], exclude: ["album-2"] },
        albumNone: true,
      }),
    ).toEqual({ ...NONE, albums: { include: [], exclude: [] }, albumNone: false });
  });
});

describe("buildLinksHref", () => {
  it("returns the bare path when nothing is filtered", () => {
    expect(buildLinksHref(NONE)).toBe("/");
  });

  it("writes a domain include", () => {
    expect(
      buildLinksHref({ ...NONE, domains: { include: ["example.com"], exclude: [] } }),
    ).toBe("/?domain=example.com");
  });

  it("writes repeated domain includes and excludes", () => {
    expect(
      buildLinksHref({
        ...NONE,
        domains: { include: ["a.com", "b.com"], exclude: ["c.com"] },
      }),
    ).toBe("/?domain=a.com&domain=b.com&domainExclude=c.com");
  });

  it("writes album ids as repeated parameters", () => {
    expect(
      buildLinksHref({
        ...NONE,
        albums: { include: ["album-1", "album-2"], exclude: ["album-3"] },
      }),
    ).toBe("/?album=album-1&album=album-2&albumExclude=album-3");
  });

  it("writes not-in-an-album as one flag and no album ids", () => {
    expect(
      buildLinksHref({
        ...NONE,
        albumNone: true,
        albums: { include: ["album-1"], exclude: ["album-2"] },
      }),
    ).toBe("/?albumNone=1");
  });

  it("writes the query, favorites, and view after the categories", () => {
    expect(
      buildLinksHref({
        query: "hotel",
        domains: { include: ["example.com"], exclude: [] },
        albums: { include: ["album-1"], exclude: [] },
        albumNone: false,
        favorite: true,
        view: "list",
      }),
    ).toBe(
      "/?domain=example.com&album=album-1&q=hotel&favorite=1&view=list",
    );
  });

  it("writes the view on its own", () => {
    expect(buildLinksHref({ ...NONE, view: "list" })).toBe("/?view=list");
  });

  it("encodes characters that cannot appear raw in a URL", () => {
    const href = buildLinksHref({ ...NONE, query: "a & b?c=d" });

    expect(href).not.toContain(" ");
    expect(href).not.toContain("&b");
    expect(rawOf(href).q).toEqual(["a & b?c=d"]);
  });

  it("round-trips through resolveLinkFilters", () => {
    const filters: LinkFilters = {
      query: "maen di hotel",
      domains: { include: ["www.indoav.com"], exclude: ["ads.example"] },
      albums: { include: ["album-1", "album-2"], exclude: ["album-3"] },
      albumNone: false,
      favorite: true,
      view: "list",
    };

    expect(resolveLinkFilters(rawOf(buildLinksHref(filters)))).toEqual(filters);
  });

  it("round-trips the not-in-an-album option", () => {
    const filters: LinkFilters = { ...NONE, albumNone: true, view: "list" };

    expect(resolveLinkFilters(rawOf(buildLinksHref(filters)))).toEqual(filters);
  });

  it("supports a different base path", () => {
    expect(
      buildLinksHref(
        { ...NONE, domains: { include: ["example.com"], exclude: [] } },
        "/links",
      ),
    ).toBe("/links?domain=example.com");
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
    expect(resolveTab(rawOf(buildTabHref("albums")))).toBe("albums");
    expect(resolveTab(rawOf(buildTabHref("links")))).toBe("links");
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
    expect(rawOf(href).aq).toEqual(["my album & more"]);
  });

  it("supports the locked base path", () => {
    expect(buildAlbumsHref("Anime", "/locked")).toBe("/locked?tab=albums&aq=Anime");
  });

  it("round-trips through the resolvers", () => {
    const href = buildAlbumsHref("Anime");
    const params = Object.fromEntries(
      Object.entries(rawOf(href)).map(([key, values]) => [key, values[0]]),
    );

    expect(resolveTab(params)).toBe("albums");
    expect(resolveAlbumQuery(params)).toBe("Anime");
  });
});
