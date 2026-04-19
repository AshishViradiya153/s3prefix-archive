import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { resumeFolderArchiveToWritable } from "../src/resume-download.js";
import type { CheckpointState, CheckpointStore } from "../src/checkpoint.js";
import { canonicalizeAdditionalListSources } from "../src/archive-sources.js";

function storeWith(state: CheckpointState | null): CheckpointStore {
  return {
    load: async () => state,
    save: async () => {
      /* noop */
    },
  };
}

const baseState: CheckpointState = {
  version: 1,
  bucket: "b",
  prefix: "p/",
  format: "zip",
  completedKeys: ["k1"],
};

describe("resumeFolderArchiveToWritable", () => {
  it("throws MISSING_CHECKPOINT without checkpoint", async () => {
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    await expect(
      resumeFolderArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "zip",
      }),
    ).rejects.toMatchObject({ code: "MISSING_CHECKPOINT" });
  });

  it("throws CHECKPOINT_NOT_FOUND when store has no state", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      resumeFolderArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "zip",
        checkpoint: { jobId: "j1", store: storeWith(null) },
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_NOT_FOUND" });
  });

  it("throws CHECKPOINT_MISMATCH when source does not match saved scope", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      resumeFolderArchiveToWritable(sink, {
        source: "s3://other/p/",
        format: "zip",
        checkpoint: { jobId: "j1", store: storeWith(baseState) },
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });
  });

  it("throws CHECKPOINT_MISMATCH when additionalListSources differ", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const withExtras: CheckpointState = {
      ...baseState,
      additionalListSources: canonicalizeAdditionalListSources(["s3://x/y/"], {
        bucket: "b",
        prefix: "p/",
      }),
    };
    await expect(
      resumeFolderArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "zip",
        checkpoint: { jobId: "j1", store: storeWith(withExtras) },
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });
  });

  it("throws CHECKPOINT_MISMATCH when format differs", async () => {
    const sink = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    await expect(
      resumeFolderArchiveToWritable(sink, {
        source: "s3://b/p/",
        format: "tar",
        checkpoint: { jobId: "j1", store: storeWith(baseState) },
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });
  });
});
