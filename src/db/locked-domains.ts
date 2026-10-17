import { asc, count, eq } from "drizzle-orm";

import type { Database } from "./client";
import { links, lockedDomains } from "./schema";

/** One entry of the locked-domain panel: the domain, its links, and when it was locked. */
export interface LockedDomainOption {
  domain: string;
  /** How many links currently live on that domain (0 for a pre-emptive lock). */
  count: number;
  createdAt: number;
}

/**
 * Every locked domain, alphabetically, with how many links it holds.
 *
 * The count comes from a left join so a domain locked before any link was saved
 * still shows up (with `0`) instead of disappearing from the list.
 */
export async function listLockedDomains(
  db: Database,
): Promise<LockedDomainOption[]> {
  return db
    .select({
      domain: lockedDomains.domain,
      createdAt: lockedDomains.createdAt,
      count: count(links.id),
    })
    .from(lockedDomains)
    .leftJoin(links, eq(links.domain, lockedDomains.domain))
    .groupBy(lockedDomains.domain, lockedDomains.createdAt)
    .orderBy(asc(lockedDomains.domain));
}

/**
 * Hides a domain. Idempotent: locking an already-locked domain changes nothing
 * and reports `false`, so a double click cannot report an error.
 */
export async function lockDomain(db: Database, domain: string): Promise<boolean> {
  const inserted = await db
    .insert(lockedDomains)
    .values({ domain, createdAt: Date.now() })
    .onConflictDoNothing({ target: lockedDomains.domain })
    .returning();

  return inserted.length > 0;
}

/**
 * Reveals a domain again, which brings its links back to the normal dashboard.
 * Reports `false` when the domain was not locked.
 */
export async function unlockDomain(
  db: Database,
  domain: string,
): Promise<boolean> {
  const removed = await db
    .delete(lockedDomains)
    .where(eq(lockedDomains.domain, domain))
    .returning();

  return removed.length > 0;
}
