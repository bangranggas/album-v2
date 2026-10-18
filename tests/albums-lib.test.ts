import { describe, expect, it } from "vitest";

import { albumHref, COLLAGE_SLOTS, collageSlots, formatAlbumCount } from "@/lib/albums";

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
