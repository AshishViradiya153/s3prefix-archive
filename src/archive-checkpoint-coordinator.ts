import type { ArchiveFormat } from "./types.js";
import type { CheckpointState, CheckpointStore } from "./checkpoint.js";
import { S3ArchiveError } from "./errors.js";
import {
  assertAdditionalListSourcesMatchCheckpoint,
  canonicalizeAdditionalListSources,
} from "./archive-sources.js";

export interface ArchiveCheckpointOpenScope {
  bucket: string;
  prefix: string;
  format: ArchiveFormat;
  multiRoot: boolean;
  /** Primary options field; required when `multiRoot` is true for new checkpoint rows. */
  additionalListSources?: readonly string[] | undefined;
}

export interface ArchiveCheckpointDedupeSeed {
  wantsPathDedupe: boolean;
  wantsContentDedupe: boolean;
  doneEntryPaths: Set<string> | null;
  doneContentFp: Set<string> | null;
}

/**
 * Owns checkpoint load, additional-root validation, dedupe-resume hydration, and per-object persistence.
 */
export class ArchiveCheckpointCoordinator {
  readonly completed: Set<string>;

  private constructor(
    readonly jobId: string,
    private readonly store: CheckpointStore,
    readonly state: CheckpointState,
  ) {
    this.completed = new Set(state.completedKeys);
  }

  static async open(
    checkpoint: { jobId: string; store: CheckpointStore },
    scope: ArchiveCheckpointOpenScope,
    dedupe: ArchiveCheckpointDedupeSeed,
  ): Promise<ArchiveCheckpointCoordinator> {
    const state =
      (await checkpoint.store.load(checkpoint.jobId)) ??
      ({
        version: 1,
        bucket: scope.bucket,
        prefix: scope.prefix,
        format: scope.format,
        completedKeys: [],
        additionalListSources: scope.multiRoot
          ? canonicalizeAdditionalListSources(scope.additionalListSources!, {
              bucket: scope.bucket,
              prefix: scope.prefix,
            })
          : undefined,
      } satisfies CheckpointState);

    assertAdditionalListSourcesMatchCheckpoint(
      state.additionalListSources,
      scope.additionalListSources,
      { bucket: scope.bucket, prefix: scope.prefix },
      checkpoint.jobId,
    );

    const coordinator = new ArchiveCheckpointCoordinator(
      checkpoint.jobId,
      checkpoint.store,
      state,
    );

    if (
      (dedupe.wantsPathDedupe || dedupe.wantsContentDedupe) &&
      state.completedKeys.length > 0
    ) {
      const entries = state.resumeDedupe?.entries;
      if (!entries || entries.length !== state.completedKeys.length) {
        throw new S3ArchiveError(
          `Checkpoint "${checkpoint.jobId}" cannot resume with path or content dedupe: missing or mismatched resumeDedupe metadata (clear the checkpoint or use a new jobId).`,
          "CHECKPOINT_DEDUPE_RESUME",
        );
      }
      for (const e of entries) {
        if (dedupe.wantsPathDedupe) dedupe.doneEntryPaths!.add(e.entryName);
        if (dedupe.wantsContentDedupe && e.contentFp)
          dedupe.doneContentFp!.add(e.contentFp);
      }
    }

    return coordinator;
  }

  async recordSuccessfulInclude(
    objectKey: string,
    entryName: string,
    contentFp: string | undefined,
  ): Promise<void> {
    this.state.completedKeys.push(objectKey);
    this.completed.add(objectKey);
    const rd = (this.state.resumeDedupe ??= { entries: [] });
    rd.entries.push({
      entryName,
      ...(contentFp ? { contentFp } : {}),
    });
    await this.store.save(this.jobId, this.state);
  }
}
