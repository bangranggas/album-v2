import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizeAgent,
  signDeleteConfirm,
  verifyDeleteConfirm,
} from "@/lib/agent-auth";

const AGENT_KEY = "agent-key-for-tests";
const PASSCODE = "correct horse";
const NOW = Date.parse("2026-11-16T10:00:00.000Z");

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://app.test/api/agent/links", { headers });
}

beforeEach(() => {
  vi.stubEnv("AGENT_API_KEY", AGENT_KEY);
  vi.stubEnv("LOCKED_PASSCODE", PASSCODE);
  vi.stubEnv("SECRET_KEY", "userscript-key");
  vi.stubEnv("AGENT_FAILURE_DELAY_MS", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function status(result: Awaited<ReturnType<typeof authorizeAgent>>): Promise<number> {
  if (result.ok) throw new Error("expected a rejection");
  return result.response.status;
}

async function code(result: Awaited<ReturnType<typeof authorizeAgent>>): Promise<string> {
  if (result.ok) throw new Error("expected a rejection");
  const body = (await result.response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("authorizeAgent", () => {
  it("answers 503 UNCONFIGURED when AGENT_API_KEY is not set", async () => {
    vi.stubEnv("AGENT_API_KEY", "");

    const result = await authorizeAgent(request({ "x-agent-key": AGENT_KEY }));

    expect(await status(result)).toBe(503);
    expect(await code(result)).toBe("UNCONFIGURED");
  });

  it("answers 401 when the key header is missing", async () => {
    const result = await authorizeAgent(request());

    expect(await status(result)).toBe(401);
    expect(await code(result)).toBe("UNAUTHORIZED");
  });

  it("answers 401 for a wrong key", async () => {
    const result = await authorizeAgent(request({ "x-agent-key": "nope" }));

    expect(await status(result)).toBe(401);
  });

  it("does not accept the userscript SECRET_KEY as an agent key", async () => {
    const result = await authorizeAgent(request({ "x-secret-key": "userscript-key" }));

    expect(await status(result)).toBe(401);
  });

  it("opens only the public space when no passcode is sent", async () => {
    const result = await authorizeAgent(request({ "x-agent-key": AGENT_KEY }));

    expect(result).toEqual({ ok: true, privateOpen: false });
  });

  it("opens the private space for this request when the passcode is right", async () => {
    const result = await authorizeAgent(
      request({ "x-agent-key": AGENT_KEY, "x-locked-passcode": PASSCODE }),
    );

    expect(result).toEqual({ ok: true, privateOpen: true });
  });

  it("answers 403 PASSCODE_REQUIRED for a wrong passcode", async () => {
    const result = await authorizeAgent(
      request({ "x-agent-key": AGENT_KEY, "x-locked-passcode": "wrong" }),
    );

    expect(await status(result)).toBe(403);
    expect(await code(result)).toBe("PASSCODE_REQUIRED");
  });

  it("answers 503 when a passcode is sent but LOCKED_PASSCODE is not configured", async () => {
    vi.stubEnv("LOCKED_PASSCODE", "");

    const result = await authorizeAgent(
      request({ "x-agent-key": AGENT_KEY, "x-locked-passcode": "anything" }),
    );

    expect(await status(result)).toBe(503);
  });

  it("never writes the supplied passcode or key to the logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await authorizeAgent(
      request({ "x-agent-key": AGENT_KEY, "x-locked-passcode": "super-secret-guess" }),
    );
    await authorizeAgent(request({ "x-agent-key": "super-secret-key-guess" }));

    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("super-secret-guess");
    expect(logged).not.toContain("super-secret-key-guess");
    expect(logged).toContain("agent_auth_failed");
  });

  it("waits before answering a failed attempt when a delay is configured", async () => {
    vi.stubEnv("AGENT_FAILURE_DELAY_MS", "1000");
    vi.useFakeTimers();

    let settled = false;
    const pending = authorizeAgent(request({ "x-agent-key": "nope" })).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});

describe("delete confirmation token", () => {
  const link = { id: "link-a", updatedAt: 1_700_000_000_000 };

  it("verifies for the same link and unchanged updatedAt", () => {
    const token = signDeleteConfirm(link, NOW);

    expect(verifyDeleteConfirm(token, link, NOW + 1_000)).toBe(true);
  });

  it("is rejected for another link", () => {
    const token = signDeleteConfirm(link, NOW);

    expect(verifyDeleteConfirm(token, { ...link, id: "link-b" }, NOW)).toBe(false);
  });

  it("is rejected once the link was edited (updatedAt changed)", () => {
    const token = signDeleteConfirm(link, NOW);

    expect(verifyDeleteConfirm(token, { ...link, updatedAt: link.updatedAt + 1 }, NOW)).toBe(
      false,
    );
  });

  it("expires after five minutes", () => {
    const token = signDeleteConfirm(link, NOW);

    expect(verifyDeleteConfirm(token, link, NOW + 5 * 60_000 - 1)).toBe(true);
    expect(verifyDeleteConfirm(token, link, NOW + 5 * 60_000 + 1)).toBe(false);
  });

  it("rejects garbage, empty and missing tokens", () => {
    expect(verifyDeleteConfirm("garbage", link, NOW)).toBe(false);
    expect(verifyDeleteConfirm("", link, NOW)).toBe(false);
    expect(verifyDeleteConfirm(null, link, NOW)).toBe(false);
    expect(verifyDeleteConfirm(undefined, link, NOW)).toBe(false);
  });

  it("does not verify under a different AGENT_API_KEY", () => {
    const token = signDeleteConfirm(link, NOW);
    vi.stubEnv("AGENT_API_KEY", "another-key");

    expect(verifyDeleteConfirm(token, link, NOW)).toBe(false);
  });

  it("is not a valid dashboard or passcode cookie value", async () => {
    const { verifyLockedSession } = await import("@/lib/locked-session");
    const token = signDeleteConfirm(link, NOW);

    expect(verifyLockedSession(token, { now: NOW, secret: PASSCODE }).valid).toBe(false);
    expect(verifyLockedSession(token, { now: NOW, secret: AGENT_KEY }).valid).toBe(false);
  });
});
