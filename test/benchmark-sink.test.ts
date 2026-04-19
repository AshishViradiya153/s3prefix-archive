import { describe, expect, it } from "vitest";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

describe("createBenchmarkDiscardWritable", () => {
  it("accepts streamed data without retaining it", async () => {
    const sink = createBenchmarkDiscardWritable();
    await pipeline(Readable.from([Buffer.from("a"), Buffer.from("bc")]), sink);
    expect(sink.writableEnded).toBe(true);
  });
});
