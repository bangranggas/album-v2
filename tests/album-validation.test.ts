import { describe, expect, it } from "vitest";

import {
  MAX_ALBUM_NAME_LENGTH,
  parseAlbumLinkInput,
  parseAlbumName,
} from "@/lib/validation";

describe("parseAlbumName", () => {
  it("keeps the display name and lowercases the uniqueness key", () => {
    expect(parseAlbumName({ name: "Anime" })).toEqual({
      ok: true,
      data: { name: "Anime", nameKey: "anime" },
    });
  });

  it("trims the ends of the name", () => {
    const result = parseAlbumName({ name: "  My Album  " });

    expect(result).toEqual({
      ok: true,
      data: { name: "My Album", nameKey: "my album" },
    });
  });

  it("keys 'Anime' and 'anime' the same, so they can never coexist", () => {
    const upper = parseAlbumName({ name: "Anime" });
    const lower = parseAlbumName({ name: "anime" });

    expect(upper.ok && lower.ok && upper.data.nameKey === lower.data.nameKey).toBe(
      true,
    );
  });

  it("keeps inner spacing as typed", () => {
    const result = parseAlbumName({ name: "My  Album" });

    expect(result.ok && result.data.nameKey).toBe("my  album");
  });

  it("lowercases non-ASCII letters too", () => {
    const result = parseAlbumName({ name: "Ålbum" });

    expect(result.ok && result.data.nameKey).toBe("ålbum");
  });

  it("accepts emoji and other symbols in the name", () => {
    const result = parseAlbumName({ name: "🎬 Favorites" });

    expect(result).toEqual({
      ok: true,
      data: { name: "🎬 Favorites", nameKey: "🎬 favorites" },
    });
  });

  it("accepts a name of exactly the maximum length", () => {
    const name = "a".repeat(MAX_ALBUM_NAME_LENGTH);

    expect(parseAlbumName({ name }).ok).toBe(true);
  });

  it.each([
    ["a missing field", {}],
    ["an empty string", { name: "" }],
    ["whitespace only", { name: "   " }],
    ["a non-string", { name: 42 }],
    ["a null name", { name: null }],
    ["an over-long name", { name: "a".repeat(MAX_ALBUM_NAME_LENGTH + 1) }],
  ])("rejects %s", (_label, payload) => {
    expect(parseAlbumName(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseAlbumName(null).ok).toBe(false);
    expect(parseAlbumName("Anime").ok).toBe(false);
    expect(parseAlbumName([]).ok).toBe(false);
  });
});

describe("parseAlbumLinkInput", () => {
  it("accepts an album id", () => {
    const id = "6f1a5d0e-6a1c-4b2f-9f7d-2a1b3c4d5e6f";

    expect(parseAlbumLinkInput({ albumId: id })).toEqual({
      ok: true,
      data: { albumId: id },
    });
  });

  it("trims surrounding whitespace", () => {
    const result = parseAlbumLinkInput({ albumId: "  abc  " });

    expect(result.ok && result.data.albumId).toBe("abc");
  });

  it.each([
    ["a missing field", {}],
    ["an empty string", { albumId: "" }],
    ["whitespace only", { albumId: "   " }],
    ["a non-string", { albumId: 7 }],
    ["the wrong field name", { linkId: "abc" }],
    ["an over-long value", { albumId: "a".repeat(200) }],
  ])("rejects %s", (_label, payload) => {
    expect(parseAlbumLinkInput(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseAlbumLinkInput(null).ok).toBe(false);
    expect(parseAlbumLinkInput([]).ok).toBe(false);
  });
});
