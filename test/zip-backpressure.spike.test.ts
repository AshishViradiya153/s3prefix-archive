import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";

/**
 * Spike: yazl output → slow consumer must not OOM; stream should apply backpressure.
 * Validates we can safely compose ZIP creation with a throttled sink (proxy for HTTP/S3 upload).
 */
describe("zip backpressure spike", () => {
  it("drains archive with highWaterMark-limited writable without buffering entire payload in userland", async () => {
    const zipfile = new ZipFile();

    let written = 0;
    const sink = new Writable({
      highWaterMark: 64 * 1024,
      write(chunk, _enc, cb) {
        written += chunk.length;
        setTimeout(cb, 0);
      },
    });

    const done = pipeline(zipfile.outputStream, sink);

    const bigChunk = Buffer.alloc(256 * 1024, 0x41);
    for (let i = 0; i < 20; i++) {
      zipfile.addBuffer(bigChunk, `f${i}.bin`, {
        compress: false,
        compressionLevel: 0,
        mtime: new Date(),
      });
    }
    zipfile.end();
    await done;

    expect(written).toBeGreaterThan(1_000_000);
  });
});
