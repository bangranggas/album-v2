import { createHmac } from "node:crypto";
import type { NextResponse } from "next/server";

import { jsonError } from "@/lib/api-response";
import { constantTimeEqual } from "@/lib/auth";
import { isLockedPasscodeConfigured, verifyLockedPasscode } from "@/lib/locked-auth";
import { extractIp, logEvent } from "@/lib/logger";
import { signToken, verifyToken } from "@/lib/signed-token";

export const AGENT_KEY_HEADER = "x-agent-key";
export const PASSCODE_HEADER = "x-locked-passcode";
export const CONFIRM_HEADER = "x-confirm";

const DEFAULT_FAILURE_DELAY_MS = 1000;
const CONFIRM_TTL_MS = 5 * 60_000;

export type AgentAccess =
  | { ok: true; privateOpen: boolean }
  | { ok: false; response: NextResponse };

/**
 * A cheap brake on guessing: every rejected attempt costs the caller a fixed wait.
 * Overridable (`AGENT_FAILURE_DELAY_MS`) so tests do not have to sit through it.
 */
async function failureDelay(): Promise<void> {
  const configured = Number(process.env.AGENT_FAILURE_DELAY_MS);
  const ms =
    process.env.AGENT_FAILURE_DELAY_MS !== undefined && Number.isFinite(configured)
      ? configured
      : DEFAULT_FAILURE_DELAY_MS;

  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function reject(
  request: Request,
  reason: "bad_key" | "bad_passcode",
  response: NextResponse,
): Promise<AgentAccess> {
  // The supplied values are deliberately absent from the log line.
  logEvent("agent_auth_failed", { ip_address: extractIp(request), reason }, "error");
  await failureDelay();

  return { ok: false, response };
}

/**
 * The guard every `/api/agent/*` handler runs first.
 *
 * Two independent secrets: the agent key opens the public space, and a passcode
 * sent *in the same request* opens the private one. Nothing is remembered between
 * requests — there is no cookie or token to replay — so the agent has to be handed
 * the passcode again every time it needs the private space.
 */
export async function authorizeAgent(request: Request): Promise<AgentAccess> {
  const configuredKey = process.env.AGENT_API_KEY;
  if (typeof configuredKey !== "string" || configuredKey === "") {
    return {
      ok: false,
      response: jsonError("UNCONFIGURED", "Set AGENT_API_KEY, then restart the server.", 503),
    };
  }

  const providedKey = request.headers.get(AGENT_KEY_HEADER);
  if (providedKey === null || !constantTimeEqual(providedKey, configuredKey)) {
    return reject(
      request,
      "bad_key",
      jsonError("UNAUTHORIZED", "Invalid or missing agent key.", 401),
    );
  }

  const passcode = request.headers.get(PASSCODE_HEADER);
  if (passcode === null) {
    return { ok: true, privateOpen: false };
  }

  if (!isLockedPasscodeConfigured(process.env.LOCKED_PASSCODE)) {
    return {
      ok: false,
      response: jsonError("UNCONFIGURED", "Set LOCKED_PASSCODE, then restart the server.", 503),
    };
  }

  if (!verifyLockedPasscode(passcode, process.env.LOCKED_PASSCODE)) {
    return reject(
      request,
      "bad_passcode",
      jsonError("PASSCODE_REQUIRED", "The passcode is wrong. Ask the owner for it.", 403),
    );
  }

  return { ok: true, privateOpen: true };
}

interface ConfirmTarget {
  id: string;
  updatedAt: number;
}

/**
 * The confirmation token is not the agent key: it is signed with a key *derived*
 * from it, under a context naming the link and its last-update time. So it only
 * ever confirms one deletion of one unchanged link, and it is worthless as a cookie
 * or as a credential anywhere else.
 */
function confirmSecret(): string | undefined {
  const key = process.env.AGENT_API_KEY;
  if (typeof key !== "string" || key === "") return undefined;

  return createHmac("sha256", key).update("agent-delete-confirm").digest("hex");
}

function confirmContext(link: ConfirmTarget): string {
  return `agent-delete:${link.id}:${link.updatedAt}`;
}

export function signDeleteConfirm(link: ConfirmTarget, now: number): string {
  return signToken({
    now,
    secret: confirmSecret() ?? "",
    context: confirmContext(link),
    ttlMs: CONFIRM_TTL_MS,
  });
}

export function verifyDeleteConfirm(
  token: string | null | undefined,
  link: ConfirmTarget,
  now: number,
): boolean {
  return verifyToken(token, {
    now,
    secret: confirmSecret(),
    context: confirmContext(link),
  }).valid;
}
