import { describe, expect, it, vi } from "vitest";

import { callApi } from "@/lib/dashboard-api";

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
