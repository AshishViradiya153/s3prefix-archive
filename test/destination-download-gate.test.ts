import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createDestinationDownloadGate } from "../src/destination-download-gate.js";

describe("createDestinationDownloadGate", () => {
  it("resolves immediately when writableNeedDrain is false", async () => {
    const dest = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const gate = createDestinationDownloadGate(dest);
    await gate.beforeStartingObjectDownload();
    expect(gate.getDrainWaitCount()).toBe(0);
  });

  it("waits for drain when buffer is over highWaterMark", async () => {
    const dest = new Writable({
      highWaterMark: 128,
      write(_chunk, _enc, cb) {
        queueMicrotask(cb);
      },
    });
    let writes = 0;
    while (dest.write(Buffer.alloc(32)) && writes++ < 100) {
      // fill internal buffer until write returns false
    }
    expect(dest.writableNeedDrain).toBe(true);

    const gate = createDestinationDownloadGate(dest);
    const done = gate.beforeStartingObjectDownload();
    await done;
    expect(gate.getDrainWaitCount()).toBeGreaterThanOrEqual(1);
    expect(dest.writableNeedDrain).toBe(false);
  });
});
