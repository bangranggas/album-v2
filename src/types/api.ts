import type { Link } from "@/db/schema";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
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

/** Wire representation of a stored link: timestamps as ISO-8601 strings. */
export interface ApiLink {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toApiLink(row: Link): ApiLink {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    thumbnail: row.thumbnail,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function apiError(code: ApiErrorCode, message: string): ApiErrorBody {
  return { ok: false, error: { code, message } };
}
