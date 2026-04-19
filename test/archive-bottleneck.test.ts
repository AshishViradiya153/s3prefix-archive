import { describe, expect, it } from "vitest";
import {
  classifyArchiveBottleneck,
  computeArchiveStageOccupancyShares,
} from "../src/archive-bottleneck.js";

describe("classifyArchiveBottleneck", () => {
  it("returns even when all stages are zero", () => {
    expect(
      classifyArchiveBottleneck({
        listMs: 0,
        downloadMs: 0,
        archiveWriteMs: 0,
      }),
    ).toBe("even");
  });

  it("prefers download when it dominates", () => {
    expect(
      classifyArchiveBottleneck({
        listMs: 1,
        downloadMs: 10,
        archiveWriteMs: 2,
      }),
    ).toBe("download");
  });

  it("prefers list over archive-write when download does not dominate", () => {
    expect(
      classifyArchiveBottleneck({
        listMs: 5,
        downloadMs: 1,
        archiveWriteMs: 3,
      }),
    ).toBe("list");
  });

  it("prefers archive-write when it is largest and download does not tie list", () => {
    expect(
      classifyArchiveBottleneck({
        listMs: 1,
        downloadMs: 1,
        archiveWriteMs: 9,
      }),
    ).toBe("archive-write");
  });

  it("returns even when idle wall dominates work stages", () => {
    expect(
      classifyArchiveBottleneck({
        listMs: 2,
        downloadMs: 1,
        archiveWriteMs: 1,
        stageIdleMs: 50,
      }),
    ).toBe("even");
  });
});

describe("computeArchiveStageOccupancyShares", () => {
  it("returns undefined when total time is zero", () => {
    expect(
      computeArchiveStageOccupancyShares({
        listMs: 0,
        downloadMs: 0,
        archiveWriteMs: 0,
      }),
    ).toBeUndefined();
  });

  it("normalizes to fractions that sum to 1", () => {
    const s = computeArchiveStageOccupancyShares({
      listMs: 10,
      downloadMs: 30,
      archiveWriteMs: 50,
      stageIdleMs: 10,
    })!;
    expect(s.list).toBeCloseTo(0.1, 10);
    expect(s.download).toBeCloseTo(0.3, 10);
    expect(s.archiveWrite).toBeCloseTo(0.5, 10);
    expect(s.idle).toBeCloseTo(0.1, 10);
    expect(s.list + s.download + s.archiveWrite + s.idle).toBeCloseTo(1, 12);
  });
});
