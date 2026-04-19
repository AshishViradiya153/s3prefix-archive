import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_MAX_OBJECT_COUNT,
  DEFAULT_BROWSER_MAX_TOTAL_BYTES,
  recommendArchiveExecutionSurface,
} from "../src/hybrid-archive-surface.js";

describe("recommendArchiveExecutionSurface", () => {
  it("prefers browser under thresholds", () => {
    const r = recommendArchiveExecutionSurface({
      totalBytesEstimate: 1_000_000,
      objectCountEstimate: 100,
    });
    expect(r.surface).toBe("browser");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("prefers server when bytes exceed default", () => {
    const r = recommendArchiveExecutionSurface({
      totalBytesEstimate: DEFAULT_BROWSER_MAX_TOTAL_BYTES + 1,
      objectCountEstimate: 1,
    });
    expect(r.surface).toBe("server");
  });

  it("prefers server when object count exceeds default", () => {
    const r = recommendArchiveExecutionSurface({
      totalBytesEstimate: 1,
      objectCountEstimate: DEFAULT_BROWSER_MAX_OBJECT_COUNT + 1,
    });
    expect(r.surface).toBe("server");
  });
});
