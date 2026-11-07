import { describe, expect, it } from "vitest";

import seed from "../scripts/seed-dummy.json";

/**
 * The seed is a fixture for the whole filter feature, so these tests guard the
 * shapes the feature needs: a link with no album, a link in two albums, an empty
 * album, favorites, and a locked side that stays on the locked side.
 *
 * They also catch the failure mode that is easy to miss by hand: a membership
 * pointing at an album id that does not exist would seed silently and then never
 * show up in any album.
 */
interface SeedLink {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  favorite: boolean;
  daysAgo: number;
  albumIds: string[];
}

interface SeedAlbum {
  id: string;
  name: string;
  scope: "visible" | "locked";
}

const albums = seed.albums as SeedAlbum[];
const links = seed.links as SeedLink[];
const albumById = new Map(albums.map((album) => [album.id, album]));

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

function isLockedLink(link: SeedLink): boolean {
  return seed.lockedDomains.includes(hostOf(link.url));
}

describe("seed data", () => {
  it("has unique ids", () => {
    const ids = [...albums.map((album) => album.id), ...links.map((link) => link.id)];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique urls", () => {
    const urls = links.map((link) => link.url);

    expect(new Set(urls).size).toBe(urls.length);
  });

  it("has unique album names per scope", () => {
    const keys = albums.map((album) => `${album.scope}:${album.name.toLowerCase()}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only references albums that exist", () => {
    const unknown = links.flatMap((link) =>
      link.albumIds.filter((albumId) => !albumById.has(albumId)),
    );

    expect(unknown).toEqual([]);
  });

  it("only uses https urls", () => {
    for (const link of links) {
      expect(link.url.startsWith("https://")).toBe(true);
    }
  });

  it("only uses https thumbnails or null", () => {
    for (const link of links) {
      if (link.thumbnail !== null) {
        expect(link.thumbnail.startsWith("https://")).toBe(true);
      }
    }
  });

  it("keeps locked links on the locked side and visible links on the visible side", () => {
    for (const link of links) {
      const lockedAlbums = link.albumIds.filter(
        (albumId) => albumById.get(albumId)?.scope === "locked",
      );

      if (isLockedLink(link)) {
        expect(link.albumIds.length).toBeGreaterThan(0);
        expect(lockedAlbums.length).toBe(link.albumIds.length);
      } else {
        expect(lockedAlbums).toEqual([]);
      }
    }
  });

  it("lists every locked domain in lowercase", () => {
    for (const domain of seed.lockedDomains) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain).toMatch(/^[a-z0-9.-]+$/);
    }
  });

  it("covers the filter cases the UI needs", () => {
    const loose = links.filter((link) => link.albumIds.length === 0);
    const multiAlbum = links.filter((link) => link.albumIds.length > 1);
    const emptyAlbums = albums.filter(
      (album) => !links.some((link) => link.albumIds.includes(album.id)),
    );

    // "Not in an album" needs links with no membership at all.
    expect(loose.length).toBeGreaterThan(0);
    // Album include with several ids needs a link that belongs to more than one.
    expect(multiAlbum.length).toBeGreaterThan(0);
    // The album page's empty state needs an album nobody filed into.
    expect(emptyAlbums.length).toBeGreaterThan(0);
  });

  it("has favorites and non-favorites on both sides", () => {
    expect(links.some((link) => link.favorite)).toBe(true);
    expect(links.some((link) => !link.favorite)).toBe(true);
    expect(links.some((link) => isLockedLink(link) && link.favorite)).toBe(true);
    expect(links.some((link) => !isLockedLink(link) && link.favorite)).toBe(true);
  });

  it("has links on both sides", () => {
    expect(links.some((link) => isLockedLink(link))).toBe(true);
    expect(links.some((link) => !isLockedLink(link))).toBe(true);
  });

  it("has several distinct domains, so the Domain category is worth filtering", () => {
    const domains = new Set(links.map((link) => hostOf(link.url)));

    expect(domains.size).toBeGreaterThanOrEqual(5);
  });

  it("uses non-negative day offsets so every timestamp is in the past", () => {
    for (const link of links) {
      expect(link.daysAgo).toBeGreaterThanOrEqual(0);
    }
  });
});
