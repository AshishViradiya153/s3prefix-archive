import { describe, expect, it } from "vitest";
import {
  classifyArchiveWorkloadSize,
  DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES,
  DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES,
} from "../src/archive-workload-profile.js";

describe("classifyArchiveWorkloadSize", () => {
  it("default thresholds are ordered and binary KiB/MiB", () => {
    expect(DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES).toBe(256 * 1024);
    expect(DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES).toBe(16 * 1024 * 1024);
    expect(DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES).toBeLessThan(
      DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES,
    );
  });

  it("boundary: mean exactly at small threshold is balanced, not many-small", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 1,
      bytesRead: DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES,
    });
    expect(r.profile).toBe("balanced");
  });

  it("boundary: mean one byte below small threshold is many-small", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 1,
      bytesRead: DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES - 1,
    });
    expect(r.profile).toBe("many-small");
  });

  it("boundary: mean exactly at large threshold is balanced, not few-large", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 1,
      bytesRead: DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES,
    });
    expect(r.profile).toBe("balanced");
  });

  it("boundary: mean one byte above large threshold is few-large", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 1,
      bytesRead: DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES + 1,
    });
    expect(r.profile).toBe("few-large");
  });

  it("returns empty when no objects included", () => {
    expect(
      classifyArchiveWorkloadSize({ objectsIncluded: 0, bytesRead: 0 }),
    ).toEqual({
      profile: "empty",
      meanBytesPerIncludedObject: 0,
    });
  });

  it("classifies many-small below default small threshold", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 10,
      bytesRead: 10 * (128 * 1024),
    });
    expect(r.profile).toBe("many-small");
    expect(r.meanBytesPerIncludedObject).toBe(128 * 1024);
  });

  it("classifies few-large above default large threshold", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 2,
      bytesRead: 2 * (32 * 1024 * 1024),
    });
    expect(r.profile).toBe("few-large");
    expect(r.meanBytesPerIncludedObject).toBe(32 * 1024 * 1024);
  });

  it("classifies balanced between thresholds", () => {
    const r = classifyArchiveWorkloadSize({
      objectsIncluded: 4,
      bytesRead: 4 * (1024 * 1024),
    });
    expect(r.profile).toBe("balanced");
  });

  it("respects custom thresholds", () => {
    expect(
      classifyArchiveWorkloadSize({
        objectsIncluded: 1,
        bytesRead: 500,
        smallAvgBytes: 1000,
        largeAvgBytes: 2000,
      }).profile,
    ).toBe("many-small");
  });

  it("rejects invalid threshold order", () => {
    expect(() =>
      classifyArchiveWorkloadSize({
        objectsIncluded: 1,
        bytesRead: 1,
        smallAvgBytes: 100,
        largeAvgBytes: 100,
      }),
    ).toThrow(TypeError);
  });

  it("rejects negative bytesRead", () => {
    expect(() =>
      classifyArchiveWorkloadSize({ objectsIncluded: 1, bytesRead: -1 }),
    ).toThrow(TypeError);
  });

  it("rejects negative objectsIncluded", () => {
    expect(() =>
      classifyArchiveWorkloadSize({ objectsIncluded: -1, bytesRead: 0 }),
    ).toThrow(TypeError);
  });
});
