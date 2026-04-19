import { describe, expect, it } from "vitest";
import type {
  CreateFolderArchiveStreamOptions,
  StorageProvider,
} from "../src/types.js";
import {
  assertCrossCutArchivePumpOptions,
  assertMaxInFlightReadBytesOption,
} from "../src/validate-archive-pump-options.js";
describe("assertMaxInFlightReadBytesOption", () => {
  it("accepts undefined", () => {
    expect(() => assertMaxInFlightReadBytesOption(undefined)).not.toThrow();
  });

  it("rejects non-finite or < 1", () => {
    expect(() => assertMaxInFlightReadBytesOption(0)).toThrow();
    expect(() => assertMaxInFlightReadBytesOption(Number.NaN)).toThrow();
  });
});

describe("assertCrossCutArchivePumpOptions", () => {
  it("rejects adaptive zip flags together", () => {
    const options: CreateFolderArchiveStreamOptions = {
      source: "s3://b/p/",
      experimentalAdaptiveZipConcurrency: true,
      experimentalThroughputAdaptiveZipConcurrency: {
        targetReadBytesPerSecond: 1_000_000,
      },
      statsThroughputRollingWindowMs: 1000,
    };
    expect(() =>
      assertCrossCutArchivePumpOptions({
        options,
        format: "zip",
        zipConcurrency: 2,
        multiRoot: false,
      }),
    ).toThrow();
  });

  it("rejects storageProvider with multiRoot", () => {
    const stubProvider = {} as StorageProvider;
    const options: CreateFolderArchiveStreamOptions = {
      source: "s3://b/p/",
      storageProvider: stubProvider,
    };
    expect(() =>
      assertCrossCutArchivePumpOptions({
        options,
        format: "zip",
        zipConcurrency: 2,
        multiRoot: true,
      }),
    ).toThrow();
  });

  it("rejects slow stream threshold without callback", () => {
    const options: CreateFolderArchiveStreamOptions = {
      source: "s3://b/p/",
      slowGetObjectReadBytesPerSecondThreshold: 100,
    };
    expect(() =>
      assertCrossCutArchivePumpOptions({
        options,
        format: "zip",
        zipConcurrency: 2,
        multiRoot: false,
      }),
    ).toThrow();
  });

  it("rejects getObjectReadBufferHighWaterMark below minimum", () => {
    const options: CreateFolderArchiveStreamOptions = {
      source: "s3://b/p/",
      getObjectReadBufferHighWaterMark: 512,
    };
    expect(() =>
      assertCrossCutArchivePumpOptions({
        options,
        format: "zip",
        zipConcurrency: 2,
        multiRoot: false,
      }),
    ).toThrow();
  });
});
