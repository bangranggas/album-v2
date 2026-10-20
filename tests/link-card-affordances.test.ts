import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
