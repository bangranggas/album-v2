import { describe, expect, it } from "vitest";

import {
  addToSelection,
  bulkAddReport,
  partitionSelection,
  removeFromSelection,
  selectionLabel,
  toggleSelection,
} from "@/lib/link-selection";

describe("toggleSelection", () => {
  it("adds an id that was not selected", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
  });

  it("keeps the order ids were selected in", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that was selected", () => {
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("leaves the input untouched", () => {
    const selected = ["a"];

    toggleSelection(selected, "b");

    expect(selected).toEqual(["a"]);
  });
});

describe("addToSelection", () => {
  it("unions the ids, keeping first-seen order", () => {
    expect(addToSelection(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("is idempotent: selecting everything twice cannot grow the list", () => {
    expect(addToSelection(["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("deduplicates the incoming ids", () => {
    expect(addToSelection([], ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("returns the same selection for an empty id list", () => {
    expect(addToSelection(["a"], [])).toEqual(["a"]);
  });

  it("leaves both inputs untouched", () => {
    const selected = ["a"];
    const ids = ["b"];

    addToSelection(selected, ids);

    expect(selected).toEqual(["a"]);
    expect(ids).toEqual(["b"]);
  });
});

describe("removeFromSelection", () => {
  it("removes several ids at once", () => {
    expect(removeFromSelection(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });

  it("keeps the order of what is left", () => {
    expect(removeFromSelection(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("ignores ids that are not selected", () => {
    expect(removeFromSelection(["a"], ["b"])).toEqual(["a"]);
  });

  it("returns the selection unchanged for an empty id list", () => {
    expect(removeFromSelection(["a"], [])).toEqual(["a"]);
  });

  it("leaves both inputs untouched", () => {
    const selected = ["a", "b"];
    const ids = ["a"];

    removeFromSelection(selected, ids);

    expect(selected).toEqual(["a", "b"]);
    expect(ids).toEqual(["a"]);
  });
});

describe("partitionSelection", () => {
  it("splits the selection into what the page shows and what it does not", () => {
    expect(partitionSelection(["a", "b", "c"], ["c", "a"])).toEqual({
      visible: ["a", "c"],
      outOfView: ["b"],
    });
  });

  it("reports nothing out of view when the whole page is selected", () => {
    expect(partitionSelection(["a", "b"], ["a", "b"])).toEqual({
      visible: ["a", "b"],
      outOfView: [],
    });
  });

  it("reports everything as out of view when no selected link is rendered", () => {
    expect(partitionSelection(["a", "b"], ["c"])).toEqual({
      visible: [],
      outOfView: ["a", "b"],
    });
  });

  it("ignores rendered ids that are not selected", () => {
    expect(partitionSelection(["a"], ["a", "b", "c"]).visible).toEqual(["a"]);
  });

  it("follows the selection order, not the page order", () => {
    expect(partitionSelection(["c", "a"], ["a", "b", "c"]).visible).toEqual([
      "c",
      "a",
    ]);
  });
});

describe("selectionLabel", () => {
  it("says nothing is selected for an empty selection", () => {
    expect(selectionLabel(0, 0)).toBe("Nothing selected");
  });

  it("uses the singular for one link", () => {
    expect(selectionLabel(1, 0)).toBe("1 link selected");
  });

  it("counts the selection", () => {
    expect(selectionLabel(7, 0)).toBe("7 links selected");
  });

  it("marks how many selected links are not on screen", () => {
    expect(selectionLabel(7, 2)).toBe("7 links selected · 2 links out of view");
  });

  it("marks a single out-of-view link in the singular", () => {
    expect(selectionLabel(1, 1)).toBe("1 link selected · 1 link out of view");
  });
});

describe("bulkAddReport", () => {
  it("names the album that received the links", () => {
    expect(bulkAddReport({ added: 3, alreadyIn: 0, skipped: 0 }, "Anime")).toBe(
      "3 links added to “Anime”",
    );
  });

  it("uses the singular for a single link", () => {
    expect(bulkAddReport({ added: 1, alreadyIn: 0, skipped: 0 }, "Anime")).toBe(
      "1 link added to “Anime”",
    );
  });

  it("mentions the links that were already there", () => {
    expect(bulkAddReport({ added: 3, alreadyIn: 2, skipped: 0 }, "Anime")).toBe(
      "3 links added to “Anime”, 2 already there",
    );
  });

  it("mentions skipped links", () => {
    expect(bulkAddReport({ added: 3, alreadyIn: 0, skipped: 1 }, "Anime")).toBe(
      "3 links added to “Anime”, 1 link skipped",
    );
  });

  it("mentions both extra counts", () => {
    expect(bulkAddReport({ added: 3, alreadyIn: 2, skipped: 1 }, "Anime")).toBe(
      "3 links added to “Anime”, 2 already there, 1 link skipped",
    );
  });

  it("says nothing was added when every link was already there", () => {
    expect(bulkAddReport({ added: 0, alreadyIn: 2, skipped: 0 }, "Anime")).toBe(
      "Nothing added: 2 links were already in “Anime”",
    );
  });

  it("uses the singular for one link that was already there", () => {
    expect(bulkAddReport({ added: 0, alreadyIn: 1, skipped: 0 }, "Anime")).toBe(
      "Nothing added: 1 link was already in “Anime”",
    );
  });

  it("says nothing was added when every link had been deleted", () => {
    expect(bulkAddReport({ added: 0, alreadyIn: 0, skipped: 2 }, "Anime")).toBe(
      "Nothing added: 2 links skipped",
    );
  });

  it("mentions both reasons when nothing was added", () => {
    expect(bulkAddReport({ added: 0, alreadyIn: 1, skipped: 1 }, "Anime")).toBe(
      "Nothing added: 1 link was already in “Anime”, 1 link skipped",
    );
  });

  it("handles a report where nothing happened at all", () => {
    expect(bulkAddReport({ added: 0, alreadyIn: 0, skipped: 0 }, "Anime")).toBe(
      "Nothing added",
    );
  });

  it("quotes the album name as given, symbols included", () => {
    expect(
      bulkAddReport({ added: 1, alreadyIn: 0, skipped: 0 }, "🎬 Favorites"),
    ).toBe("1 link added to “🎬 Favorites”");
  });
});
