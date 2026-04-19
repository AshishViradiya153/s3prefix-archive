import { describe, expect, it } from "vitest";
import type { CheckpointState, CheckpointStore } from "../src/checkpoint.js";
import { ArchiveCheckpointCoordinator } from "../src/archive-checkpoint-coordinator.js";

describe("ArchiveCheckpointCoordinator", () => {
  it("recordSuccessfulInclude keeps completed set aligned with completedKeys", async () => {
    const state: CheckpointState = {
      version: 1,
      bucket: "b",
      prefix: "p/",
      format: "zip",
      completedKeys: [],
    };
    const store: CheckpointStore = {
      load: async () => state,
      save: async () => {},
    };

    const coord = await ArchiveCheckpointCoordinator.open(
      { jobId: "j", store },
      { bucket: "b", prefix: "p/", format: "zip", multiRoot: false },
      {
        wantsPathDedupe: false,
        wantsContentDedupe: false,
        doneEntryPaths: null,
        doneContentFp: null,
      },
    );

    await coord.recordSuccessfulInclude("k1", "a.txt", undefined);
    expect(coord.state.completedKeys).toEqual(["k1"]);
    expect(coord.completed.has("k1")).toBe(true);
  });
});
