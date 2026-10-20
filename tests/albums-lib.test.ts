import { describe, expect, it } from "vitest";

import {
  albumHref,
  albumScopeForPage,
  COLLAGE_SLOTS,
  collageSlots,
  formatAlbumCount,
  isAlbumScope,
  MEMBERSHIP_PREVIEW_LIMIT,
  membershipPreview,
} from "@/lib/albums";

describe("formatAlbumCount", () => {
  it("states the total when nothing is filtered", () => {
    expect(formatAlbumCount(5, 5, false)).toBe("5 albums");
    expect(formatAlbumCount(1, 1, false)).toBe("1 album");
  });

  it("shows what the search narrowed it to", () => {
    expect(formatAlbumCount(2, 5, true)).toBe("2 of 5 albums");
  });

  it("handles an empty list", () => {
    expect(formatAlbumCount(0, 0, false)).toBe("0 albums");
  });
});

describe("collageSlots", () => {
  it("pads a short cover list to a full 2×2 grid", () => {
    expect(collageSlots(["a"])).toEqual(["a", null, null, null]);
  });

  it("keeps four thumbnails in order", () => {
    expect(collageSlots(["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("drops anything past the fourth: the grid has four places", () => {
    expect(collageSlots(["a", "b", "c", "d", "e"])).toHaveLength(COLLAGE_SLOTS);
  });

  it("is all empty slots for an album without thumbnails", () => {
    expect(collageSlots([])).toEqual([null, null, null, null]);
  });

  it("always returns exactly the grid size", () => {
    expect(COLLAGE_SLOTS).toBe(4);
    expect(collageSlots([])).toHaveLength(COLLAGE_SLOTS);
  });
});

describe("albumHref", () => {
  it("points at the light detail route from the dashboard", () => {
    expect(albumHref("abc")).toBe("/albums/abc");
  });

  it("stays inside the hidden area from the locked page", () => {
    expect(albumHref("abc", "/locked")).toBe("/locked/albums/abc");
  });

  it("encodes an id that is not URL-safe", () => {
    expect(albumHref("a b")).toBe("/albums/a%20b");
  });
});

describe("albumScopeForPage", () => {
  it("puts an album started on the dashboard on the visible side", () => {
    expect(albumScopeForPage(false)).toBe("visible");
  });

  it("puts an album started on the locked page on the locked side", () => {
    expect(albumScopeForPage(true)).toBe("locked");
  });
});

describe("membershipPreview", () => {
  const albumList = [
    { id: "a", name: "Anime" },
    { id: "b", name: "Books" },
    { id: "c", name: "Cooking" },
    { id: "d", name: "Design" },
    { id: "e", name: "Elsewhere" },
  ];

  it("shows nothing for a link that is in no album", () => {
    expect(membershipPreview([], albumList)).toEqual({ shown: [], hidden: [] });
  });

  it("shows every name while the list is short enough", () => {
    const preview = membershipPreview(["a", "c"], albumList);

    expect(preview.shown.map((album) => album.name)).toEqual(["Anime", "Cooking"]);
    expect(preview.hidden).toEqual([]);
  });

  it("splits at the preview limit", () => {
    const preview = membershipPreview(["a", "b", "c", "d"], albumList);

    expect(preview.shown.map((album) => album.name)).toEqual([
      "Anime",
      "Books",
      "Cooking",
    ]);
    expect(preview.hidden.map((album) => album.name)).toEqual(["Design"]);
    expect(MEMBERSHIP_PREVIEW_LIMIT).toBe(3);
  });

  it("keeps the album list's order, not the order the ids arrive in", () => {
    const preview = membershipPreview(["d", "a", "c"], albumList);

    expect(preview.shown.map((album) => album.name)).toEqual([
      "Anime",
      "Cooking",
      "Design",
    ]);
  });

  it("ignores ids whose album is gone", () => {
    const preview = membershipPreview(["a", "deleted-in-another-tab"], albumList);

    expect(preview.shown.map((album) => album.name)).toEqual(["Anime"]);
    expect(preview.hidden).toEqual([]);
  });

  it("does not repeat a name when an id appears twice", () => {
    const preview = membershipPreview(["a", "a"], albumList);

    expect(preview.shown).toHaveLength(1);
  });

  it("accepts another limit", () => {
    const preview = membershipPreview(["a", "b", "c", "d"], albumList, 2);

    expect(preview.shown.map((album) => album.name)).toEqual(["Anime", "Books"]);
    expect(preview.hidden.map((album) => album.name)).toEqual(["Cooking", "Design"]);
  });

  it("counts only albums that exist when applying the limit", () => {
    const preview = membershipPreview(["gone", "gone-2", "b", "c"], albumList, 2);

    expect(preview.shown.map((album) => album.name)).toEqual(["Books", "Cooking"]);
    expect(preview.hidden).toEqual([]);
  });
});

describe("isAlbumScope", () => {
  it("accepts the two sides", () => {
    expect(isAlbumScope("visible")).toBe(true);
    expect(isAlbumScope("locked")).toBe(true);
  });

  it.each([
    ["the link scope's escape hatch", "all"],
    ["an empty string", ""],
    ["a different case", "Visible"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("rejects %s", (_label, value) => {
    expect(isAlbumScope(value)).toBe(false);
  });
});
