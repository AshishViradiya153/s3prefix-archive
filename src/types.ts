import type { Readable } from "node:stream";
import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import type { Logger } from "pino";
import type { Registry } from "prom-client";
import type { CheckpointStore } from "./checkpoint.js";

/** Object metadata from listing (and optional head). */
export interface ObjectMeta {
  key: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  /**
   * When set, `GetObject` reads this bucket (cross-bucket / multi-root archives).
   * Primary-list objects omit this (primary {@link CreateFolderArchiveStreamOptions.source} bucket is used).
   */
  bucket?: string;
  /**
   * Prefix stripped by {@link defaultEntryName} for this object (defaults to the primary source prefix).
   */
  listPrefix?: string;
}

export type ArchiveFormat = "zip" | "tar" | "tar.gz";

export type FailureMode = "fail-fast" | "best-effort";

export interface ArchiveProgress {
  objectsListed: number;
  objectsIncluded: number;
  objectsSkipped: number;
  bytesRead: number;
  bytesWritten: number;
  currentKey?: string;
}

export interface ArchiveStageStats {
  /**
   * Wall time attributed to **listing** (awaiting the next object from `ListObjectsV2` / prepared NDJSON /
   * merged roots), via occupancy when work overlaps parallel ZIP (see `ArchiveStageOccupancyMeter`).
   */
  listMs: number;
  /** Wall time attributed to **GetObject** (including ZIP limiter queue wait), occupancy-partitioned. */
  downloadMs: number;
  /** Wall time attributed to **archive append** (ZIP yazl / tar entry), occupancy-partitioned. */
  archiveWriteMs: number;
  /**
   * Wall time with **no** list/download/archive ref active (gaps between micro-tasks; manifest append
   * after main iteration is often here). Sum of stage fields + this ≈ {@link ArchiveStats.wallDurationMs}.
   */
  stageIdleMs?: number;
  retries: number;
}

/** Heuristic dominant stage for a completed archive run (see {@link classifyArchiveBottleneck}). */
export type ArchiveBottleneck = "list" | "download" | "archive-write" | "even";

/**
 * Partition of occupancy time into fractions that sum to **1** (see {@link computeArchiveStageOccupancyShares}).
 */
export interface ArchiveStageOccupancyShares {
  list: number;
  download: number;
  archiveWrite: number;
  idle: number;
}

/**
 * Trailing-window **read vs write** pace when {@link CreateFolderArchiveStreamOptions.statsThroughputRollingWindowMs}
 * is set (see {@link classifyThroughputReadWritePace}).
 */
export type ThroughputReadWritePace =
  | "read-faster"
  | "write-faster"
  | "balanced";

export interface ArchiveStats extends ArchiveProgress, ArchiveStageStats {
  /** Same classification as `dominant` on {@link ArchiveExplainStep} `archive.summary`. */
  bottleneck: ArchiveBottleneck;
  /**
   * Fraction of total occupancy time (list + download + archive-write + idle) per stage.
   * Omitted when all stage ms are zero (empty run).
   */
  stageOccupancyShare?: ArchiveStageOccupancyShares;
  /** Wall time from pump start to completion (ms). */
  wallDurationMs?: number;
  /** `bytesRead / (wallDurationMs/1000)` when `wallDurationMs` > 0. */
  averageBytesReadPerSecond?: number;
  /** `bytesWritten / (wallDurationMs/1000)` when `wallDurationMs` > 0. */
  averageBytesWrittenPerSecond?: number;
  /**
   * When {@link CreateFolderArchiveStreamOptions.statsThroughputRollingWindowMs} is set, the window
   * width used for {@link rollingBytesReadPerSecond} / {@link rollingBytesWrittenPerSecond}.
   */
  statsThroughputRollingWindowMs?: number;
  /** Trailing-window read rate from progress samples (bytes/s). */
  rollingBytesReadPerSecond?: number;
  /** Trailing-window write rate from progress samples (bytes/s). */
  rollingBytesWrittenPerSecond?: number;
  /**
   * When rolling throughput is enabled: `rollingBytesReadPerSecond - rollingBytesWrittenPerSecond`
   * at end-of-run snapshot (signed; positive ⇒ network read faster than bytes accepted by the archive encoder).
   */
  throughputRollingReadMinusWriteBytesPerSecond?: number;
  /** When rolling throughput is enabled: coarse comparison of read vs write pace (see {@link ThroughputReadWritePace}). */
  throughputRollingPace?: ThroughputReadWritePace;
  /**
   * Initial ZIP GetObject cap when throttle-based
   * {@link CreateFolderArchiveStreamOptions.experimentalAdaptiveZipConcurrency} or throughput-based
   * {@link CreateFolderArchiveStreamOptions.experimentalThroughputAdaptiveZipConcurrency} was enabled.
   */
  adaptiveZipConcurrencyInitialCap?: number;
  /** GetObject cap at run end (after any recovery or throughput hysteresis shifts). */
  adaptiveZipConcurrencyFinalCap?: number;
  /** Lowest GetObject cap observed during the run. */
  adaptiveZipConcurrencyMinCap?: number;
  /** Successful `ListObjectsV2` `client.send` calls (pages). Omitted when not using {@link S3StorageProvider}. */
  s3ListObjectsV2Requests?: number;
  /** Successful `GetObject` `client.send` calls (one per opened object body). Omitted when not using {@link S3StorageProvider}. */
  s3GetObjectRequests?: number;
  /**
   * Dimensionless **S3 API workload** score (`computeS3WorkloadUnits` in `./s3-workload-units.js`):
   * linear in list/get request counts and aggregate retries. Not a currency—map to USD with your pricing.
   */
  s3WorkloadUnits?: number;
  /** Retries after failed `ListObjectsV2` attempts (subset of {@link ArchiveStageStats.retries}). Omitted when not using {@link S3StorageProvider}. */
  s3RetriesListObjectsV2?: number;
  /** Retries after failed `GetObject` attempts. Omitted when not using {@link S3StorageProvider}. */
  s3RetriesGetObject?: number;
  /**
   * When {@link CreateFolderArchiveStreamOptions.statsRecentS3RetriesMax} is set, a bounded FIFO of
   * retry scheduling events (same order as `retry.onRetry`).
   */
  recentS3Retries?: ArchiveS3RetryTraceEntry[];
  /**
   * Peak FIFO depth of jobs waiting on the adaptive GetObject limiter (ZIP only, when an
   * {@link AdaptiveZipGetObjectLimit} is used).
   */
  zipGetObjectMaxQueueDepth?: number;
  /** Peak in-flight GetObject tasks held by the adaptive limiter. */
  zipGetObjectMaxActiveConcurrent?: number;
  /** Set when {@link CreateFolderArchiveStreamOptions.experimentalThroughputAdaptiveZipConcurrency} was used. */
  throughputAdaptiveZipTargetReadBytesPerSecond?: number;
  /**
   * Mean wall time from starting `GetObject` through finishing the archive entry, over successfully
   * included objects only (ms). Fills when {@link getObjectPipelineSamples} &gt; 0.
   */
  averageGetObjectPipelineMs?: number;
  /** Number of objects contributing to {@link averageGetObjectPipelineMs}. */
  getObjectPipelineSamples?: number;
  /**
   * When {@link CreateFolderArchiveStreamOptions.respectDestinationBackpressure} is true: count of
   * `drain` waits before starting a new object download (one increment per `while` iteration).
   */
  destinationDrainWaits?: number;
  /**
   * When {@link CreateFolderArchiveStreamOptions.trackDestinationDrainEvents} is true: total `drain`
   * events emitted on `destination` (passive observation; independent of
   * {@link destinationDrainWaits}).
   */
  destinationDrainEventCount?: number;
}

/**
 * **ZIP experimental:** hysteresis controller for GetObject cap vs rolling read throughput.
 * Requires {@link CreateFolderArchiveStreamOptions.statsThroughputRollingWindowMs} &gt; 0.
 * Mutually exclusive with {@link CreateFolderArchiveStreamOptions.experimentalAdaptiveZipConcurrency}.
 */
export interface ThroughputAdaptiveZipConcurrencyOptions {
  targetReadBytesPerSecond: number;
  lowWaterMarkRatio?: number;
  highWaterMarkRatio?: number;
  breachesToDecrease?: number;
  samplesToIncrease?: number;
  minCap?: number;
  sampleMinIntervalMs?: number;
}

export interface OmissionRecord {
  key: string;
  reason: string;
  code?: string;
}

/** Which S3 call is being retried (see {@link CreateFolderArchiveStreamOptions.retry}). */
export type ArchiveS3RetryOperation = "listObjectsV2" | "getObject";

/** Context for {@link CreateFolderArchiveStreamOptions.retry} `onRetry` (List/Get only). */
export interface ArchiveS3RetryContext {
  operation: ArchiveS3RetryOperation;
  /** 1-based attempt that failed and will be retried (matches `p-retry` attempt numbering). */
  attemptNumber: number;
  /** How many attempts remain after this failure (from `p-retry`). */
  retriesLeft: number;
  /**
   * Coarse classification for throttling vs 5xx vs timeouts (see `classifyAwsS3RetryKind` in `./retry.js`).
   */
  kind: import("./retry.js").AwsS3RetryKind;
  error: Error;
  /** Milliseconds slept before the next attempt (same schedule as `retry` / former `p-retry`). */
  delayMs: number;
  bucket: string;
  /** Set when {@link operation} is `listObjectsV2`. */
  prefix?: string;
  /** Set when {@link operation} is `getObject`. */
  key?: string;
}

/** Subset of {@link ArchiveS3RetryContext} stored on final stats when retry tracing is enabled. */
export type ArchiveS3RetryTraceEntry = Pick<
  ArchiveS3RetryContext,
  "operation" | "attemptNumber" | "kind" | "key" | "prefix"
>;

/** Early skip before an archive entry is opened (no {@link onArchiveEntryStart}). */
export type ArchiveEntrySkipReason =
  | "directory-placeholder"
  | "filter"
  | "checkpoint"
  /** Another object already archived under this entry path (see {@link CreateFolderArchiveStreamOptions.dedupeArchivePaths}). */
  | "duplicate-entry-path"
  /** Same normalized ETag + size as an earlier included object (see {@link CreateFolderArchiveStreamOptions.dedupeContentByEtag}). */
  | "duplicate-content"
  /** Skipped by {@link CreateFolderArchiveStreamOptions.deltaBaseline} (caller treats object as unchanged). */
  | "delta-baseline";

/** Best-effort failure after {@link onArchiveEntryStart}. */
export type ArchiveEntryFailureKind = "getObject" | "append";

/**
 * Structured trace for `explain: true` (strategy / per-object decisions).
 * Use {@link CreateFolderArchiveStreamOptions.onExplainStep} or read {@link PumpArchiveResult.explainTrace}
 * when no callback is provided (buffered, capped).
 */
export type ArchiveExplainStep =
  | {
      kind: "archive.config";
      source: string;
      format: ArchiveFormat;
      failureMode: FailureMode;
      zipConcurrency: number;
      listSource: "ListObjectsV2" | "prepared-ndjson";
      /** Number of extra `s3://` list roots after the primary source (0 unless {@link CreateFolderArchiveStreamOptions.additionalListSources} is set). */
      additionalListRoots: number;
      checkpoint: boolean;
      entryMappingsCount: number;
      filters: "none" | "include" | "exclude" | "size" | "predicate" | "mixed";
      dedupeArchivePaths: boolean;
      dedupeContentByEtag: boolean;
      deltaBaseline: boolean;
      objectPriority: boolean;
      deterministicOrdering: boolean;
      experimentalAdaptiveZipConcurrency: boolean;
      /** `0` when recovery disabled; otherwise tick interval (ms). */
      adaptiveZipConcurrencyRecoveryTickMs: number;
      adaptiveZipConcurrencyRecoveryQuietMs: number;
      experimentalThroughputAdaptiveZipConcurrency: boolean;
      throughputAdaptiveZipTargetReadBytesPerSecond: number;
      verifyGetObjectMd5Etag: boolean;
      /** True when {@link CreateFolderArchiveStreamOptions.storageProvider} is set. */
      injectedStorageProvider: boolean;
      /** Same as {@link CreateFolderArchiveStreamOptions.maxInFlightReadBytes}; `0` when disabled. */
      maxInFlightReadBytes: number;
      /** Same as {@link CreateFolderArchiveStreamOptions.respectDestinationBackpressure}. */
      respectDestinationBackpressure: boolean;
      /** Same as {@link CreateFolderArchiveStreamOptions.trackDestinationDrainEvents}. */
      trackDestinationDrainEvents: boolean;
    }
  | {
      kind: "archive.begin-object";
      key: string;
      entryName: string;
    }
  | {
      kind: "archive.finish-object";
      key: string;
      entryName?: string;
      outcome: "included" | "skipped" | "omitted" | "failed";
      skipReason?: ArchiveEntrySkipReason;
      failureKind?: ArchiveEntryFailureKind;
      errorMessage?: string;
    }
  | {
      kind: "archive.summary";
      dominant: ArchiveBottleneck;
      listMs: number;
      downloadMs: number;
      archiveWriteMs: number;
      /** Occupancy meter gap time (see {@link ArchiveStageStats.stageIdleMs}). */
      stageIdleMs?: number;
      retries: number;
      objectsListed: number;
      objectsIncluded: number;
      objectsSkipped: number;
      bytesRead: number;
      bytesWritten: number;
      omissionsCount: number;
      s3ListObjectsV2Requests?: number;
      s3GetObjectRequests?: number;
      s3RetriesListObjectsV2?: number;
      s3RetriesGetObject?: number;
      destinationDrainWaits?: number;
      destinationDrainEventCount?: number;
      stageOccupancyShare?: ArchiveStageOccupancyShares;
      statsThroughputRollingWindowMs?: number;
      rollingBytesReadPerSecond?: number;
      rollingBytesWrittenPerSecond?: number;
      throughputRollingReadMinusWriteBytesPerSecond?: number;
      throughputRollingPace?: ThroughputReadWritePace;
    };

/**
 * One row in the per-run best-effort omission list ({@link PumpArchiveResult.omissions}).
 * Alias of {@link OmissionRecord} for call sites that name this the **failure queue**.
 */
export type ArchiveRunFailureEntry = OmissionRecord;

/** Readonly alias for the per-run omission list (“failure queue”). */
export type ArchiveFailureQueue = readonly ArchiveRunFailureEntry[];

/**
 * Result of a completed folder archive pump (`pumpArchiveToWritable`, `runFolderArchiveToS3`, etc.).
 */
export interface PumpArchiveResult {
  stats: ArchiveStats;
  /**
   * **Best-effort (`failureMode: 'best-effort'`)** in-memory list of objects that were not archived
   * after passing filters (GetObject / append failures, etc.), in roughly encounter order. The same
   * rows stream through {@link CreateFolderArchiveStreamOptions.onOmission} when that callback is set.
   * This is **not** a durable queue—persist externally if you need replay or offline inspection.
   */
  omissions: ArchiveFailureQueue;
  /** Present when `explain: true` and no `onExplainStep` (buffered trace, capped). */
  explainTrace?: ArchiveExplainStep[];
}

/**
 * Lifecycle for an in-process background archive job (see `InMemoryArchiveJobRegistry`).
 * Not durable across process restarts—use a queue (e.g. BullMQ) for that.
 */
export type ArchiveJobStatus = "queued" | "running" | "completed" | "failed";

/**
 * Result of `runFolderArchiveToS3`: pump output plus the S3 object written and job id.
 */
export interface ArchiveJobResult extends PumpArchiveResult {
  jobId: string;
  bucket: string;
  key: string;
}

export interface ArchiveEntryStartContext {
  meta: ObjectMeta;
  entryName: string;
}

export interface ArchiveEntryEndContext {
  meta: ObjectMeta;
  /** Present when {@link onArchiveEntryStart} ran (mapped path known). */
  entryName?: string;
  outcome: "included" | "skipped" | "omitted" | "failed";
  skipReason?: ArchiveEntrySkipReason;
  failureKind?: ArchiveEntryFailureKind;
  /** Best-effort: message when {@link outcome} is `failed`. */
  errorMessage?: string;
  /** Approximate S3 bytes for this object when `included` (ZIP parallel uses metered body; tar uses `meta.size`). */
  bytesReadThisObject?: number;
}

/** Context for {@link CreateFolderArchiveStreamOptions.transformGetObjectBody}. */
export interface ArchiveGetObjectBodyTransformContext {
  meta: ObjectMeta;
  entryName: string;
  signal?: AbortSignal;
}

/**
 * Observed throughput sample when {@link CreateFolderArchiveStreamOptions.onSlowGetObjectStream} fires
 * (after minimum bytes and elapsed time; see `get-object-stream-telemetry.js` defaults).
 */
export interface ArchiveSlowGetObjectStreamInfo {
  meta: ObjectMeta;
  entryName: string;
  bytesReadSoFar: number;
  elapsedMs: number;
  /** Bytes per second from first byte through the check sample. */
  estimatedBytesPerSecond: number;
}

/**
 * Match against the full S3 object key: **micromatch** glob string (`{ dot: true }`)
 * or **RegExp** (`.test(key)`).
 */
export type ObjectKeyPattern = string | RegExp;

/**
 * JSON/job-safe filter subset: glob strings only (see {@link ObjectKeyPattern} for the full API).
 */
export type SerializableGlobFilters = {
  include?: string[];
  exclude?: string[];
  maxSizeBytes?: number;
  minSizeBytes?: number;
};

/** Optional Prometheus metrics via `prom-client` (pass your app `Registry`). */
export interface PrometheusIntegrationOptions {
  register: Registry;
  /**
   * Metric name prefix (snake_case). Names become `{prefix}_objects_listed_total`,
   * `{prefix}_destination_drain_waits_total` (when stats include drain waits),
   * `{prefix}_run_classifications_total` (workload + retry-stress labels), etc.
   * @default `s3_archive_stream`
   */
  prefix?: string;
}

export interface CreateFolderArchiveStreamOptions {
  /**
   * Optional Pino logger (e.g. `appLogger.child({ module: "export" })`).
   * If omitted, a shared silent logger is used (zero overhead).
   */
  logger?: Logger;
  /**
   * Verbose structured diagnostics: S3 list pages, GetObject lifecycle, per-object archive
   * timings/skips, retry scheduling, and an end-of-run stage breakdown. When `true` and `logger`
   * is omitted, a stderr JSON logger at `debug` is used; otherwise your logger is used with
   * an effective `debug` level on a child logger.
   */
  debug?: boolean;
  /**
   * Emit {@link ArchiveExplainStep} for config, skips, per-object begin/finish, and a final summary.
   * Without {@link onExplainStep}, steps are buffered on the pump result as {@link PumpArchiveResult.explainTrace}
   * (capped; prefer the callback for large prefixes).
   */
  explain?: boolean;
  /** Receive explain steps when {@link explain} is true. */
  onExplainStep?: (step: ArchiveExplainStep) => void;
  /** Virtual folder URI, e.g. `s3://my-bucket/path/to/prefix/`. */
  source: string;
  format?: ArchiveFormat;
  /**
   * Injected `S3Client` (recommended for production). **Reuse one long-lived instance** across
   * jobs or requests so connections amortize TLS and DNS. If omitted, a new
   * `S3Client` is created from {@link clientConfig} for this run only.
   */
  client?: S3Client;
  /**
   * Base config when {@link client} is omitted, or merged semantics your app uses with a shared client.
   * For **concurrent** List/Get under load, tune the HTTP stack (e.g. Node `https.Agent` `maxSockets`,
   * `keepAlive`) via AWS SDK v3 `requestHandler` / `NodeHttpHandler` options.
   */
  clientConfig?: S3ClientConfig;
  /** Max keys per ListObjectsV2 page (AWS max 1000). */
  maxKeys?: number;
  /** Delimiter; default none so subtree is listed. */
  delimiter?: string;
  /**
   * NDJSON stream (one {@link ObjectMeta} JSON object per line), as emitted by
   * {@link streamPrefixIndexNdjson} / {@link createPreparedIndexReadable}. When set,
   * `ListObjectsV2` is skipped; objects are still read with `GetObject` using the bucket
   * from `source`. Each `key` must start with the same prefix as `source` (see {@link parseS3Uri}).
   *
   * **Cache between runs:** write the index to disk once (see {@link prepareFolderArchiveIndexToFile}),
   * then pass `fs.createReadStream(path)` here on subsequent archives to avoid re-listing the prefix.
   */
  preparedIndexNdjson?: Readable;
  /**
   * Extra `s3://bucket/prefix/` roots listed and merged after the primary {@link source}
   * (same {@link client} must be allowed to read each bucket). Incompatible with {@link preparedIndexNdjson}.
   * Listed objects carry {@link ObjectMeta.bucket} / {@link ObjectMeta.listPrefix} for `GetObject` and naming.
   */
  additionalListSources?: readonly string[];
  signal?: AbortSignal;
  failureMode?: FailureMode;
  /**
   * **ZIP only:** max concurrent `GetObject` calls (each stream is paused until its
   * turn to append). Archive writes stay strictly serialized. Default **2**, max **16**.
   * **tar / tar.gz:** must be **`1`** or omitted (otherwise `UNSUPPORTED_OPTION`).
   * Independent of {@link maxInFlightReadBytes} (task count vs declared-byte budget) and of
   * destination `Writable` backpressure (`stream/promises.pipeline` from the archive encoder to
   * `destination`).
   */
  concurrency?: number;
  /**
   * **ZIP only (experimental):** lower effective GetObject concurrency when S3 signals throttling
   * (see {@link ArchiveS3RetryContext.kind} `throttle` on {@link retry} `onRetry`). Requires
   * {@link concurrency} **≥ 2**. Incompatible with tar formats.
   */
  experimentalAdaptiveZipConcurrency?: boolean;
  /**
   * **ZIP + adaptive:** interval (ms) for attempting to raise the GetObject cap back toward the initial
   * value after a quiet period without throttle retries. **`0`** disables recovery (downshift only).
   * Default **15000**. Quiet period defaults to this value unless {@link adaptiveZipConcurrencyRecoveryQuietMs} is set.
   */
  adaptiveZipConcurrencyRecoveryMs?: number;
  /**
   * **ZIP + adaptive:** minimum ms since the last throttle-classified retry before a recovery tick may
   * increase the cap. Default: same as {@link adaptiveZipConcurrencyRecoveryMs} (or **15000** when that is unset).
   */
  adaptiveZipConcurrencyRecoveryQuietMs?: number;
  /**
   * **ZIP only (experimental):** adjust GetObject concurrency using **rolling read throughput** vs
   * {@link ThroughputAdaptiveZipConcurrencyOptions.targetReadBytesPerSecond} (hysteresis; see
   * `ThroughputZipAdaptiveController`). Requires {@link statsThroughputRollingWindowMs} **&gt; 0** and
   * {@link concurrency} **≥ 2**. **Incompatible** with {@link experimentalAdaptiveZipConcurrency}.
   */
  experimentalThroughputAdaptiveZipConcurrency?: ThroughputAdaptiveZipConcurrencyOptions;
  /**
   * **ZIP only:** choose which listed object **starts** next from a bounded read-ahead buffer
   * (not counting in-flight downloads). Higher score → scheduled sooner (e.g. `(m) => -m.size`
   * favors smaller objects among buffered keys). Omit for strict listing order.
   * **tar / tar.gz:** not supported (`UNSUPPORTED_OPTION` if set).
   */
  objectPriority?: (meta: ObjectMeta) => number;
  /**
   * Max objects held in the priority buffer before a worker starts them. Only applies when
   * {@link objectPriority} is set. Default **256** (minimum **1**).
   */
  objectPriorityBufferMax?: number;
  /**
   * Prefer **reproducible** archive entry order: **ZIP** uses effective `concurrency: 1` (listing order
   * matches append order) and cannot be combined with {@link objectPriority}. If you pass `concurrency`
   * for ZIP it must be **`1`**. **tar / tar.gz** are already sequential. Listing order is still defined
   * by S3 / your {@link preparedIndexNdjson} file unless you add your own sort upstream.
   */
  deterministicOrdering?: boolean;
  /**
   * After a successful archive write, skip later objects whose resolved {@link mapEntryName} /
   * {@link entryMappings} path matches one already included (first wins). **ZIP:** requires
   * `concurrency: 1` (throws `UNSUPPORTED_OPTION` with higher concurrency).
   */
  dedupeArchivePaths?: boolean;
  /**
   * After a successful include, skip later objects with the same {@link objectContentFingerprint}
   * (normalized ETag + size). Objects without `etag` in {@link ObjectMeta} are never treated as
   * duplicates by this mode. **ZIP:** requires `concurrency: 1`.
   */
  dedupeContentByEtag?: boolean;
  /**
   * Verify each streamed object's bytes against its **single-part** S3 ETag (hex MD5). Multipart
   * ETags are skipped automatically. On mismatch throws `GET_OBJECT_ETAG_MISMATCH` (adds MD5 hashing
   * on the read path).
   */
  verifyGetObjectMd5Etag?: boolean;
  /**
   * When set to a finite number **≥ 1**, bounds aggregate **declared** in-flight read budget across
   * overlapping objects: each active pipeline reserves `min(listed ObjectMeta.size, maxInFlightReadBytes)`
   * from first `GetObject` through archive entry completion (released on success, omission, or failure
   * after `GetObject`). Complements ZIP {@link CreateFolderArchiveStreamOptions.concurrency} (task
   * count) with a **byte-level** throttle based on listing sizes (not a hard RSS guarantee).
   * Slow `destination` consumers are handled separately by `stream/promises.pipeline` from the
   * archive encoder (see `ArchivePumpFlowEngine` in `archive-pump-flow.ts`).
   */
  maxInFlightReadBytes?: number;
  /**
   * When **true**, each object’s `GetObject` is not started until `destination.writableNeedDrain` is
   * false (awaiting `drain` while needed). Reduces parallel download **starts** when the archive
   * `Writable` is over its buffer watermark, in addition to pipeline backpressure inside the encoder.
   * @default false
   */
  respectDestinationBackpressure?: boolean;
  /**
   * When **true**, increment {@link ArchiveStats.destinationDrainEventCount} for every `drain` event
   * on `destination` (cheap listener; no scheduling change). Detached when the pump run ends.
   * @default false
   */
  trackDestinationDrainEvents?: boolean;
  /**
   * When this returns `true`, the object is skipped without `GetObject` (no {@link onArchiveEntryStart}):
   * use with your own map of last-known `etag` / `size` / `lastModified` to build incremental archives
   * (“delta” style). Runs after {@link filters} and before checkpoint / path or content dedupe.
   */
  deltaBaseline?: (meta: ObjectMeta) => boolean;
  /** Retry policy for S3 List/Get. */
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /**
     * Called before each automatic retry after a failed `ListObjectsV2` or `GetObject`
     * (not invoked on the terminal failure when no retry remains).
     */
    onRetry?: (ctx: ArchiveS3RetryContext) => void;
    /**
     * Subset of {@link onRetry}: invoked only when {@link ArchiveS3RetryContext.kind} is `throttle`
     * (List or Get). Fires after the same internal accounting as `onRetry`.
     */
    onS3ThrottleRetry?: (ctx: ArchiveS3RetryContext) => void;
  };
  /** Include `manifest.json` as the last entry (memory: collects metadata in RAM). */
  includeManifest?: boolean;
  manifestName?: string;
  /** Skip manifest when object count exceeds this (requires counting during list). */
  manifestMaxEntries?: number;
  filters?: {
    include?: ObjectKeyPattern[];
    exclude?: ObjectKeyPattern[];
    maxSizeBytes?: number;
    minSizeBytes?: number;
    predicate?: (meta: ObjectMeta) => boolean;
  };
  /** Map S3 key → archive entry path (posix). */
  mapEntryName?: (meta: ObjectMeta) => string;
  /**
   * Exact path overrides: map **full S3 object key** (as returned by listing, e.g. `photos/hero.jpg`)
   * or `s3://<same-bucket-as-source>/<key>` → archive entry path (posix). Applied when resolving the
   * archive path (after filters, {@link deltaBaseline}, checkpoint skip, and before `GetObject`); when a
   * key matches, it **replaces** {@link mapEntryName} / default naming. Later entries win if keys normalize
   * to the same object key.
   */
  entryMappings?: Record<string, string>;
  /** Progress callback (throttle internally if needed). */
  onProgress?: (p: ArchiveProgress) => void;
  /**
   * When > 0, records progress samples for trailing-window throughput on the final
   * {@link onStats} payload (`rollingBytesReadPerSecond` / `rollingBytesWrittenPerSecond`).
   */
  statsThroughputRollingWindowMs?: number;
  /** Stats including stage timings and retry count. */
  onStats?: (s: ArchiveStats) => void;
  /**
   * Fires for each **omitted** object in `failureMode: 'best-effort'` (same rows as
   * {@link PumpArchiveResult.omissions}). Use for streaming failure handling; the full per-run list is on the result.
   */
  onOmission?: (o: OmissionRecord) => void;
  /**
   * Fires immediately before `GetObject` for an object that passed filters, was not skipped by
   * {@link deltaBaseline}, checkpoint, or path/content dedupe. Not called for directory placeholders,
   * filtered keys, those skip reasons, or dedupe skips (`duplicate-entry-path` / `duplicate-content`;
   * use {@link onArchiveEntryEnd} only).
   */
  onArchiveEntryStart?: (ctx: ArchiveEntryStartContext) => void;
  /**
   * Fires once per listed object: `skipped` (early reasons), `omitted` (best-effort after start),
   * `failed` (fail-fast after start, before rethrow), or `included` (success).
   */
  onArchiveEntryEnd?: (ctx: ArchiveEntryEndContext) => void;
  /**
   * Optional transform of each object body **after** optional {@link verifyGetObjectMd5Etag} hashing
   * (so verification still sees raw S3 bytes). Use for scan/decrypt/metering; you must preserve stream
   * semantics compatible with the archive encoder. If you change byte length, {@link ObjectMeta.size}
   * may no longer match the streamed bytes—adjust upstream metadata or avoid fixed-size ZIP modes.
   */
  transformGetObjectBody?: (
    ctx: ArchiveGetObjectBodyTransformContext,
    body: Readable,
  ) => Readable;
  /**
   * When set **together** with {@link onSlowGetObjectStream}: estimate bytes/sec from the first body
   * byte; if still below this threshold after library defaults for minimum bytes and elapsed time,
   * `onSlowGetObjectStream` fires once per object.
   */
  slowGetObjectReadBytesPerSecondThreshold?: number;
  /** See {@link slowGetObjectReadBytesPerSecondThreshold}. */
  onSlowGetObjectStream?: (info: ArchiveSlowGetObjectStreamInfo) => void;
  /**
   * When set to a finite number **≥ 1024**, wraps each raw GetObject body in a bounded-buffer
   * {@link PassThrough} (Node `highWaterMark`). Applies **per-stream** backpressure only; combine with
   * {@link maxInFlightReadBytes} for aggregate byte budgets across concurrent objects.
   */
  getObjectReadBufferHighWaterMark?: number;
  /** ZIP compression level 0–9 (zip only). */
  zipLevel?: number;
  /** Listed size ≥ this → STORE for that entry; otherwise {@link zipLevel}. Manifest uses {@link zipLevel}. */
  zipStoreMinBytes?: number;
  /** gzip level for tar.gz */
  gzipLevel?: number;
  /**
   * Skip keys already completed; updated after each successful entry. When combined with
   * {@link dedupeArchivePaths} or {@link dedupeContentByEtag}, the store must persist the extended
   * `resumeDedupe` field (written by this library) so a resumed run can rebuild dedupe sets; older
   * checkpoints without that metadata fail fast with `CHECKPOINT_DEDUPE_RESUME`.
   */
  checkpoint?: {
    jobId: string;
    store: CheckpointStore;
  };
  /**
   * Per-command wall timeout (ms) for each S3 `client.send` (`ListObjectsV2` / `GetObject`), merged with
   * {@link signal} using `AbortSignal.any` + `AbortSignal.timeout` (Node **18+**). Omit or `0` to disable.
   */
  s3RequestTimeoutMs?: number;
  /**
   * When `> 0`, append up to `min(this value, 64)` entries to {@link ArchiveStats.recentS3Retries}
   * (FIFO) for each **scheduled** S3 retry (same order as {@link CreateFolderArchiveStreamOptions.retry} `onRetry`).
   */
  statsRecentS3RetriesMax?: number;
  /** When set, archive completion updates counters and a wall-duration histogram on `register`. */
  prometheus?: PrometheusIntegrationOptions;
  /**
   * Inject list/get instead of building {@link S3StorageProvider} (no AWS `S3Client` traffic).
   * {@link source} remains a normal `s3://bucket/prefix/` URI for entry naming and checkpoints.
   * Incompatible with {@link additionalListSources}.
   */
  storageProvider?: StorageProvider;
}

export interface StorageProvider {
  listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta>;
  getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable>;
}

/** NDJSON line = one JSON object per line (for large prefixes). */
export interface PreparedIndexOptions {
  logger?: Logger;
  /** Same semantics as {@link CreateFolderArchiveStreamOptions.debug} for list operations. */
  debug?: boolean;
  source: string;
  client?: S3Client;
  clientConfig?: S3ClientConfig;
  maxKeys?: number;
  delimiter?: string;
  signal?: AbortSignal;
  /** Same shape as archive {@link CreateFolderArchiveStreamOptions.retry}. */
  retry?: CreateFolderArchiveStreamOptions["retry"];
  /** Same as {@link CreateFolderArchiveStreamOptions.s3RequestTimeoutMs} for listing only. */
  s3RequestTimeoutMs?: number;
  /** When set, each emitted NDJSON line increments `{prefix}_prepared_index_lines_total`. */
  prometheus?: PrometheusIntegrationOptions;
}

export interface S3MultipartArchiveOutput {
  type: "s3-multipart";
  bucket: string;
  key: string;
  client?: S3Client;
  /** Optional ACL / content type */
  contentType?: string;
}

export interface RunFolderArchiveJobOptions extends CreateFolderArchiveStreamOptions {
  output: S3MultipartArchiveOutput;
}
