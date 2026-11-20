import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
}));

import { AlbumMembershipLabel } from "@/components/AlbumMembershipLabel";
import { LinkCover } from "@/components/LinkCover";
import { SelectionProvider } from "@/components/SelectionProvider";

/**
 * These are markup tests, not interaction tests: the project has no DOM test
 * environment, and the parts worth pinning down are the contract with the browser —
 * which element owns the checkbox, what it is called, and where the album links point.
 *
 * `renderToString`, not `renderToStaticMarkup`: it keeps React's `<!-- -->` separators
 * between adjacent text nodes, which is exactly what Next streams to the browser, so a
 * label that renders `+1` only by accident cannot slip through here.
 */
function render(element: ReactElement): string {
  return renderToString(element);
}

describe("LinkCover", () => {
  const cover = {
    linkId: "link-1",
    title: "A saved link",
    thumbnail: null as string | null,
    host: "example.com",
  };

  it("falls back to the domain when the link has no thumbnail", () => {
    const html = render(createElement(LinkCover, cover));

    expect(html).toContain("example.com");
    expect(html).not.toContain("<img");
  });

  it("renders the image as before when there is nothing to select", () => {
    const html = render(
      createElement(LinkCover, { ...cover, thumbnail: "https://img.example/x.jpg" }),
    );

    expect(html).toContain('src="https://img.example/x.jpg"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("<label");
    expect(html).not.toContain('type="checkbox"');
  });

  it("turns the whole cover into the checkbox's label on a selection page", () => {
    const html = render(
      createElement(SelectionProvider, null, createElement(LinkCover, cover)),
    );

    // One control, one focus stop, and the cover content lives inside its label.
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html.match(/<label/g)).toHaveLength(1);
    expect(html).toMatch(/<label[^>]*>[\s\S]*<input[^>]*type="checkbox"[\s\S]*example\.com[\s\S]*<\/label>/);
  });

  it("keeps the accessible name the bulk bar's tests already use", () => {
    const html = render(
      createElement(SelectionProvider, null, createElement(LinkCover, cover)),
    );

    expect(html).toContain('aria-label="Select A saved link"');
  });

  it("starts unchecked and adds no second control", () => {
    const html = render(
      createElement(SelectionProvider, null, createElement(LinkCover, cover)),
    );

    expect(html).not.toContain("checked");
    expect(html).not.toContain("<button");
  });

  it("keeps the image inside the label too", () => {
    const html = render(
      createElement(SelectionProvider, null,
        createElement(LinkCover, { ...cover, thumbnail: "https://img.example/x.jpg" }),
      ),
    );

    expect(html).toMatch(/<label[^>]*>[\s\S]*<img[^>]*src="https:\/\/img\.example\/x\.jpg"[\s\S]*<\/label>/);
  });
});

describe("AlbumMembershipLabel", () => {
  const albums = [
    { id: "a", name: "Anime" },
    { id: "b", name: "Books" },
    { id: "c", name: "Cooking" },
    { id: "d", name: "Design" },
  ];

  it("renders nothing for a link that is in no album", () => {
    const html = render(
      createElement(AlbumMembershipLabel, { albumIds: [], albums }),
    );

    expect(html).toBe("");
  });

  it("lists the albums that hold the link, in album order", () => {
    const html = render(
      createElement(AlbumMembershipLabel, { albumIds: ["c", "a"], albums }),
    );

    expect(html).toContain("In");
    expect(html).toContain(">Anime</a>");
    expect(html).toContain(">Cooking</a>");
    expect(html.indexOf(">Anime</a>")).toBeLessThan(html.indexOf(">Cooking</a>"));
    expect(html).not.toContain("Books");
  });

  it("links each name to the light album route by default", () => {
    const html = render(
      createElement(AlbumMembershipLabel, { albumIds: ["a"], albums }),
    );

    expect(html).toContain('href="/albums/a"');
  });

  it("stays inside the hidden area on the locked page", () => {
    const html = render(
      createElement(AlbumMembershipLabel, {
        albumIds: ["a"],
        albums,
        basePath: "/locked",
      }),
    );

    expect(html).toContain('href="/locked/albums/a"');
  });

  it("collapses everything past the third name into +N", () => {
    const html = render(
      createElement(AlbumMembershipLabel, {
        albumIds: ["a", "b", "c", "d"],
        albums,
      }),
    );

    expect(html).toContain(">Anime</a>");
    expect(html).toContain(">Books</a>");
    expect(html).toContain(">Cooking</a>");
    expect(html).toContain("+1");
    expect(html).not.toContain(">Design</a>");
    // The hidden name is still discoverable, as the +N tooltip.
    expect(html).toContain('title="Design"');
  });
});

describe("LinkSummary", () => {
  it("shows the summary as a muted line", async () => {
    const { LinkSummary } = await import("@/components/LinkSummary");

    const html = render(createElement(LinkSummary, { summary: "A short note about the page" }));

    expect(html).toContain("A short note about the page");
  });

  it("renders nothing when the summary is null or blank", async () => {
    const { LinkSummary } = await import("@/components/LinkSummary");

    expect(render(createElement(LinkSummary, { summary: null }))).toBe("");
    expect(render(createElement(LinkSummary, { summary: "   " }))).toBe("");
  });
});

describe("LinkCard and LinkList dual timestamps (createdAt & updatedAt)", () => {
  const sampleLink = {
    id: "link-dual-time",
    url: "https://example.com/dual",
    domain: "example.com",
    title: "Dual Time Link",
    thumbnail: null,
    summary: "Short summary",
    isFavorite: false,
    createdAt: Date.parse("2026-01-10T10:00:00.000Z"),
    updatedAt: Date.parse("2026-06-15T15:30:00.000Z"),
  };

  it("renders both Created (createdAt) and Updated (updatedAt) timestamps on LinkCard when updated after creation", async () => {
    const { LinkCard } = await import("@/components/LinkCard");

    const html = render(createElement(LinkCard, { link: sampleLink }));

    expect(html).toContain('dateTime="2026-01-10T10:00:00.000Z"');
    expect(html).toContain('dateTime="2026-06-15T15:30:00.000Z"');
    expect(html).toContain("Created");
    expect(html).toContain("Updated");
  });

  it("hides Updated on LinkCard when the link has never been updated since creation", async () => {
    const { LinkCard } = await import("@/components/LinkCard");

    const uneditedLink = {
      ...sampleLink,
      updatedAt: sampleLink.createdAt,
    };

    const html = render(createElement(LinkCard, { link: uneditedLink }));

    expect(html).toContain('dateTime="2026-01-10T10:00:00.000Z"');
    expect(html).toContain("Created");
    expect(html).not.toContain("Updated");
  });

  it("renders both Created and Updated columns and timestamps on LinkList", async () => {
    const { LinkList } = await import("@/components/LinkList");

    const html = render(createElement(LinkList, { links: [sampleLink] }));

    expect(html).toContain(">Created</th>");
    expect(html).toContain(">Updated</th>");
    expect(html).toContain('dateTime="2026-01-10T10:00:00.000Z"');
    expect(html).toContain('dateTime="2026-06-15T15:30:00.000Z"');
  });
});

describe("LinkPagination", () => {
  it("renders nothing on page 1 when hasMore is false", async () => {
    const { LinkPagination } = await import("@/components/LinkPagination");
    const { EMPTY_FILTERS } = await import("@/lib/link-filters");

    const html = render(
      createElement(LinkPagination, {
        filters: EMPTY_FILTERS,
        hasMore: false,
      }),
    );

    expect(html).toBe("");
  });

  it("renders Next link on page 1 when hasMore is true, preserving sort and view", async () => {
    const { LinkPagination } = await import("@/components/LinkPagination");
    const { EMPTY_FILTERS } = await import("@/lib/link-filters");

    const html = render(
      createElement(LinkPagination, {
        filters: { ...EMPTY_FILTERS, sort: "updated", view: "list", page: 1 },
        hasMore: true,
      }),
    );

    expect(html).toContain("Page 1");
    expect(html).toContain('href="/?sort=updated&amp;view=list&amp;page=2"');
  });

  it("renders Previous link on page 2 pointing back to page 1 without ?page=1", async () => {
    const { LinkPagination } = await import("@/components/LinkPagination");
    const { EMPTY_FILTERS } = await import("@/lib/link-filters");

    const html = render(
      createElement(LinkPagination, {
        filters: { ...EMPTY_FILTERS, page: 2 },
        hasMore: false,
      }),
    );

    expect(html).toContain("Page 2");
    expect(html).toContain('href="/"');
  });
});
