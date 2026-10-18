import type { Album, Link } from "@/db/schema";

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

/**
 * Wire representation of an album. `nameKey` is deliberately not exposed: it is
 * an implementation detail of the uniqueness rule, and the client only ever needs
 * the label it typed.
 */
export interface ApiAlbum {
  id: string;
  name: string;
  /** Which page the album belongs to; the client shows it and never moves it. */
  scope: string;
  createdAt: string;
}

export function toApiAlbum(row: Album): ApiAlbum {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function apiError(code: ApiErrorCode, message: string): ApiErrorBody {
  return { ok: false, error: { code, message } };
}
