import { describe, expect, it, vi } from "vitest";

import { callApi, readBulkAddCounts, readCreatedAlbumId } from "@/lib/dashboard-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("callApi", () => {
  it("reports success and hands back the payload", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { ok: true, data: { album: { id: "abc" } } }));

    const result = await callApi("/api/dashboard/albums", "POST", { name: "Anime" });

    expect(result).toEqual({ ok: true, data: { album: { id: "abc" } } });
    expect(fetchSpy).toHaveBeenCalledWith("/api/dashboard/albums", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anime" }),
    });

    fetchSpy.mockRestore();
  });

  it("succeeds with no body at all", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(callApi("/api/dashboard/links/x", "DELETE")).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    fetchSpy.mockRestore();
  });

  it("surfaces the error message and status", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(409, {
          ok: false,
          error: { code: "CONFLICT", message: "An album with that name already exists." },
        }),
      );

    await expect(
      callApi("/api/dashboard/albums", "POST", { name: "Anime" }),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      message: "An album with that name already exists.",
    });

    fetchSpy.mockRestore();
  });

  it("falls back to a generic message when the error body is unreadable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>oops</html>", { status: 500 }));

    const result = await callApi("/api/dashboard/albums", "POST", { name: "Anime" });

    expect(result.ok).toBe(false);
    expect(result.ok || result.status).toBe(500);
    expect(result.ok || result.message).toBe("Something went wrong. Please try again.");

    fetchSpy.mockRestore();
  });

  it("reports a request that never left the browser", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));

    const result = await callApi("/api/dashboard/albums", "POST", { name: "Anime" });

    expect(result.ok).toBe(false);
    expect(result.ok || result.status).toBe(0);
    expect(result.ok || result.message).toBe(
      "The request could not be sent. Check your connection and try again.",
    );

    fetchSpy.mockRestore();
  });
});

describe("readCreatedAlbumId", () => {
  it("reads the new album's id out of the create response", () => {
    expect(
      readCreatedAlbumId({ album: { id: "6f1a5d0e", name: "Anime" } }),
    ).toBe("6f1a5d0e");
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "abc"],
    ["a bare album object", { id: "abc" }],
    ["a null album", { album: null }],
    ["an album without an id", { album: { name: "Anime" } }],
    ["a non-string id", { album: { id: 7 } }],
    ["an empty id", { album: { id: "" } }],
  ])("answers null for %s", (_label, payload) => {
    expect(readCreatedAlbumId(payload)).toBeNull();
  });
});

describe("readBulkAddCounts", () => {
  it("reads the three counts the bulk endpoint reports", () => {
    expect(readBulkAddCounts({ added: 3, alreadyIn: 2, skipped: 1 })).toEqual({
      added: 3,
      alreadyIn: 2,
      skipped: 1,
    });
  });

  it("accepts a report of nothing at all", () => {
    expect(readBulkAddCounts({ added: 0, alreadyIn: 0, skipped: 0 })).toEqual({
      added: 0,
      alreadyIn: 0,
      skipped: 0,
    });
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "added"],
    ["a missing count", { added: 1, alreadyIn: 0 }],
    ["a non-numeric count", { added: "1", alreadyIn: 0, skipped: 0 }],
    ["a negative count", { added: -1, alreadyIn: 0, skipped: 0 }],
  ])("answers null for %s", (_label, payload) => {
    expect(readBulkAddCounts(payload)).toBeNull();
  });
});
