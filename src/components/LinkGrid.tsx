import { LinkCard } from "@/components/LinkCard";
import { NoMatches } from "@/components/NoMatches";
import type { Link } from "@/db/schema";
import type { LinkFilters } from "@/lib/link-filters";

export interface LinkGridProps {
  links: readonly Link[];
  filters: LinkFilters;
  /** Where "Clear filters" points, and how the cards label themselves. */
  basePath?: string;
  /** True on the dark locked page, so the cards can send expired passcodes back. */
  locked?: boolean;
}

/**
 * The card grid and its "nothing matched" state, shared by the dashboard and the
 * locked page so the two can never drift apart.
 */
export function LinkGrid({ links, filters, basePath = "/", locked = false }: LinkGridProps) {
  if (links.length === 0) {
    return <NoMatches filters={filters} basePath={basePath} />;
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {links.map((link) => (
        <li key={link.id}>
          <LinkCard link={link} locked={locked} />
        </li>
      ))}
    </ul>
  );
}
