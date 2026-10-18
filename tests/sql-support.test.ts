import { describe, expect, it } from "vitest";

import { escapeLikePattern, isUniqueViolation } from "@/db/sql-support";

describe("escapeLikePattern", () => {
  it("escapes the LIKE wildcards", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("Anime 2024")).toBe("Anime 2024");
  });
});

describe("isUniqueViolation", () => {
  it("recognises a plain driver error", () => {
    const error = new Error("UNIQUE constraint failed: albums.name_key");

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("recognises a driver error wrapped by the ORM", () => {
    // Drizzle throws its own error and keeps the driver's as `cause`, so the
    // meaningful text is never in the top-level message.
    const driver = Object.assign(
      new Error("UNIQUE constraint failed: albums.name_key"),
      { code: "SQLITE_CONSTRAINT_UNIQUE" },
    );
    const wrapped = new Error("Failed query: insert into albums ...", {
      cause: driver,
    });

    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("recognises a libSQL constraint code even without the message", () => {
    const error = Object.assign(new Error("query failed"), {
      cause: Object.assign(new Error("query failed"), {
        code: "SQLITE_CONSTRAINT_UNIQUE",
      }),
    });

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("leaves unrelated errors alone", () => {
    expect(isUniqueViolation(new Error("no such table: album_links"))).toBe(false);
    expect(isUniqueViolation(new Error("Failed query: select 1"))).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("does not walk a cause chain forever", () => {
    const looped = new Error("boom");
    (looped as { cause?: unknown }).cause = looped;

    expect(isUniqueViolation(looped)).toBe(false);
  });
});
