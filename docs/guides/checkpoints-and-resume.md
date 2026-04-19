# Guide: checkpoints & resume

## Model

Checkpoints record **which object keys** have already been written successfully for a logical job (`jobId`). On restart, those keys are skipped (`skipReason: 'checkpoint'`) so you do not duplicate work.

You must keep **`source`**, **`format`**, **`checkpoint.jobId`**, and **`checkpoint.store`** consistent with the original run. For multi-root archives, **`additionalListSources`** must match exactly what was persisted; the library exposes **`assertAdditionalListSourcesMatchCheckpoint`** and related helpers (see [archive-sources.ts](../../src/archive-sources.ts)).

## Stores

| Store                         | When to use                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`FileCheckpointStore`**     | Simple filesystem persistence (`.checkpoints/` directory, etc.).                                                                                                   |
| **`RedisCheckpointStore`**    | Shared state for horizontally scaled workers; optional TTL. Adapter must implement `get` / `set` and optionally `expire` for TTL.                                  |
| **`SqlTableCheckpointStore`** | Postgres / MySQL / SQLite via a tiny **`SqlCheckpointClient`** you implement (see [examples/sql-checkpoint-adapter.ts](../../examples/sql-checkpoint-adapter.ts)). |

## APIs

- **First run with checkpoint:** pass **`checkpoint: { jobId, store }`** to **`downloadFolderToFile`** / **`pumpArchiveToWritable`** (`s3prefix-archive`) or **`runFolderArchiveToS3`** (`s3prefix-archive/platform`) — same semantics as a run without resume, but state is persisted.
- **Resume:** use **`resumeFolderArchiveToFile`** / **`resumeFolderArchiveToWritable`** — they require existing state or fail with **`CHECKPOINT_NOT_FOUND`**.

Dedupe modes (`dedupeArchivePaths`, `dedupeContentByEtag`) require compatible checkpoint metadata; mismatches raise **`CHECKPOINT_DEDUPE_RESUME`**. See engineering notes in the root README.

## BullMQ

Jobs may carry **`checkpointJobId`**; the processor can **`resolveCheckpointStore`** per job. Payload remains JSON-safe—hooks and non-serializable options are injected on the worker.
