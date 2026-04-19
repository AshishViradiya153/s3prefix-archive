import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

describe("pumpArchiveToWritable concurrency option", () => {
  it("rejects concurrency > 1 for tar", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      pumpArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "tar",
        concurrency: 4,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("rejects dedupe with ZIP concurrency > 1", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      pumpArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "zip",
        concurrency: 4,
        dedupeArchivePaths: true,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });

  it("rejects objectPriority for tar", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      pumpArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "tar",
        objectPriority: (m) => -m.size,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPTION" });
  });
});
