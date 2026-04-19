import { describe, expect, it } from "vitest";
import {
  ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM,
  ARCHIVE_TELEMETRY_EVENT_S3_RETRY,
  ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY,
  createArchiveTelemetryBridge,
} from "../src/archive-telemetry-bridge.js";
import type {
  ArchiveS3RetryContext,
  ArchiveSlowGetObjectStreamInfo,
} from "../src/types.js";

const baseCtx: ArchiveS3RetryContext = {
  operation: "getObject",
  attemptNumber: 1,
  retriesLeft: 2,
  kind: "throttle",
  error: new Error("429"),
  delayMs: 100,
  bucket: "b",
  key: "k",
};

describe("createArchiveTelemetryBridge", () => {
  it("invokes user retry handlers before emitting s3-retry and s3-throttle-retry", () => {
    const bridge = createArchiveTelemetryBridge();
    const order: string[] = [];
    bridge.emitter.on(ARCHIVE_TELEMETRY_EVENT_S3_RETRY, () =>
      order.push("emit-retry"),
    );
    bridge.emitter.on(ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY, () =>
      order.push("emit-throttle"),
    );
    const o = bridge.augmentArchivePumpOptions({
      source: "s3://b/p/",
      retry: {
        onRetry: () => order.push("user-retry"),
        onS3ThrottleRetry: () => order.push("user-throttle"),
      },
    });
    o.retry!.onRetry!(baseCtx);
    o.retry!.onS3ThrottleRetry!(baseCtx);
    expect(order).toEqual([
      "user-retry",
      "emit-retry",
      "user-throttle",
      "emit-throttle",
    ]);
  });

  it("forwards slow-get-object-stream when slow options are set", () => {
    const bridge = createArchiveTelemetryBridge();
    const payloads: ArchiveSlowGetObjectStreamInfo[] = [];
    bridge.emitter.on(ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM, (p) => {
      payloads.push(p);
    });
    const info: ArchiveSlowGetObjectStreamInfo = {
      meta: { key: "a", size: 10 },
      entryName: "a",
      bytesReadSoFar: 100,
      elapsedMs: 500,
      estimatedBytesPerSecond: 200,
    };
    const o = bridge.augmentArchivePumpOptions({
      source: "s3://b/p/",
      slowGetObjectReadBytesPerSecondThreshold: 1_000_000,
      onSlowGetObjectStream: () => {},
    });
    o.onSlowGetObjectStream!(info);
    expect(payloads).toEqual([info]);
  });
});
