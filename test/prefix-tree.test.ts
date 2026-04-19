import { describe, expect, it } from "vitest";
import {
  buildPrefixTreeFromKeys,
  countPrefixTreeKeys,
  createPrefixTreeRoot,
  insertKeyIntoPrefixTree,
} from "../src/prefix-tree.js";

describe("prefix-tree", () => {
  it("builds and counts keys", () => {
    const root = buildPrefixTreeFromKeys(["a/b/c.txt", "a/b/d.txt", "x/y"]);
    expect(countPrefixTreeKeys(root)).toBe(3);
  });

  it("supports lazy incremental insert", () => {
    const root = createPrefixTreeRoot();
    insertKeyIntoPrefixTree(root, "pre/obj1.bin");
    insertKeyIntoPrefixTree(root, "pre/obj2.bin");
    expect(countPrefixTreeKeys(root)).toBe(2);
  });
});
