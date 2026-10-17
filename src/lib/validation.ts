import { z } from "zod";

export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 512;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export interface LinkInput {
  url: string;
  title: string;
  thumbnail: string | null;
  /** Lowercased host of `url`, used to group and filter links on the dashboard. */
  domain: string;
}

export interface LoginInput {
  password: string;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  return parseHttpUrl(value) !== null;
}

/**
 * `""`, `null`, and a missing field all collapse to `null`. Anything else is
 * trimmed and kept as-is so the caller can validate it.
 */
function normalizeThumbnail(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const urlField = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH, `must be at most ${MAX_URL_LENGTH} characters`)
  .refine(isHttpUrl, { message: "must be an absolute http(s) URL" });

const titleField = z
  .string()
  .trim()
  .min(1, "is required")
  .max(MAX_TITLE_LENGTH, `must be at most ${MAX_TITLE_LENGTH} characters`);

const linkInputSchema = z
  .object({
    url: urlField,
    title: titleField,
    thumbnail: z.union([z.string(), z.null()]).optional(),
  })
  .superRefine((value, ctx) => {
    const thumbnail = normalizeThumbnail(value.thumbnail);
    if (thumbnail === null) return;

    if (thumbnail.length > MAX_URL_LENGTH || !isHttpUrl(thumbnail)) {
      ctx.addIssue({
        code: "custom",
        path: ["thumbnail"],
        message: "must be an absolute http(s) URL, or empty",
      });
    }
  })
  .transform(
    (value): LinkInput => ({
      url: value.url,
      title: value.title,
      thumbnail: normalizeThumbnail(value.thumbnail),
      // `url` was already refined to an absolute http(s) URL, so the parse cannot
      // fail here; the fallback only keeps this total for the type checker.
      domain: parseHttpUrl(value.url)?.host ?? "",
    }),
  );

/** Renders the first Zod issue as `field: reason` for API error messages. */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "payload: invalid input";

  const field = issue.path.length > 0 ? String(issue.path[0]) : "payload";
  return `${field}: ${issue.message}`;
}

export function parseLinkInput(raw: unknown): ParseResult<LinkInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = linkInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: result.data };
}

/**
 * The dashboard has no usernames: a single password is the entire credential, so
 * unknown fields are stripped and every other field is ignored. Whitespace is
 * preserved because a password may legitimately contain spaces.
 */
const loginInputSchema = z.object({
  password: z.string().min(1, "is required"),
});

export function parseLoginInput(raw: unknown): ParseResult<LoginInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = loginInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: result.data };
}

export function parseJsonBody(rawText: string): ParseResult<unknown> {
  if (rawText.trim() === "") {
    return { ok: false, message: "Request body is empty or not valid JSON." };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) };
  } catch {
    return { ok: false, message: "Request body is not valid JSON." };
  }
}

export function parseLimitParam(raw: string | null): ParseResult<number> {
  if (raw === null) {
    return { ok: true, data: DEFAULT_LIMIT };
  }

  const value = Number(raw.trim());
  const isInteger = Number.isInteger(value);

  if (raw.trim() === "" || !isInteger || value < 1 || value > MAX_LIMIT) {
    return {
      ok: false,
      message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
    };
  }

  return { ok: true, data: value };
}
