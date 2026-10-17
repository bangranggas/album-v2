import { describe, expect, it } from "vitest";

import { parseLoginInput } from "@/lib/validation";

describe("parseLoginInput", () => {
  it("accepts a non-empty password", () => {
    expect(parseLoginInput({ password: "hunter2" })).toEqual({
      ok: true,
      data: { password: "hunter2" },
    });
  });

  it("keeps surrounding whitespace, because a password may contain spaces", () => {
    expect(parseLoginInput({ password: " pass with spaces " })).toEqual({
      ok: true,
      data: { password: " pass with spaces " },
    });
  });

  it("ignores unknown fields such as a username", () => {
    expect(parseLoginInput({ username: "ignored", password: "hunter2" })).toEqual({
      ok: true,
      data: { password: "hunter2" },
    });
  });

  it("rejects an empty password", () => {
    expect(parseLoginInput({ password: "" }).ok).toBe(false);
  });

  it("rejects a missing password, so a username alone cannot log in", () => {
    expect(parseLoginInput({}).ok).toBe(false);
    expect(parseLoginInput({ username: "admin" }).ok).toBe(false);
  });

  it("rejects a non-string password", () => {
    expect(parseLoginInput({ password: 123 }).ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(parseLoginInput("hunter2").ok).toBe(false);
    expect(parseLoginInput(null).ok).toBe(false);
    expect(parseLoginInput(["hunter2"]).ok).toBe(false);
  });
});
