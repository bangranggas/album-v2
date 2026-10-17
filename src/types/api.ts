import type { Link } from "@/db/schema";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "UNCONFIGURED";

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
}

/**
 * Wire representation of a stored link: timestamps as ISO-8601 strings.
 *
 * `domain` and `isFavorite` were added for the dashboard; the userscript simply
 * ignores fields it does not know, so the payload stays backwards compatible.
 */
export interface ApiLink {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  domain: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toApiLink(row: Link): ApiLink {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    thumbnail: row.thumbnail,
    domain: row.domain,
    isFavorite: row.isFavorite,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function apiError(code: ApiErrorCode, message: string): ApiErrorBody {
  return { ok: false, error: { code, message } };
}
