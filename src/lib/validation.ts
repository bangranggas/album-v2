import { z } from "zod";

export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 512;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;

/**
 * Longest host allowed for a locked domain. The DNS limit (253 characters), which
 * also bounds what `links.domain` can hold.
 */
export const MAX_DOMAIN_LENGTH = 253;

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

/**
 * A partial edit of a stored link. Only the fields present are written, so a
 * favorite toggle cannot clear a thumbnail by omission.
 *
 * `domain` is never read from the client: it is derived from `url` whenever a new
 * URL is given, so a caller cannot hand a link a domain that does not match it.
 */
export interface LinkPatch {
  title?: string;
  url?: string;
  domain?: string;
  thumbnail?: string | null;
  isFavorite?: boolean;
}

export interface LockedDomainInput {
  domain: string;
}

export interface LoginInput {
  password: string;
}

export interface PasscodeInput {
  passcode: string;
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

/** Guards the shape every payload parser accepts: a JSON object, nothing else. */
function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** Renders the first Zod issue as `field: reason` for API error messages. */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "payload: invalid input";

  const field = issue.path.length > 0 ? String(issue.path[0]) : "payload";
  return `${field}: ${issue.message}`;
}

export function parseLinkInput(raw: unknown): ParseResult<LinkInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = linkInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: result.data };
}

/**
 * A placeholder title for a link added by hand without one: `host + path`, e.g.
 * `example.com/article`. The query string is dropped because it is usually noise,
 * and the result is capped so the database constraint always holds.
 */
export function deriveTitleFromUrl(value: string): string {
  const parsed = parseHttpUrl(value);
  if (parsed === null) {
    return value.trim().slice(0, MAX_TITLE_LENGTH);
  }

  const path = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.host}${path}`.slice(0, MAX_TITLE_LENGTH);
}

/**
 * The manual "add a link" form. Identical to the userscript payload except that
 * the title is optional, in which case it is derived from the URL.
 */
const manualLinkInputSchema = z
  .object({
    url: urlField,
    title: z
      .string()
      .trim()
      .max(MAX_TITLE_LENGTH, `must be at most ${MAX_TITLE_LENGTH} characters`)
      .optional(),
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
      title:
        value.title === undefined || value.title === ""
          ? deriveTitleFromUrl(value.url)
          : value.title,
      thumbnail: normalizeThumbnail(value.thumbnail),
      domain: parseHttpUrl(value.url)?.host ?? "",
    }),
  );

export function parseManualLinkInput(raw: unknown): ParseResult<LinkInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = manualLinkInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: result.data };
}

/**
 * A partial edit. Unknown fields are dropped by Zod, which is what keeps a
 * client-supplied `domain` from ever reaching the database.
 */
const linkPatchSchema = z
  .object({
    title: titleField.optional(),
    url: urlField.optional(),
    thumbnail: z.union([z.string(), z.null()]).optional(),
    isFavorite: z.boolean().optional(),
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
  .transform((value): LinkPatch => {
    const patch: LinkPatch = {};

    if (value.title !== undefined) patch.title = value.title;
    if (value.isFavorite !== undefined) patch.isFavorite = value.isFavorite;
    if (value.thumbnail !== undefined) {
      patch.thumbnail = normalizeThumbnail(value.thumbnail);
    }
    if (value.url !== undefined) {
      patch.url = value.url;
      patch.domain = parseHttpUrl(value.url)?.host ?? "";
    }

    return patch;
  });

export function parseLinkPatch(raw: unknown): ParseResult<LinkPatch> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = linkPatchSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  if (Object.keys(result.data).length === 0) {
    return { ok: false, message: "payload: no fields to update" };
  }

  return { ok: true, data: result.data };
}

/** One DNS label: no leading or trailing hyphen, lowercase alphanumerics only. */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A value that already carries an explicit scheme, e.g. a pasted URL. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turns whatever the owner typed into a bare host, or `null` when it cannot be
 * one. A pasted URL is accepted (`https://example.com/x` → `example.com`), the
 * case is normalised, and a trailing dot is dropped.
 *
 * IPv6 literals are deliberately refused: `links.domain` stores a plain host, and
 * no such link can exist.
 */
function normalizeDomain(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (input === "") return null;

  let host = "";

  try {
    // A scheme-less value is tried as an https URL so `example.com/x` and
    // `example.com:8443` work; the path is dropped, which is what the owner means.
    host = HAS_SCHEME.test(input)
      ? new URL(input).host
      : new URL(`https://${input}`).host;
  } catch {
    return null;
  }

  host = host.replace(/\.+$/, "");
  if (host === "" || host.length > MAX_DOMAIN_LENGTH) return null;

  const [hostname, port, ...extra] = host.split(":");
  if (extra.length > 0) return null;
  if (hostname === undefined || hostname === "") return null;

  if (port !== undefined) {
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) return null;
  }

  const labels = hostname.split(".");
  const validLabels = labels.every(
    (label) =>
      label.length > 0 && label.length <= 63 && DOMAIN_LABEL.test(label),
  );
  if (!validLabels) return null;

  return port === undefined ? hostname : `${hostname}:${port}`;
}

const lockedDomainSchema = z.object({ domain: z.string() });

export function parseLockedDomain(raw: unknown): ParseResult<LockedDomainInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = lockedDomainSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  const domain = normalizeDomain(result.data.domain);
  if (domain === null) {
    return { ok: false, message: "domain: must be a host name like example.com" };
  }

  return { ok: true, data: { domain } };
}

/**
 * Longest album name accepted. Generous for a label, small enough that the tab
 * list and the per-card popup stay readable.
 */
export const MAX_ALBUM_NAME_LENGTH = 100;

/** Album ids are UUIDs; the cap only guards the column and the URL segment. */
const MAX_ALBUM_ID_LENGTH = 100;

export interface AlbumNameInput {
  /** The label as typed (trimmed), which is what the UI shows. */
  name: string;
  /**
   * `name.toLowerCase()`. This is the value the unique index stores, so `Anime`
   * and `anime` can never both exist. Stored rather than computed in SQL so the
   * constraint is a plain column index and stays portable.
   */
  nameKey: string;
}

export interface AlbumLinkInput {
  albumId: string;
}

const albumNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "is required")
    .max(
      MAX_ALBUM_NAME_LENGTH,
      `must be at most ${MAX_ALBUM_NAME_LENGTH} characters`,
    ),
});

/**
 * An album name, with its uniqueness key. Whitespace is trimmed at the ends but
 * kept inside, because "My Album" and "My  Album" are different labels; the case
 * is preserved for display and only folded into the key.
 */
export function parseAlbumName(raw: unknown): ParseResult<AlbumNameInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = albumNameSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  const name = result.data.name;

  return { ok: true, data: { name, nameKey: name.toLowerCase() } };
}

const albumLinkSchema = z.object({
  albumId: z
    .string()
    .trim()
    .min(1, "is required")
    .max(MAX_ALBUM_ID_LENGTH, `must be at most ${MAX_ALBUM_ID_LENGTH} characters`),
});

export function parseAlbumLinkInput(raw: unknown): ParseResult<AlbumLinkInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = albumLinkSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: { albumId: result.data.albumId } };
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
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = loginInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: describeIssue(result.error) };
  }

  return { ok: true, data: result.data };
}

/**
 * The locked-area passcode. Same shape as the dashboard password by design: one
 * secret, no username, and whitespace preserved because it may contain spaces.
 */
const passcodeInputSchema = z.object({
  passcode: z.string().min(1, "is required"),
});

export function parsePasscodeInput(raw: unknown): ParseResult<PasscodeInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "payload: must be a JSON object" };
  }

  const result = passcodeInputSchema.safeParse(raw);
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
