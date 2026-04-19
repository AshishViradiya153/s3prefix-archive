import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CheckpointState, CheckpointStore } from "../src/checkpoint.js";
import type { ArchiveEntryEndContext, ArchiveFormat } from "../src/types.js";
import { MemoryStorageProvider } from "../src/memory-storage-provider.js";
import { pumpArchiveToWritable } from "../src/pump-archive.js";
import { createBenchmarkDiscardWritable } from "../src/benchmark-sink.js";

function etagFor(body: Buffer): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

/** In-memory store used across pump-dedupe and checkpoint-resume tests — serializable clone like real persistence. */
function createMemoryCheckpointStore(): {
  ref: { current: CheckpointState | null };
  store: CheckpointStore;
} {
  const ref: { current: CheckpointState | null } = { current: null };
  const store: CheckpointStore = {
    load: async () => ref.current,
    save: async (_jobId, s) => {
      ref.current = JSON.parse(JSON.stringify(s)) as CheckpointState;
    },
  };
  return { ref, store };
}

function isAbortLikeError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError") return true;
  if ("code" in e && (e as NodeJS.ErrnoException).code === "ABORT_ERR")
    return true;
  return /aborted/i.test(e.message);
}

/**
 * Contract under test:
 * 1. `ArchiveCheckpointCoordinator.recordSuccessfulInclude` awaits `store.save` before
 *    `onArchiveEntryEnd` runs (see archive-object-processor), so aborting from `onArchiveEntryEnd`
 *    after the first **included** object implies the checkpoint row is durable.
 * 2. Resume lists all keys (lexicographic under prefix) but skips completed keys with
 *    `skipReason: 'checkpoint'` without re-fetching their bodies.
 *
 * **tar** and **zip** (concurrency 1) both exercise the same checkpoint path; zip adds the
 * yazl encoder + p-limit wiring used in most production runs.
 */
describe("checkpoint + abort + resume (crash simulation)", () => {
  const bodyA = Buffer.from("aaa", "utf8");
  const bodyB = Buffer.from("bbbb", "utf8");
  const bodyC = Buffer.from("ccccc", "utf8");
  const totalBytes = bodyA.length + bodyB.length + bodyC.length;

  const keys = ["pre/a.txt", "pre/b.txt", "pre/c.txt"] as const;

  function makeProvider(): MemoryStorageProvider {
    return new MemoryStorageProvider(
      new Map([
        [keys[0], { body: bodyA, etag: etagFor(bodyA) }],
        [keys[1], { body: bodyB, etag: etagFor(bodyB) }],
        [keys[2], { body: bodyC, etag: etagFor(bodyC) }],
      ]),
    );
  }

  it("baseline: single run archives all three objects without checkpoint", async () => {
    const { stats } = await pumpArchiveToWritable(
      createBenchmarkDiscardWritable(),
      {
        source: "s3://anybucket/pre/",
        format: "tar",
        concurrency: 1,
        storageProvider: makeProvider(),
      },
    );
    expect(stats.objectsIncluded).toBe(3);
    expect(stats.bytesRead).toBe(totalBytes);
  });

  it.each([
    { format: "tar" as const, label: "tar" },
    { format: "zip" as const, label: "zip (concurrency 1)" },
  ])(
    "persists checkpoint before abort; resume skips completed keys ($label)",
    async ({ format }: { format: ArchiveFormat; label: string }) => {
      const { ref, store } = createMemoryCheckpointStore();
      const provider = makeProvider();
      const jobId = `crash-sim-${format}`;

      const ac = new AbortController();
      let includedBeforeAbort = 0;

      await expect(
        pumpArchiveToWritable(createBenchmarkDiscardWritable(), {
          source: "s3://anybucket/pre/",
          format,
          concurrency: 1,
          storageProvider: provider,
          checkpoint: { jobId, store },
          signal: ac.signal,
          onArchiveEntryEnd: (c: ArchiveEntryEndContext) => {
            if (c.outcome === "included") {
              includedBeforeAbort += 1;
              if (includedBeforeAbort === 1) {
                ac.abort();
              }
            }
          },
        }),
      ).rejects.toSatisfy(isAbortLikeError);

      const st = ref.current;
      expect(st).not.toBeNull();
      expect(st!.version).toBe(1);
      expect(st!.bucket).toBe("anybucket");
      expect(st!.prefix).toBe("pre/");
      expect(st!.format).toBe(format);
      expect(st!.completedKeys).toEqual([keys[0]]);
      expect(includedBeforeAbort).toBe(1);

      const ends: ArchiveEntryEndContext[] = [];
      const { stats } = await pumpArchiveToWritable(
        createBenchmarkDiscardWritable(),
        {
          source: "s3://anybucket/pre/",
          format,
          concurrency: 1,
          storageProvider: provider,
          checkpoint: { jobId, store },
          onArchiveEntryEnd: (c) => ends.push({ ...c }),
        },
      );

      const checkpointSkips = ends.filter((e) => e.skipReason === "checkpoint");
      expect(checkpointSkips).toHaveLength(1);
      expect(checkpointSkips[0]!.meta.key).toBe(keys[0]);

      const included = ends.filter((e) => e.outcome === "included");
      expect(included.map((e) => e.meta.key).sort()).toEqual([
        keys[1],
        keys[2],
      ]);

      expect(stats.objectsIncluded).toBe(2);
      expect(stats.objectsSkipped).toBe(1);
      expect(stats.bytesRead).toBe(bodyB.length + bodyC.length);
    },
  );
});
