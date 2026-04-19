import { describe, expect, it } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  SLOW_GET_OBJECT_MIN_BYTES,
  wrapReadableWithSlowGetObjectMonitor,
} from "../src/get-object-stream-telemetry.js";
import type { ObjectMeta } from "../src/types.js";

const meta: ObjectMeta = { key: "k", size: 200_000 };

describe("wrapReadableWithSlowGetObjectMonitor", () => {
  it("invokes onSlow when throughput stays below threshold after min bytes and time", async () => {
    const slowEvents: { bps: number }[] = [];
    const pt = new PassThrough();
    const monitored = wrapReadableWithSlowGetObjectMonitor(pt, {
      thresholdBytesPerSecond: 1_000_000,
      onSlow: (info) => slowEvents.push({ bps: info.estimatedBytesPerSecond }),
      meta,
      entryName: "a.txt",
      minBytes: 1000,
      minElapsedMs: 50,
    });

    const drain = (async () => {
      for await (const _ of monitored) {
        /* consume */
      }
    })();

    const chunk = Buffer.alloc(500);
    let sent = 0;
    while (sent < 8000) {
      pt.write(chunk);
      sent += chunk.length;
      await delay(30);
    }
    pt.end();
    await drain;

    expect(slowEvents.length).toBe(1);
    expect(slowEvents[0]!.bps).toBeLessThan(1_000_000);
  });

  it("does not fire when data arrives quickly", async () => {
    const slowEvents: unknown[] = [];
    const buf = Buffer.alloc(SLOW_GET_OBJECT_MIN_BYTES + 1000);
    const monitored = wrapReadableWithSlowGetObjectMonitor(Readable.from(buf), {
      thresholdBytesPerSecond: 1,
      onSlow: () => slowEvents.push(true),
      meta,
      entryName: "b.bin",
      minBytes: 100,
      minElapsedMs: 1,
    });
    const chunks: Buffer[] = [];
    for await (const c of monitored) {
      chunks.push(c as Buffer);
    }
    expect(Buffer.concat(chunks).length).toBe(buf.length);
    expect(slowEvents).toHaveLength(0);
  });
});
