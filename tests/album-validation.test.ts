import { describe, expect, it } from "vitest";

import {
  MAX_ALBUM_NAME_LENGTH,
  MAX_BULK_LINK_IDS,
  parseAlbumLinkInput,
  parseAlbumName,
  parseBulkAlbumLinkInput,
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

describe("parseBulkAlbumLinkInput", () => {
  it("accepts a list of link ids", () => {
    expect(parseBulkAlbumLinkInput({ linkIds: ["a", "b"] })).toEqual({
      ok: true,
      data: { linkIds: ["a", "b"] },
    });
  });

  it("trims every id", () => {
    const result = parseBulkAlbumLinkInput({ linkIds: ["  a  ", " b"] });

    expect(result.ok && result.data.linkIds).toEqual(["a", "b"]);
  });

  it("deduplicates the ids, keeping first-seen order", () => {
    const result = parseBulkAlbumLinkInput({ linkIds: ["b", "a", "b", " b "] });

    expect(result.ok && result.data.linkIds).toEqual(["b", "a"]);
  });

  it("accepts a list of exactly the maximum length", () => {
    const ids = Array.from({ length: MAX_BULK_LINK_IDS }, (_, index) =>
      `id-${index}`,
    );

    expect(parseBulkAlbumLinkInput({ linkIds: ids }).ok).toBe(true);
  });

  it("rejects a list longer than the maximum, measured after deduplication", () => {
    const ids = Array.from({ length: MAX_BULK_LINK_IDS + 1 }, (_, index) =>
      `id-${index}`,
    );

    expect(parseBulkAlbumLinkInput({ linkIds: ids }).ok).toBe(false);
  });

  it("accepts a long list once its duplicates are removed", () => {
    const ids = ["a", "b", ...Array.from({ length: MAX_BULK_LINK_IDS + 5 }, () => "a")];

    const result = parseBulkAlbumLinkInput({ linkIds: ids });

    expect(result.ok && result.data.linkIds).toEqual(["a", "b"]);
  });

  it.each([
    ["a missing field", {}],
    ["a null field", { linkIds: null }],
    ["a string instead of an array", { linkIds: "abc" }],
    ["an empty array", { linkIds: [] }],
    ["an empty string entry", { linkIds: [""] }],
    ["a whitespace-only entry", { linkIds: ["a", "   "] }],
    ["a non-string entry", { linkIds: ["a", 7] }],
    ["a nested array entry", { linkIds: [["a"]] }],
    ["the wrong field name", { ids: ["a"] }],
  ])("rejects %s", (_label, payload) => {
    expect(parseBulkAlbumLinkInput(payload).ok).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseBulkAlbumLinkInput(null).ok).toBe(false);
    expect(parseBulkAlbumLinkInput("a").ok).toBe(false);
    expect(parseBulkAlbumLinkInput([]).ok).toBe(false);
  });
});
