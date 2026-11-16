import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";
import { parseAgentLinkInput } from "@/lib/validation";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

const dbState = vi.hoisted(() => ({
  db: undefined as unknown as Database,
}));

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => dbState.db };
});

const { POST: addRoute } = await import("@/app/api/agent/links/route");
const { PATCH: patchRoute } = await import("@/app/api/agent/links/[id]/route");
const { getLinkById, listLinks, upsertLink } = await import("@/db/links");
const { lockDomain } = await import("@/db/locked-domains");

const AGENT_KEY = "agent-key-for-tests";
const PASSCODE = "open sesame";
const withPasscode = { "x-locked-passcode": PASSCODE };

let testDatabase: TestDatabase | undefined;

function send(
  handler: (request: Request, context: never) => Promise<Response>,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  options: { headers?: Record<string, string>; id?: string } = {},
): Promise<Response> {
  const request = new Request(`https://app.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-agent-key": AGENT_KEY,
      ...options.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  return handler(request, { params: Promise.resolve({ id: options.id }) } as never);
}

const add = (body: unknown, headers?: Record<string, string>) =>
  send(addRoute, "POST", "/api/agent/links", body, { headers });

const patch = (id: string, body: unknown, headers?: Record<string, string>) =>
  send(patchRoute, "PATCH", `/api/agent/links/${id}`, body, { id, headers });

async function body(response: Response) {
  return (await response.json()) as { ok: boolean; data?: any; error?: any };
}

async function seed(url: string, title = "T", extra: { thumbnail?: string | null } = {}) {
  const domain = new URL(url).host;
  const { link } = await upsertLink(dbState.db, {
    url,
    domain,
    title,
    thumbnail: extra.thumbnail ?? null,
  });
  return link;
}

beforeEach(async () => {
  vi.stubEnv("AGENT_API_KEY", AGENT_KEY);
  vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
  vi.stubEnv("AGENT_FAILURE_DELAY_MS", "0");

  testDatabase = await createTestDatabase();
  dbState.db = testDatabase.db;
  await lockDomain(dbState.db, "secret.test");
});

afterEach(async () => {
  await testDatabase?.cleanup();
  testDatabase = undefined;
  vi.unstubAllEnvs();
});

describe("parseAgentLinkInput", () => {
  it("requires an http(s) url and leaves the other fields undefined when omitted", () => {
    const result = parseAgentLinkInput({ url: "https://Example.com/a" });

    expect(result).toEqual({
      ok: true,
      data: { url: "https://Example.com/a", domain: "example.com" },
    });
  });

  it("rejects a missing or non-http url", () => {
    expect(parseAgentLinkInput({}).ok).toBe(false);
    expect(parseAgentLinkInput({ url: "ftp://x.test/a" }).ok).toBe(false);
    expect(parseAgentLinkInput("nope").ok).toBe(false);
  });

  it("trims title and summary, treats a blank title as omitted, and nulls blank thumbnail/summary", () => {
    const result = parseAgentLinkInput({
      url: "https://example.com/a",
      title: "   ",
      thumbnail: "",
      summary: "  note ",
    });

    expect(result.ok && result.data).toEqual({
      url: "https://example.com/a",
      domain: "example.com",
      thumbnail: null,
      summary: "note",
    });
  });

  it("rejects a summary over 500 characters and a non-url thumbnail", () => {
    expect(parseAgentLinkInput({ url: "https://example.com/a", summary: "x".repeat(501) }).ok).toBe(false);
    expect(parseAgentLinkInput({ url: "https://example.com/a", thumbnail: "not a url" }).ok).toBe(false);
  });
});

describe("POST /api/agent/links", () => {
  it("adds a new public link with 201 and finds it in the public list", async () => {
    const response = await add({ url: "https://new.test/a", title: "New", summary: "about" });
    const result = await body(response);

    expect(response.status).toBe(201);
    expect(result.data).toMatchObject({
      inserted: true,
      link: { title: "New", summary: "about", space: "public", url: "https://new.test/a" },
    });
    expect(await listLinks(dbState.db)).toHaveLength(1);
  });

  it("derives the title when only a url is sent", async () => {
    const result = await body(await add({ url: "https://new.test/path" }));

    expect(result.data.link.title).toBe("new.test/path");
  });

  it("re-adding an existing url with only a summary keeps its title and thumbnail", async () => {
    const existing = await seed("https://new.test/a", "Keep me", { thumbnail: "https://img.test/i.jpg" });

    const response = await add({ url: "https://new.test/a", summary: "added later" });
    const result = await body(response);

    expect(response.status).toBe(200);
    expect(result.data.inserted).toBe(false);
    const stored = await getLinkById(dbState.db, existing.id);
    expect(stored).toMatchObject({
      title: "Keep me",
      thumbnail: "https://img.test/i.jpg",
      summary: "added later",
    });
  });

  it("answers 403 PASSCODE_REQUIRED for a locked domain without the passcode and writes nothing", async () => {
    const response = await add({ url: "https://secret.test/a", title: "S" });

    expect(response.status).toBe(403);
    expect((await body(response)).error.code).toBe("PASSCODE_REQUIRED");
    expect(await listLinks(dbState.db, { scope: "all" })).toHaveLength(0);
  });

  it("saves to the private space with the passcode, invisible to a public listing", async () => {
    const response = await add({ url: "https://secret.test/a", title: "S" }, withPasscode);

    expect(response.status).toBe(201);
    expect((await body(response)).data.link.space).toBe("private");
    expect(await listLinks(dbState.db)).toHaveLength(0);
    expect(await listLinks(dbState.db, { scope: "locked" })).toHaveLength(1);
  });

  it("answers 400 for an invalid url or invalid JSON", async () => {
    expect((await add({ url: "nope" })).status).toBe(400);
    expect((await add("{not json")).status).toBe(400);
  });

  it("answers 401 without the agent key", async () => {
    const response = await addRoute(
      new Request("https://app.test/api/agent/links", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/agent/links/:id", () => {
  it("edits title, url, thumbnail, summary and favorite", async () => {
    const link = await seed("https://a.test/1", "Old");

    const response = await patch(link.id, {
      title: "New",
      url: "https://a.test/2",
      thumbnail: "https://img.test/n.jpg",
      summary: "s",
      isFavorite: true,
    });

    expect(response.status).toBe(200);
    expect(await getLinkById(dbState.db, link.id)).toMatchObject({
      title: "New",
      url: "https://a.test/2",
      thumbnail: "https://img.test/n.jpg",
      summary: "s",
      isFavorite: true,
    });
  });

  it("clears a summary with an empty string", async () => {
    const link = await seed("https://a.test/1");
    await patch(link.id, { summary: "x" });

    await patch(link.id, { summary: "" });

    expect((await getLinkById(dbState.db, link.id))?.summary).toBeNull();
  });

  it("answers 404 for a private link without the passcode, and edits it with the passcode", async () => {
    const link = await seed("https://secret.test/1", "Hidden");

    const denied = await patch(link.id, { title: "Hacked" });
    const allowed = await patch(link.id, { title: "Renamed" }, withPasscode);

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect((await getLinkById(dbState.db, link.id))?.title).toBe("Renamed");
  });

  it("answers 404 for an unknown id and 400 for an empty patch", async () => {
    const link = await seed("https://a.test/1");

    expect((await patch("nope", { title: "x" })).status).toBe(404);
    expect((await patch(link.id, {})).status).toBe(400);
  });

  it("answers 409 when the url belongs to another public link", async () => {
    await seed("https://a.test/1");
    const other = await seed("https://a.test/2");

    const response = await patch(other.id, { url: "https://a.test/1" });

    expect(response.status).toBe(409);
    expect((await body(response)).error.message).toMatch(/already saved/);
  });

  it("never reveals a private link: moving onto its url is the boundary 409, not 'already saved'", async () => {
    await seed("https://secret.test/1", "Hidden");
    const open = await seed("https://a.test/1");

    const response = await patch(open.id, { url: "https://secret.test/1" });
    const result = await body(response);

    expect(response.status).toBe(409);
    expect(result.error.message).not.toMatch(/already saved/);
    expect(result.error.message).toMatch(/public\/private/);
    expect((await getLinkById(dbState.db, open.id))?.url).toBe("https://a.test/1");
  });

  it("refuses to move a link across the boundary even with the passcode", async () => {
    const open = await seed("https://a.test/1");
    const hidden = await seed("https://secret.test/1");

    const toPrivate = await patch(open.id, { url: "https://secret.test/9" }, withPasscode);
    const toPublic = await patch(hidden.id, { url: "https://a.test/9" }, withPasscode);

    expect(toPrivate.status).toBe(409);
    expect(toPublic.status).toBe(409);
  });

  it("allows changing the url within the same space", async () => {
    const link = await seed("https://secret.test/1");

    const response = await patch(link.id, { url: "https://secret.test/2" }, withPasscode);

    expect(response.status).toBe(200);
  });
});
