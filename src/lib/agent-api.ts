import type { Database } from "@/db/client";
import { getAlbumById } from "@/db/albums";
import { getLinkById, type LinkScope } from "@/db/links";
import { isDomainLocked } from "@/db/locked-domains";
import type { Album, Link } from "@/db/schema";
import type { AlbumScope } from "@/lib/albums";
import type { ParseResult } from "@/lib/validation";

/** The agent's vocabulary for the two sides: "public" is `/`, "private" is `/locked`. */
export type Space = "public" | "private";

export const AGENT_DEFAULT_LIMIT = 20;
export const AGENT_MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 200;
const MAX_DOMAIN_LENGTH = 253;

export function spaceToScope(space: Space): AlbumScope & LinkScope {
  return space === "private" ? "locked" : "visible";
}

export function parseSpace(raw: string | null): ParseResult<Space> {
  if (raw === null || raw === "" || raw === "public") return { ok: true, data: "public" };
  if (raw === "private") return { ok: true, data: "private" };

  return { ok: false, message: "space: must be 'public' or 'private'" };
}

export interface AgentSearch {
  q: string;
  domain: string;
  albumId?: string;
  noAlbum: boolean;
  favorite: boolean;
  space: Space;
  limit: number;
  offset: number;
}

function isTruthy(raw: string | null): boolean {
  return raw !== null && ["1", "true", "on", "yes"].includes(raw.toLowerCase());
}

function parseInteger(
  name: string,
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): ParseResult<number> {
  if (raw === null || raw === "") return { ok: true, data: fallback };

  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: `${name}: must be a whole number` };
  }

  const value = Number(raw);
  if (value < min || value > max) {
    return { ok: false, message: `${name}: must be between ${min} and ${max}` };
  }

  return { ok: true, data: value };
}

/** Turns the query string of `GET /api/agent/links` into a validated search. */
export function parseAgentSearch(params: URLSearchParams): ParseResult<AgentSearch> {
  const space = parseSpace(params.get("space"));
  if (!space.ok) return space;

  const limit = parseInteger("limit", params.get("limit"), AGENT_DEFAULT_LIMIT, 1, AGENT_MAX_LIMIT);
  if (!limit.ok) return limit;

  const offset = parseInteger("offset", params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offset.ok) return offset;

  const albumId = params.get("album")?.trim() || undefined;
  const noAlbum = isTruthy(params.get("noAlbum"));
  if (albumId !== undefined && noAlbum) {
    return { ok: false, message: "album: cannot be combined with noAlbum" };
  }

  return {
    ok: true,
    data: {
      q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
      domain: (params.get("domain") ?? "").trim().toLowerCase().slice(0, MAX_DOMAIN_LENGTH),
      albumId,
      noAlbum,
      favorite: isTruthy(params.get("favorite")),
      space: space.data,
      limit: limit.data,
      offset: offset.data,
    },
  };
}

export interface AgentLinkRow {
  id: string;
  title: string;
  domain: string;
  summary: string | null;
  albums: string[];
  fav: boolean;
}

/** The compact search row: no url, no thumbnail — that is what keeps tokens low. */
export function toAgentRow(link: Link, albumNames: readonly string[]): AgentLinkRow {
  return {
    id: link.id,
    title: link.title,
    domain: link.domain,
    summary: link.summary,
    albums: [...albumNames],
    fav: link.isFavorite,
  };
}

export function toAgentDetail(link: Link, albumNames: readonly string[], space: Space) {
  return {
    ...toAgentRow(link, albumNames),
    url: link.url,
    thumbnail: link.thumbnail,
    space,
  };
}

/**
 * Finds a link the caller is allowed to know about. A private link without the
 * passcode answers exactly like a missing id (`undefined`), so the response cannot
 * be used to learn which ids exist in the private space.
 */
export async function resolveLinkForAgent(
  db: Database,
  id: string,
  access: { privateOpen: boolean },
): Promise<{ link: Link; space: Space } | undefined> {
  const link = await getLinkById(db, id);
  if (link === undefined) return undefined;

  const space: Space = (await isDomainLocked(db, link.domain)) ? "private" : "public";
  if (space === "private" && !access.privateOpen) return undefined;

  return { link, space };
}

/** The album counterpart of `resolveLinkForAgent`. */
export async function resolveAlbumForAgent(
  db: Database,
  id: string,
  access: { privateOpen: boolean },
): Promise<{ album: Album; space: Space } | undefined> {
  const album = await getAlbumById(db, id);
  if (album === undefined) return undefined;

  const space: Space = album.scope === "locked" ? "private" : "public";
  if (space === "private" && !access.privateOpen) return undefined;

  return { album, space };
}
