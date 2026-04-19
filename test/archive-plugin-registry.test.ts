import { describe, expect, it } from "vitest";
import { ArchivePluginRegistry } from "../src/archive-plugin-registry.js";

describe("ArchivePluginRegistry", () => {
  it("registers and retrieves", () => {
    const r = new ArchivePluginRegistry<string>();
    r.register("a", "plugin-a");
    expect(r.get("a")).toBe("plugin-a");
    expect(r.has("a")).toBe(true);
    expect(r.unregister("a")).toBe(true);
    expect(r.get("a")).toBeUndefined();
  });

  it("rejects empty name", () => {
    const r = new ArchivePluginRegistry();
    expect(() => r.register("", {})).toThrow();
  });
});
