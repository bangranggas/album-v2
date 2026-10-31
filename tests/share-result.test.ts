import { describe, expect, it } from "vitest";

import { describeShareResult } from "@/lib/share-result";

describe("describeShareResult", () => {
  it("reports a successful save", () => {
    const result = describeShareResult("ok");

    expect(result.status).toBe("ok");
    expect(result.copy.success).toBe(true);
    expect(result.copy.title).toBe("Link saved");
  });

  it.each(["error", "invalid", "offline", "unauthorized"])(
    "reports %s as a failure",
    (status) => {
      const result = describeShareResult(status);

      expect(result.status).toBe(status);
      expect(result.copy.success).toBe(false);
    },
  );

  it("explains that an unauthenticated share needs a sign-in", () => {
    expect(describeShareResult("unauthorized").copy.title).toBe(
      "Sign in to save links",
    );
  });

  it("treats a missing status as a no-op, not an error", () => {
    const result = describeShareResult(undefined);

    expect(result.status).toBe("noop");
    expect(result.copy.success).toBe(false);
  });

  it("treats an unknown status as a no-op", () => {
    expect(describeShareResult("garbage").status).toBe("noop");
  });

  it("unwraps a repeated query parameter", () => {
    expect(describeShareResult(["ok", "error"]).status).toBe("ok");
  });
});
