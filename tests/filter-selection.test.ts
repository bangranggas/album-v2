import { describe, expect, it } from "vitest";

import {
  categorySelection,
  cloneSelection,
  countCategory,
  countSelection,
  emptyCategory,
  emptySelection,
  hasCategorySelection,
  isColumnComplete,
  isColumnPartial,
  setAllIncluded,
  toggleMembership,
  toggleSpecial,
  type CategorySelection,
  type FilterSelection,
} from "@/lib/filter-selection";

const EMPTY: CategorySelection = { include: [], exclude: [] };

describe("empty helpers", () => {
  it("creates one empty entry per category", () => {
    expect(emptySelection(["domain", "album"])).toEqual({
      domain: { include: [], exclude: [] },
      album: { include: [], exclude: [] },
    });
  });

  it("returns a fresh category each time", () => {
    const first = emptyCategory();
    first.include.push("x");

    expect(emptyCategory()).toEqual(EMPTY);
  });

  it("falls back to an empty category for an unknown id", () => {
    expect(categorySelection({}, "domain")).toEqual(EMPTY);
  });

  it("reports whether a category has any value", () => {
    expect(hasCategorySelection(EMPTY)).toBe(false);
    expect(hasCategorySelection({ include: ["a"], exclude: [] })).toBe(true);
    expect(hasCategorySelection({ include: [], exclude: ["b"] })).toBe(true);
  });

  it("clones without sharing the arrays", () => {
    const source: FilterSelection = {
      domain: { include: ["a"], exclude: ["b"] },
    };
    const copy = cloneSelection(source);

    copy.domain!.include.push("c");

    expect(source.domain!.include).toEqual(["a"]);
    expect(copy.domain!.include).toEqual(["a", "c"]);
  });
});

describe("toggleMembership", () => {
  it("excludes an included value", () => {
    expect(
      toggleMembership({ include: ["a.com", "b.com"], exclude: [] }, "a.com"),
    ).toEqual({ include: ["b.com"], exclude: ["a.com"] });
  });

  it("includes an excluded value", () => {
    expect(
      toggleMembership({ include: [], exclude: ["a.com", "b.com"] }, "b.com"),
    ).toEqual({ include: ["b.com"], exclude: ["a.com"] });
  });

  it("flips a value each time and never duplicates it", () => {
    const once = toggleMembership(EMPTY, "a.com");
    const twice = toggleMembership(once, "a.com");

    expect(once).toEqual({ include: ["a.com"], exclude: [] });
    expect(twice).toEqual({ include: [], exclude: ["a.com"] });
  });

  it("never mutates the input", () => {
    const current: CategorySelection = { include: ["a.com"], exclude: [] };

    toggleMembership(current, "a.com");

    expect(current).toEqual({ include: ["a.com"], exclude: [] });
  });
});

describe("setAllIncluded", () => {
  it("includes every value and clears them from exclude", () => {
    expect(
      setAllIncluded(
        { include: ["a.com"], exclude: ["b.com", "c.com"] },
        ["a.com", "b.com"],
        true,
      ),
    ).toEqual({ include: ["a.com", "b.com"], exclude: ["c.com"] });
  });

  it("excludes every value and clears them from include", () => {
    expect(
      setAllIncluded(
        { include: ["a.com", "b.com"], exclude: ["c.com"] },
        ["a.com", "b.com"],
        false,
      ),
    ).toEqual({ include: [], exclude: ["c.com", "a.com", "b.com"] });
  });

  it("does not duplicate values that are already on the target side", () => {
    expect(
      setAllIncluded(
        { include: ["a.com"], exclude: [] },
        ["a.com", "b.com"],
        true,
      ),
    ).toEqual({ include: ["a.com", "b.com"], exclude: [] });
  });
});

describe("toggleSpecial", () => {
  it("checks a special option and pushes ordinary values to exclude", () => {
    expect(
      toggleSpecial(
        { include: ["album-1", "album-2"], exclude: [] },
        "__none__",
        true,
      ),
    ).toEqual({
      include: ["__none__"],
      exclude: ["album-1", "album-2"],
    });
  });

  it("unchecks only the special option", () => {
    expect(
      toggleSpecial(
        { include: ["__none__"], exclude: ["album-1", "album-2"] },
        "__none__",
        false,
      ),
    ).toEqual({ include: [], exclude: ["album-1", "album-2"] });
  });
});

describe("column completeness", () => {
  it("is complete only when every value is in the column", () => {
    expect(
      isColumnComplete({ include: ["a", "b"], exclude: [] }, ["a", "b"], "include"),
    ).toBe(true);
    expect(
      isColumnComplete({ include: ["a"], exclude: [] }, ["a", "b"], "include"),
    ).toBe(false);
  });

  it("is never complete for an empty option list", () => {
    expect(isColumnComplete(EMPTY, [], "include")).toBe(false);
  });

  it("is partial when some but not all values are in the column", () => {
    expect(
      isColumnPartial({ include: ["a"], exclude: [] }, ["a", "b"], "include"),
    ).toBe(true);
    expect(
      isColumnPartial({ include: ["a", "b"], exclude: [] }, ["a", "b"], "include"),
    ).toBe(false);
    expect(isColumnPartial(EMPTY, ["a", "b"], "include")).toBe(false);
  });
});

describe("counting", () => {
  it("counts only the excluded values, which are the active ones", () => {
    expect(countCategory({ include: ["a", "b"], exclude: ["c"] })).toBe(1);
    expect(countCategory({ include: ["a"], exclude: [] })).toBe(0);
  });

  it("sums every category", () => {
    expect(
      countSelection({
        domain: { include: ["a"], exclude: ["b"] },
        album: { include: [], exclude: ["c"] },
      }),
    ).toBe(2);
  });
});