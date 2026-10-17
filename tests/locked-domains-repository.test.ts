import { afterEach, describe, expect, it } from "vitest";

import { listLinks, upsertLink } from "@/db/links";
import { listLockedDomains, lockDomain, unlockDomain } from "@/db/locked-domains";
import type { LinkInput } from "@/lib/validation";
import { createTestDatabase, type TestDatabase } from "./helpers/test-db";

function link(url: string, domain: string): LinkInput {
  return { url, domain, title: url, thumbnail: null };
}

describe("lockDomain", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("locks a domain and reports it as newly locked", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    expect(await lockDomain(db, "example.com")).toBe(true);
    expect((await listLockedDomains(db)).map((option) => option.domain)).toEqual([
      "example.com",
    ]);
  });

  it("is idempotent, and reports the second attempt as not new", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    await lockDomain(db, "example.com");
    expect(await lockDomain(db, "example.com")).toBe(false);
    expect(await listLockedDomains(db)).toHaveLength(1);
  });

  it("hides links that were saved before the domain was locked", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await upsertLink(db, link("https://example.com/a", "example.com"));

    await lockDomain(db, "example.com");

    expect(await listLinks(db)).toEqual([]);
  });

  it("hides links that are saved after the domain was locked", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await lockDomain(db, "example.com");

    await upsertLink(db, link("https://example.com/later", "example.com"));

    expect(await listLinks(db)).toEqual([]);
    expect(await listLinks(db, { scope: "locked" })).toHaveLength(1);
  });

  it("allows locking a domain that has no links yet", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;

    expect(await lockDomain(db, "not-used-yet.example")).toBe(true);
    expect(await listLockedDomains(db)).toEqual([
      { domain: "not-used-yet.example", count: 0, createdAt: expect.any(Number) },
    ]);
  });
});

describe("unlockDomain", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("unlocks a locked domain", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await lockDomain(db, "example.com");

    expect(await unlockDomain(db, "example.com")).toBe(true);
    expect(await listLockedDomains(db)).toEqual([]);
  });

  it("reports false for a domain that was not locked", async () => {
    testDatabase = await createTestDatabase();

    expect(await unlockDomain(testDatabase.db, "example.com")).toBe(false);
  });

  it("leaves the other locked domains alone", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await lockDomain(db, "a.example");
    await lockDomain(db, "b.example");

    await unlockDomain(db, "a.example");

    expect((await listLockedDomains(db)).map((option) => option.domain)).toEqual([
      "b.example",
    ]);
  });

  it("brings the links of the unlocked domain back", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await upsertLink(db, link("https://example.com/a", "example.com"));
    await lockDomain(db, "example.com");

    await unlockDomain(db, "example.com");

    expect(await listLinks(db)).toHaveLength(1);
  });
});

describe("listLockedDomains", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(async () => {
    await testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("is empty when nothing is locked", async () => {
    testDatabase = await createTestDatabase();

    expect(await listLockedDomains(testDatabase.db)).toEqual([]);
  });

  it("sorts alphabetically", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    for (const domain of ["zeta.example", "alpha.example", "mid.example"]) {
      await lockDomain(db, domain);
    }

    expect((await listLockedDomains(db)).map((option) => option.domain)).toEqual([
      "alpha.example",
      "mid.example",
      "zeta.example",
    ]);
  });

  it("reports how many links each locked domain holds", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await upsertLink(db, link("https://example.com/a", "example.com"));
    await upsertLink(db, link("https://example.com/b", "example.com"));
    await upsertLink(db, link("https://visible.example/c", "visible.example"));
    await lockDomain(db, "example.com");
    await lockDomain(db, "unused.example");

    const options = await listLockedDomains(db);

    expect(options).toEqual([
      { domain: "example.com", count: 2, createdAt: expect.any(Number) },
      { domain: "unused.example", count: 0, createdAt: expect.any(Number) },
    ]);
  });

  it("never counts a visible domain's links", async () => {
    testDatabase = await createTestDatabase();
    const { db } = testDatabase;
    await upsertLink(db, link("https://visible.example/a", "visible.example"));
    await lockDomain(db, "locked.example");

    const options = await listLockedDomains(db);

    expect(options).toEqual([
      { domain: "locked.example", count: 0, createdAt: expect.any(Number) },
    ]);
  });
});
