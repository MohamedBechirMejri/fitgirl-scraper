import { describe, expect, test } from "bun:test";
import { diffText, summarizeDiff } from "./text-diff";

describe("text diff", () => {
  test("finds changed middle tokens", () => {
    const diff = diffText("alpha beta gamma omega", "alpha beta delta omega");

    expect(diff.sharedPrefix).toEqual(["alpha", "beta"]);
    expect(diff.removed).toEqual(["gamma"]);
    expect(diff.added).toEqual(["delta"]);
    expect(diff.sharedSuffix).toEqual(["omega"]);
    expect(summarizeDiff(diff)).toBe("1 removed, 1 added");
  });
});
