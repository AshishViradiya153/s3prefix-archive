/**
 * BullMQ integration: JSON-safe job payloads and a worker processor for
 * {@link runFolderArchiveToS3}. Install `bullmq` (peer) alongside this package.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { Job, JobsOptions, Processor, Queue } from "bullmq";
import type { CheckpointStore } from "./checkpoint.js";
import type { Logger } from "pino";
import { runFolderArchiveToS3, type ArchiveJobResult } from "./platform.js";
import { compactNonEmptyStrings } from "./strings.js";
import type {
  ArchiveFormat,
  FailureMode,
  PrometheusIntegrationOptions,
  RunFolderArchiveJobOptions,
  SerializableGlobFilters,
} from "./types.js";

/** Default BullMQ job name for {@link enqueueFolderArchiveToS3}. */
export const FOLDER_ARCHIVE_TO_S3_JOB_NAME = "folder-archive-to-s3" as const;

/**
 * Suggested queue name; callers may use any Redis queue name.
 * @example `new Queue(DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME, { connection })`
 */
export const DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME = "s3flow:folder-archive-to-s3";

/**
 * JSON-serializable payload for Redis (no functions, no `RegExp` instances).
 * Map/filter callbacks are not supported; use {@link FolderArchiveToS3JobData.filters}
 * with **micromatch** glob strings for `filters.include` / `filters.exclude` (same semantics as the library API).
 */
export interface FolderArchiveToS3JobData {
  source: string;
  output: {
    bucket: string;
    key: string;
    contentType?: string;
  };
  format?: ArchiveFormat;
  /**
   * Used when the processor does not inject an `S3Client` (`new S3Client(clientConfig)`).
   * Prefer IAM roles on workers instead of embedding long-lived credentials in job data.
   */
  clientConfig?: RunFolderArchiveJobOptions["clientConfig"];
  maxKeys?: number;
  delimiter?: string;
  failureMode?: FailureMode;
  concurrency?: number;
  /** Same as {@link RunFolderArchiveJobOptions.experimentalAdaptiveZipConcurrency}. */
  experimentalAdaptiveZipConcurrency?: boolean;
  /** Same as {@link RunFolderArchiveJobOptions.adaptiveZipConcurrencyRecoveryMs}. */
  adaptiveZipConcurrencyRecoveryMs?: number;
  /** Same as {@link RunFolderArchiveJobOptions.adaptiveZipConcurrencyRecoveryQuietMs}. */
  adaptiveZipConcurrencyRecoveryQuietMs?: number;
  /** Same as {@link RunFolderArchiveJobOptions.s3RequestTimeoutMs}. */
  s3RequestTimeoutMs?: number;
  /** Same as {@link RunFolderArchiveJobOptions.statsRecentS3RetriesMax}. */
  statsRecentS3RetriesMax?: number;
  /** Numeric retry policy only (`onRetry` is not JSON-serializable; inject hooks in the worker via `RunFolderArchiveJobOptions` if needed). */
  retry?: Pick<
    NonNullable<RunFolderArchiveJobOptions["retry"]>,
    "maxAttempts" | "baseDelayMs" | "maxDelayMs"
  >;
  includeManifest?: boolean;
  manifestName?: string;
  manifestMaxEntries?: number;
  filters?: SerializableGlobFilters;
  /** Same as {@link RunFolderArchiveJobOptions.entryMappings} (JSON object of strings). */
  entryMappings?: Record<string, string>;
  /** Same as {@link RunFolderArchiveJobOptions.additionalListSources} (JSON array of S3 URIs). */
  additionalListSources?: string[];
  /** Same as {@link RunFolderArchiveJobOptions.dedupeArchivePaths}. */
  dedupeArchivePaths?: boolean;
  /** Same as {@link RunFolderArchiveJobOptions.dedupeContentByEtag}. */
  dedupeContentByEtag?: boolean;
  zipLevel?: number;
  /** Same as {@link RunFolderArchiveJobOptions.zipStoreMinBytes}. */
  zipStoreMinBytes?: number;
  gzipLevel?: number;
  /**
   * When set together with {@link CreateFolderArchiveToS3ProcessorOptions.resolveCheckpointStore},
   * checkpoint/resume is enabled for this job.
   */
  checkpointJobId?: string;
}

export interface FolderArchiveJobRunContext {
  client?: S3Client;
  logger?: Logger;
  signal?: AbortSignal;
  checkpoint?: RunFolderArchiveJobOptions["checkpoint"];
}

/**
 * Merge job payload with worker-injected dependencies into {@link RunFolderArchiveJobOptions}.
 */
export function folderArchiveJobDataToRunOptions(
  data: FolderArchiveToS3JobData,
  ctx: FolderArchiveJobRunContext = {},
): RunFolderArchiveJobOptions {
  const options: RunFolderArchiveJobOptions = {
    source: data.source,
    output: {
      type: "s3-multipart",
      bucket: data.output.bucket,
      key: data.output.key,
      contentType: data.output.contentType,
    },
    format: data.format,
    client: ctx.client,
    clientConfig: data.clientConfig,
    maxKeys: data.maxKeys,
    delimiter: data.delimiter,
    signal: ctx.signal,
    failureMode: data.failureMode,
    concurrency: data.concurrency,
    retry: data.retry,
    includeManifest: data.includeManifest,
    manifestName: data.manifestName,
    manifestMaxEntries: data.manifestMaxEntries,
    zipLevel: data.zipLevel,
    zipStoreMinBytes: data.zipStoreMinBytes,
    gzipLevel: data.gzipLevel,
  };
  if (data.experimentalAdaptiveZipConcurrency) {
    options.experimentalAdaptiveZipConcurrency = true;
  }
  if (data.adaptiveZipConcurrencyRecoveryMs != null) {
    options.adaptiveZipConcurrencyRecoveryMs =
      data.adaptiveZipConcurrencyRecoveryMs;
  }
  if (data.adaptiveZipConcurrencyRecoveryQuietMs != null) {
    options.adaptiveZipConcurrencyRecoveryQuietMs =
      data.adaptiveZipConcurrencyRecoveryQuietMs;
  }
  if (data.s3RequestTimeoutMs != null) {
    options.s3RequestTimeoutMs = data.s3RequestTimeoutMs;
  }
  if (data.statsRecentS3RetriesMax != null) {
    options.statsRecentS3RetriesMax = data.statsRecentS3RetriesMax;
  }
  if (data.filters) {
    options.filters = {
      include: compactNonEmptyStrings(data.filters.include),
      exclude: compactNonEmptyStrings(data.filters.exclude),
      maxSizeBytes: data.filters.maxSizeBytes,
      minSizeBytes: data.filters.minSizeBytes,
    };
  }
  if (data.entryMappings && Object.keys(data.entryMappings).length > 0) {
    options.entryMappings = data.entryMappings;
  }
  if (data.dedupeArchivePaths) options.dedupeArchivePaths = true;
  if (data.dedupeContentByEtag) options.dedupeContentByEtag = true;
  if (data.additionalListSources?.length) {
    options.additionalListSources = [...data.additionalListSources];
  }
  if (ctx.logger) options.logger = ctx.logger;
  if (ctx.checkpoint) options.checkpoint = ctx.checkpoint;
  return options;
}

export interface CreateFolderArchiveToS3ProcessorOptions {
  /**
   * Shared or per-job S3 client. When omitted, {@link runFolderArchiveToS3} builds
   * `new S3Client(job.data.clientConfig ?? {})`.
   */
  client?:
    | S3Client
    | ((
        job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
      ) => S3Client | Promise<S3Client>);
  logger?:
    | Logger
    | ((
        job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
      ) => Logger | undefined);
  /**
   * When `job.data.checkpointJobId` is set, this must return the store for that id
   * (e.g. a shared {@link FileCheckpointStore}).
   */
  resolveCheckpointStore?: (
    job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
  ) => CheckpointStore | undefined | Promise<CheckpointStore | undefined>;
  /**
   * Optional signal override; by default the BullMQ processor `signal` is passed through
   * (cooperative cancellation when the worker supports it).
   */
  getSignal?: (
    job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
  ) => AbortSignal | undefined;
  /**
   * Prometheus registry for archive completion metrics (not serializable in job JSON;
   * inject per worker or per job).
   */
  prometheus?:
    | PrometheusIntegrationOptions
    | ((
        job: Job<FolderArchiveToS3JobData, ArchiveJobResult>,
      ) =>
        | PrometheusIntegrationOptions
        | undefined
        | Promise<PrometheusIntegrationOptions | undefined>);
}

/**
 * Returns a BullMQ {@link Processor} that runs {@link runFolderArchiveToS3} for each job.
 *
 * @example
 * ```ts
 * import { Worker } from "bullmq";
 * import { createFolderArchiveToS3Processor, FOLDER_ARCHIVE_TO_S3_JOB_NAME } from "s3flow/bullmq";
 *
 * const processor = createFolderArchiveToS3Processor({});
 * new Worker("s3flow:folder-archive-to-s3", processor, { connection });
 * ```
 */
export function createFolderArchiveToS3Processor(
  options: CreateFolderArchiveToS3ProcessorOptions,
): Processor<FolderArchiveToS3JobData, ArchiveJobResult> {
  return async (job, _token, signal) => {
    const client =
      typeof options.client === "function"
        ? await options.client(job)
        : options.client;
    const logger =
      typeof options.logger === "function"
        ? options.logger(job)
        : options.logger;
    const checkpointStore = options.resolveCheckpointStore
      ? await options.resolveCheckpointStore(job)
      : undefined;
    const checkpoint =
      job.data.checkpointJobId && checkpointStore
        ? { jobId: job.data.checkpointJobId, store: checkpointStore }
        : undefined;
    const coopSignal = options.getSignal?.(job) ?? signal;
    const prom =
      typeof options.prometheus === "function"
        ? await options.prometheus(job)
        : options.prometheus;
    const runOptions: RunFolderArchiveJobOptions = {
      ...folderArchiveJobDataToRunOptions(job.data, {
        client: client ?? undefined,
        logger: logger ?? undefined,
        signal: coopSignal,
        checkpoint,
      }),
      ...(prom ? { prometheus: prom } : {}),
    };
    return runFolderArchiveToS3(runOptions);
  };
}

/**
 * Enqueue a folder→S3 multipart archive job with the canonical job name.
 */
export function enqueueFolderArchiveToS3(
  queue: Queue<FolderArchiveToS3JobData, ArchiveJobResult>,
  data: FolderArchiveToS3JobData,
  opts?: JobsOptions,
): Promise<Job<FolderArchiveToS3JobData, ArchiveJobResult>> {
  return queue.add(FOLDER_ARCHIVE_TO_S3_JOB_NAME, data, opts);
}

export type { ArchiveJobResult };
