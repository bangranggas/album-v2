import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MultiCategoryFilterModal,
  type FilterCategory,
} from "@/components/MultiCategoryFilterModal";

const noop = (): void => {};

const categories: FilterCategory[] = [
  {
    id: "album",
    label: "Album",
    options: [
      { value: "album-1", label: "Anime" },
      { value: "album-2", label: "Best" },
    ],
    specials: [{ value: "__not_in_album__", label: "Not in an album" }],
  },
  {
    id: "domain",
    label: "Domain",
    options: [{ value: "example.com", label: "example.com", count: 4 }],
  },
];

function render(
  value = {
    album: { include: [] as string[], exclude: [] as string[] },
    domain: { include: [] as string[], exclude: [] as string[] },
  },
): string {
  return renderToString(
    createElement(MultiCategoryFilterModal, {
      categories,
      value,
      onApply: noop,
      onClose: noop,
    }),
  );
}

describe("MultiCategoryFilterModal", () => {
  it("renders a labelled dialog with both categories and the footer actions", () => {
    const html = render();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="filter-modal-title"');
    expect(html).toContain("Filter");
    expect(html).toContain("Album");
    expect(html).toContain("Domain");
    expect(html).toContain("Clear filter");
    expect(html).toContain("Apply");
  });

  it("starts with every option checked on the include side and none excluded", () => {
    const html = render();

    // All (the control) plus the two included album rows are checked.
    expect(html.match(/<input[^>]*checked/g)?.length).toBe(3);
    expect(html).toContain("Anime");
    expect(html).toContain("Best");
  });

  it("renders the domain count on the right of the domain name", () => {
    const domainFirst: FilterCategory[] = [
      {
        id: "domain",
        label: "Domain",
        options: [{ value: "example.com", label: "example.com", count: 4 }],
      },
      {
        id: "album",
        label: "Album",
        options: [
          { value: "album-1", label: "Anime" },
          { value: "album-2", label: "Best" },
        ],
        specials: [{ value: "__not_in_album__", label: "Not in an album" }],
      },
    ];

    const html = renderToString(
      createElement(MultiCategoryFilterModal, {
        categories: domainFirst,
        value: { domain: { include: [], exclude: [] } },
        onApply: noop,
        onClose: noop,
      }),
    );

    expect(html).toContain("example.com");
    expect(html).toMatch(/>4<\/span>/);
  });

  it("renders the pinned special option as a pressed toggle when selected", () => {
    const html = render({
      album: { include: ["__not_in_album__"], exclude: [] },
      domain: { include: [], exclude: [] },
    });

    expect(html).toContain("Not in an album");
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*Not in an album/);
  });

  it("shows the include and exclude column counts", () => {
    const html = render({
      album: { include: ["album-1"], exclude: ["album-2"] },
      domain: { include: [], exclude: [] },
    });

    // One in Include, one in Exclude: each header's count is rendered next to it.
    expect(html.match(/>1<\/span>/g)?.length).toBeGreaterThanOrEqual(2);
  });
});