import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const dbState = vi.hoisted(() => ({
  db: undefined as unknown as Database,
}));

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => dbState.db };
});

const { DELETE: deleteRoute, PATCH: patchRoute } = await import(
  "@/app/api/agent/links/[id]/route"
);
const { addLinkToAlbum, createAlbum } = await import("@/db/albums");
const { getLinkById, upsertLink } = await import("@/db/links");
const { lockDomain } = await import("@/db/locked-domains");
const { albumLinks } = await import("@/db/schema");

const AGENT_KEY = "agent-key-for-tests";
const PASSCODE = "open sesame";
const withPasscode = { "x-locked-passcode": PASSCODE };

let testDatabase: TestDatabase | undefined;

function request(
  method: "DELETE" | "PATCH",
  id: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  const handler = method === "DELETE" ? deleteRoute : patchRoute;

  return handler(
    new Request(`https://app.test/api/agent/links/${id}`, {
      method,
      headers: { "x-agent-key": AGENT_KEY, "content-type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const del = (id: string, headers?: Record<string, string>) => request("DELETE", id, { headers });

async function preview(id: string, headers?: Record<string, string>) {
  const response = await del(id, headers);
  const body = (await response.json()) as { error: { code: string }; data: { confirm: string; title: string; url: string } };
  return { response, body };
}

async function seed(url: string, title = "Doomed") {
  const { link } = await upsertLink(dbState.db, {
    url,
    domain: new URL(url).host,
    title,
    thumbnail: null,
  });
  return link;
}

beforeEach(async () => {
  vi.stubEnv("AGENT_API_KEY", AGENT_KEY);
  vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
  vi.stubEnv("AGENT_FAILURE_DELAY_MS", "0");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));

  testDatabase = await createTestDatabase();
  dbState.db = testDatabase.db;
  await lockDomain(dbState.db, "secret.test");
});

afterEach(async () => {
  vi.useRealTimers();
  await testDatabase?.cleanup();
  testDatabase = undefined;
  vi.unstubAllEnvs();
});

describe("DELETE /api/agent/links/:id", () => {
  it("first call deletes nothing and returns a preview with a confirmation token", async () => {
    const link = await seed("https://a.test/1");

    const { response, body } = await preview(link.id);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(body.data).toMatchObject({ title: "Doomed", url: "https://a.test/1" });
    expect(body.data.confirm).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(await getLinkById(dbState.db, link.id)).toBeDefined();
  });

  it("deletes the link and its album memberships when the token comes back", async () => {
    const link = await seed("https://a.test/1");
    const album = await createAlbum(dbState.db, { name: "A", nameKey: "a", scope: "visible" });
    if (!album.ok) throw new Error("setup failed");
    await addLinkToAlbum(dbState.db, album.album.id, link.id);
    const { body } = await preview(link.id);

    const response = await del(link.id, { "x-confirm": body.data.confirm });

    expect(response.status).toBe(200);
    expect(await getLinkById(dbState.db, link.id)).toBeUndefined();
    expect(await dbState.db.select().from(albumLinks)).toHaveLength(0);
  });

  it("does not delete with a token minted for another link, and returns that link's own preview", async () => {
    const a = await seed("https://a.test/1", "A");
    const b = await seed("https://a.test/2", "B");
    const { body } = await preview(a.id);

    const response = await del(b.id, { "x-confirm": body.data.confirm });
    const result = (await response.json()) as { error: { code: string }; data: { title: string } };

    expect(response.status).toBe(409);
    expect(result.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(result.data.title).toBe("B");
    expect(await getLinkById(dbState.db, b.id)).toBeDefined();
  });

  it("does not delete with a garbage token", async () => {
    const link = await seed("https://a.test/1");

    const response = await del(link.id, { "x-confirm": "garbage" });

    expect(response.status).toBe(409);
    expect(await getLinkById(dbState.db, link.id)).toBeDefined();
  });

  it("invalidates the token once the link was edited after the preview", async () => {
    const link = await seed("https://a.test/1");
    const { body } = await preview(link.id);

    vi.setSystemTime(new Date("2026-11-16T10:00:10.000Z"));
    await request("PATCH", link.id, { body: { title: "Edited meanwhile" } });

    const response = await del(link.id, { "x-confirm": body.data.confirm });

    expect(response.status).toBe(409);
    expect(await getLinkById(dbState.db, link.id)).toBeDefined();
  });

  it("invalidates the token after five minutes", async () => {
    const link = await seed("https://a.test/1");
    const { body } = await preview(link.id);

    vi.setSystemTime(new Date("2026-11-16T10:05:01.000Z"));
    const response = await del(link.id, { "x-confirm": body.data.confirm });

    expect(response.status).toBe(409);
    expect(await getLinkById(dbState.db, link.id)).toBeDefined();
  });

  it("answers 404 for an unknown id and 401 without the agent key", async () => {
    expect((await del("nope")).status).toBe(404);

    const anonymous = await deleteRoute(
      new Request("https://app.test/api/agent/links/x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(anonymous.status).toBe(401);
  });

  it("treats a private link as not found without the passcode, for both steps", async () => {
    const link = await seed("https://secret.test/1", "Hidden");
    const { body } = await preview(link.id, withPasscode);

    const previewWithout = await del(link.id);
    const confirmWithout = await del(link.id, { "x-confirm": body.data.confirm });

    expect(previewWithout.status).toBe(404);
    expect(confirmWithout.status).toBe(404);
    expect(await getLinkById(dbState.db, link.id)).toBeDefined();
  });

  it("deletes a private link when both the passcode and the token are sent", async () => {
    const link = await seed("https://secret.test/1", "Hidden");
    const { body } = await preview(link.id, withPasscode);

    const response = await del(link.id, { ...withPasscode, "x-confirm": body.data.confirm });

    expect(response.status).toBe(200);
    expect(await getLinkById(dbState.db, link.id)).toBeUndefined();
  });
});
