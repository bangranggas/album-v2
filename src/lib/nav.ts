export interface NavItem {
  /** App route. Must be a path the proxy gates, so it stays behind the session. */
  href: string;
  label: string;
}

/**
 * The navbar is data-driven: adding a module means adding one entry here, with no
 * layout or component changes. The first entry is the dashboard itself.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Links" },
];
