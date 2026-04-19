import { describe, expect, it } from "vitest";
import {
  BYTES_PER_GIB,
  estimateDataTransferOutCostUsd,
  estimateS3DataTransferOutCostUsdFromArchiveBytesRead,
  usdPerGibToUsdPerByte,
} from "../src/s3-data-transfer-cost.js";

describe("usdPerGibToUsdPerByte", () => {
  it("divides by 1024^3", () => {
    expect(usdPerGibToUsdPerByte(1)).toBeCloseTo(1 / BYTES_PER_GIB, 20);
  });
});

describe("estimateDataTransferOutCostUsd", () => {
  const twoGib = 2 * BYTES_PER_GIB;
  const fiveGib = 5 * BYTES_PER_GIB;

  const simpleLinear = [
    { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 1e-9 },
  ] as const;

  it("returns 0 for non-positive bytes", () => {
    expect(estimateDataTransferOutCostUsd(0, simpleLinear)).toBe(0);
    expect(estimateDataTransferOutCostUsd(-1, simpleLinear)).toBe(0);
  });

  it("applies a single infinite band linearly", () => {
    expect(estimateDataTransferOutCostUsd(1000, simpleLinear)).toBeCloseTo(
      1000 * 1e-9,
      10,
    );
  });

  it("splits cost across cumulative tiers (two rates)", () => {
    const bands = [
      { untilBytesExclusive: twoGib, usdPerByte: 0.01 / BYTES_PER_GIB },
      {
        untilBytesExclusive: Number.POSITIVE_INFINITY,
        usdPerByte: 0.005 / BYTES_PER_GIB,
      },
    ] as const;
    // 2 GiB at 0.01/GiB + 3 GiB at 0.005/GiB
    const cost = estimateDataTransferOutCostUsd(fiveGib, bands);
    expect(cost).toBeCloseTo(0.01 * 2 + 0.005 * 3, 10);
  });

  it("accepts unsorted bands and sorts by cumulative bound", () => {
    const bands = [
      {
        untilBytesExclusive: Number.POSITIVE_INFINITY,
        usdPerByte: 0.005 / BYTES_PER_GIB,
      },
      { untilBytesExclusive: twoGib, usdPerByte: 0.01 / BYTES_PER_GIB },
    ] as const;
    expect(estimateDataTransferOutCostUsd(fiveGib, bands)).toBeCloseTo(
      0.01 * 2 + 0.005 * 3,
      10,
    );
  });

  it("rejects empty bands", () => {
    expect(() => estimateDataTransferOutCostUsd(100, [])).toThrow(TypeError);
  });

  it("rejects last band without Infinity", () => {
    expect(() =>
      estimateDataTransferOutCostUsd(100, [
        { untilBytesExclusive: 1000, usdPerByte: 1e-9 },
      ]),
    ).toThrow(TypeError);
  });

  it("rejects non-increasing bounds", () => {
    expect(() =>
      estimateDataTransferOutCostUsd(100, [
        { untilBytesExclusive: 500, usdPerByte: 1e-9 },
        { untilBytesExclusive: 500, usdPerByte: 2e-9 },
        { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 3e-9 },
      ]),
    ).toThrow(TypeError);
  });
});

describe("estimateS3DataTransferOutCostUsdFromArchiveBytesRead", () => {
  it("uses stats.bytesRead", () => {
    const bands = [
      { untilBytesExclusive: Number.POSITIVE_INFINITY, usdPerByte: 2e-9 },
    ] as const;
    expect(
      estimateS3DataTransferOutCostUsdFromArchiveBytesRead(
        { bytesRead: 500 },
        bands,
      ),
    ).toBeCloseTo(500 * 2e-9, 12);
  });
});
