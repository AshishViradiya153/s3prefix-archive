import { describe, expect, it } from "vitest";
import { createArchiveThroughputSampler } from "../src/archive-throughput.js";

describe("createArchiveThroughputSampler", () => {
  it("computes rolling read rate over the window", () => {
    const s = createArchiveThroughputSampler(10_000);
    s.record(0, 0, 0);
    s.record(1000, 1000, 0);
    const snap = s.snapshot(1000);
    expect(snap.rollingBytesReadPerSecond).toBeCloseTo(1000, 0);
    expect(snap.rollingBytesWrittenPerSecond).toBe(0);
  });

  it("returns zero rolling when fewer than two samples", () => {
    const s = createArchiveThroughputSampler(5000);
    s.record(100, 50, 10);
    expect(s.snapshot(100).rollingBytesReadPerSecond).toBe(0);
  });
});
