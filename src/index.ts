import { PassThrough, type Readable } from "node:stream";
import type { CreateFolderArchiveStreamOptions } from "./types.js";
import { pumpArchiveToWritable } from "./pump-archive.js";
export type {
  ArchiveBottleneck,
  ArchiveExplainStep,
  ArchiveEntryEndContext,
  ArchiveEntryFailureKind,
  ArchiveEntrySkipReason,
  ArchiveEntryStartContext,
  ArchiveGetObjectBodyTransformContext,
  ArchiveFormat,
  ArchiveProgress,
  ArchiveS3RetryContext,
  ArchiveS3RetryOperation,
  ArchiveS3RetryTraceEntry,
  ArchiveSlowGetObjectStreamInfo,
  ArchiveStageOccupancyShares,
  ArchiveStats,
  CreateFolderArchiveStreamOptions,
  FailureMode,
  ObjectKeyPattern,
  ObjectMeta,
  SerializableGlobFilters,
  OmissionRecord,
  PumpArchiveResult,
  ArchiveRunFailureEntry,
  ArchiveFailureQueue,
  PreparedIndexOptions,
  PrometheusIntegrationOptions,
  RunFolderArchiveJobOptions,
  ArchiveJobResult,
  ArchiveJobStatus,
  S3MultipartArchiveOutput,
  StorageProvider,
  ThroughputAdaptiveZipConcurrencyOptions,
  ThroughputReadWritePace,
} from "./types.js";

export { parseS3Uri } from "./s3-uri.js";
export type { ParsedS3Uri } from "./s3-uri.js";
export {
  S3ArchiveError,
  PathUnsafeError,
  describeArchiveFailure,
  isPathUnsafeError,
  isS3ArchiveError,
  summarizeErrorCauses,
} from "./errors.js";
export type {
  ArchiveErrorContextRecord,
  ArchiveErrorContextValue,
  ArchiveErrorPhase,
  ArchiveFailureDescription,
  CaughtValue,
  S3ArchiveErrorCode,
  S3ArchiveErrorDetails,
} from "./errors.js";
export { s3RequestFailed } from "./s3-request-failure.js";
export { classifyTerminalS3Failure } from "./s3-failure-disposition.js";
export type { S3TerminalFailureDisposition } from "./s3-failure-disposition.js";
export {
  createEtagMd5VerifyTransform,
  parseS3SinglePartEtagMd5Hex,
  pipeThroughEtagMd5Verifier,
} from "./etag-md5-verify.js";
export {
  verifyLocalArchiveFileBytesMatchStats,
  verifyS3ObjectBytesMatchArchiveStats,
} from "./archive-output-verify.js";
export type {
  ArchiveBytesVerifyResult,
  VerifyArchiveBytesOptions,
} from "./archive-output-verify.js";
export { assertSafeArchivePath, defaultEntryName } from "./path-normalize.js";
export {
  assertAdditionalListSourcesMatchCheckpoint,
  canonicalizeAdditionalListSources,
  parseAdditionalListSources,
} from "./archive-sources.js";
export type { AdditionalListRoot } from "./archive-sources.js";
export {
  classifyArchiveBottleneck,
  computeArchiveStageOccupancyShares,
} from "./archive-bottleneck.js";
export {
  ArchiveStageOccupancyMeter,
  wrapAsyncIterableWithListStage,
} from "./archive-stage-meter.js";
export type { ArchiveStageOccupancySnapshot } from "./archive-stage-meter.js";
export { objectContentFingerprint } from "./archive-dedupe.js";
export { buildEntryMappingLookup } from "./entry-mappings.js";
export type { BuildEntryMappingLookupOptions } from "./entry-mappings.js";
export {
  globFiltersForExtensions,
  keyMatchesFilterPattern,
  shouldIncludeObject,
  isDirectoryPlaceholder,
} from "./filters.js";
export { AbortError } from "p-retry";
export {
  buildRetryBackoffTimeouts,
  classifyAwsS3RetryKind,
  isRetryableAwsError,
  withRetry,
} from "./retry.js";
export type { AwsS3RetryKind } from "./retry.js";
export {
  classifyThroughputReadWritePace,
  createArchiveThroughputSampler,
  DEFAULT_THROUGHPUT_READ_WRITE_ABSOLUTE_FLOOR_BPS,
  DEFAULT_THROUGHPUT_READ_WRITE_RELATIVE_TOLERANCE,
  THROUGHPUT_SAMPLER_MIN_DELTA_SECONDS,
} from "./archive-throughput.js";
export type { ArchiveThroughputSampler } from "./archive-throughput.js";
export { AdaptiveZipGetObjectLimit } from "./archive-adaptive-zip-limit.js";
export type { ThroughputAdaptiveZipLimiter } from "./archive-adaptive-zip-limit.js";
export { ThroughputZipAdaptiveController } from "./archive-throughput-zip-adaptive.js";
export {
  signGetObjectDownloadUrl,
  signGetObjectDownloadUrls,
} from "./presigned-get-object.js";
export type { SignGetObjectDownloadUrlInput } from "./presigned-get-object.js";
export {
  parseArchiveRetryFromCli,
  type RetryCliStringFields,
} from "./retry-parse.js";
export { S3StorageProvider } from "./s3-provider.js";
export type {
  S3StorageProviderExtras,
  S3StorageProviderRequestCounters,
} from "./s3-provider.js";
export { MemoryStorageProvider } from "./memory-storage-provider.js";
export type { MemoryStorageObject } from "./memory-storage-provider.js";
export { mergeAbortSignalWithTimeout } from "./abort-signal-util.js";
export { pumpArchiveToWritable } from "./pump-archive.js";
export { ArchivePumpFlowEngine } from "./archive-pump-flow.js";
export {
  downloadFolderAsArchive,
  downloadFolderToFile,
} from "./download-to-file.js";
export {
  resumeFolderArchiveToFile,
  resumeFolderArchiveToWritable,
} from "./resume-download.js";
export {
  createPreparedIndexReadable,
  prepareFolderArchiveIndexToFile,
  streamPrefixIndexNdjson,
} from "./prepared-index.js";
export { downloadFolderToFileFromPreparedIndex } from "./download-from-prepared-index-file.js";
export type { DownloadFromPreparedIndexFileOptions } from "./download-from-prepared-index-file.js";
export { iterateObjectMetaFromNdjsonIndex } from "./ndjson-prepared-index.js";
export type { IteratePreparedIndexNdjsonOptions } from "./ndjson-prepared-index.js";
export { toNodeReadable } from "./node-readable.js";
export type { GetObjectBodyInput } from "./node-readable.js";
export {
  forEachAsyncIterablePool,
  forEachAsyncIterablePriorityPool,
} from "./async-iterable-pool.js";
export type { ForEachAsyncIterablePriorityPoolOptions } from "./async-iterable-pool.js";
export { createExclusiveRunner } from "./exclusive.js";
export type {
  CheckpointResumeDedupeEntry,
  CheckpointState,
  CheckpointStore,
} from "./checkpoint.js";
export { FileCheckpointStore } from "./checkpoint.js";
export { RedisCheckpointStore } from "./redis-checkpoint-store.js";
export type {
  RedisCheckpointCommands,
  RedisCheckpointStoreOptions,
} from "./redis-checkpoint-store.js";
export { SqlTableCheckpointStore } from "./sql-checkpoint-store.js";
export type {
  SqlCheckpointClient,
  SqlCheckpointDialect,
  SqlTableCheckpointStoreOptions,
} from "./sql-checkpoint-store.js";
export { ArchivePumpResolvedOptions } from "./archive-pump-resolved-options.js";
export {
  ArchiveCheckpointCoordinator,
  type ArchiveCheckpointOpenScope,
  type ArchiveCheckpointDedupeSeed,
} from "./archive-checkpoint-coordinator.js";
export {
  ArchiveObjectProcessor,
  type ArchiveEntryWriter,
  type ArchiveExclusiveRunner,
  type ArchiveManifestRow,
  type ArchiveObjectProcessorDeps,
  type ArchiveZipConcurrencyGate,
} from "./archive-object-processor.js";
export {
  ZipArchiveSink,
  type ZipArchiveSinkRunParams,
} from "./archive-zip-sink.js";
export { resolveZipEntryLevel } from "./archive-zip-level.js";
export {
  TarArchiveSink,
  type TarArchiveSinkRunParams,
} from "./archive-tar-sink.js";
export {
  encodeArchiveManifestJsonUtf8,
  type ArchiveManifestEncodeInput,
} from "./archive-manifest.js";
export { createBenchmarkDiscardWritable } from "./benchmark-sink.js";
export { resolveArchiveContentType } from "./archive-mime.js";
export { resolveArchiveLogger, resolveLogger } from "./logger.js";
export type { Logger } from "./logger.js";
export {
  DEFAULT_PROMETHEUS_METRIC_PREFIX,
  observeArchiveCompletion,
  observePreparedIndexLine,
} from "./prometheus.js";
export {
  computeS3WorkloadUnits,
  DEFAULT_S3_WORKLOAD_WEIGHTS,
  estimateS3ApiRequestCostUsd,
  usdPerRequestFromPerThousand,
} from "./s3-workload-units.js";
export type {
  S3ApiUsdPricing,
  S3WorkloadWeights,
} from "./s3-workload-units.js";
export {
  BYTES_PER_GIB,
  estimateDataTransferOutCostUsd,
  estimateS3DataTransferOutCostUsdFromArchiveBytesRead,
  usdPerGibToUsdPerByte,
} from "./s3-data-transfer-cost.js";
export type { CumulativeDataTransferPriceBand } from "./s3-data-transfer-cost.js";
export {
  classifyArchiveWorkloadSize,
  DEFAULT_ARCHIVE_WORKLOAD_LARGE_AVG_BYTES,
  DEFAULT_ARCHIVE_WORKLOAD_SMALL_AVG_BYTES,
} from "./archive-workload-profile.js";
export {
  classifyArchiveRetryStress,
  classifyArchiveRetryStressFromStats,
  DEFAULT_RETRY_STRESS_LOW_MAX_RATIO,
  DEFAULT_RETRY_STRESS_MODERATE_MAX_RATIO,
} from "./archive-retry-profile.js";
export type {
  ArchiveRetryStressClassification,
  ArchiveRetryStressProfile,
  ClassifyArchiveRetryStressInput,
} from "./archive-retry-profile.js";
export type {
  ArchiveWorkloadSizeClassification,
  ArchiveWorkloadSizeProfile,
  ClassifyArchiveWorkloadSizeInput,
} from "./archive-workload-profile.js";
export {
  createInFlightReadByteLimiter,
  readReservationBytes,
} from "./in-flight-read-bytes.js";
export type { InFlightReadByteLimiter } from "./in-flight-read-bytes.js";
export {
  createDestinationDownloadGate,
  type DestinationDownloadGate,
} from "./destination-download-gate.js";
export {
  assertCrossCutArchivePumpOptions,
  assertMaxInFlightReadBytesOption,
} from "./validate-archive-pump-options.js";
export type { ArchivePumpCrossCutValidationInput } from "./validate-archive-pump-options.js";
export {
  SLOW_GET_OBJECT_MIN_BYTES,
  SLOW_GET_OBJECT_MIN_ELAPSED_MS,
  wrapReadableWithSlowGetObjectMonitor,
} from "./get-object-stream-telemetry.js";
export {
  GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES,
  wrapReadableWithReadBufferHighWaterMark,
} from "./get-object-read-buffer-cap.js";
export {
  ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM,
  ARCHIVE_TELEMETRY_EVENT_S3_RETRY,
  ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY,
  createArchiveTelemetryBridge,
} from "./archive-telemetry-bridge.js";
export type {
  ArchiveTelemetryEventName,
  CreateArchiveTelemetryBridgeResult,
} from "./archive-telemetry-bridge.js";
export { summarizeArchiveRunClassifications } from "./archive-run-diagnostics.js";
export type { ArchiveRunClassificationSummary } from "./archive-run-diagnostics.js";
export {
  DEFAULT_STRATEGY_HINT_HIGH_RETRY_ATTEMPT_SHARE,
  suggestArchiveRunStrategyHints,
} from "./archive-strategy-hints.js";
export type {
  ArchiveRunStrategyHints,
  DestinationBackpressureHint,
  DominantDataPlaneHint,
  StrategyHintConfidence,
  SuggestArchiveRunStrategyHintsInput,
  ZipGetObjectConcurrencyHint,
} from "./archive-strategy-hints.js";
export {
  estimatePipelineOverlapRatio,
  MAX_PIPELINE_OVERLAP_RATIO_CAP,
  suggestZipConcurrencyFromCompletedRun,
} from "./archive-concurrency-advice.js";
export type {
  SuggestZipConcurrencyFromCompletedRunInput,
  ZipConcurrencyAdvice,
} from "./archive-concurrency-advice.js";
export { estimateArchiveRunS3Usd } from "./s3-archive-run-cost.js";
export type {
  ArchiveRunS3UsdEstimate,
  EstimateArchiveRunS3UsdInput,
} from "./s3-archive-run-cost.js";
export {
  DEFAULT_KMS_USD_PER_10K_REQUESTS,
  estimateKmsRequestCostUsd,
} from "./kms-request-cost.js";
export {
  buildPrefixTreeFromKeys,
  countPrefixTreeKeys,
  createPrefixTreeRoot,
  insertKeyIntoPrefixTree,
} from "./prefix-tree.js";
export type { PrefixTreeNode } from "./prefix-tree.js";
export {
  DEFAULT_BROWSER_MAX_OBJECT_COUNT,
  DEFAULT_BROWSER_MAX_TOTAL_BYTES,
  recommendArchiveExecutionSurface,
} from "./hybrid-archive-surface.js";
export type {
  ArchiveExecutionSurface,
  ArchiveExecutionSurfaceRecommendation,
  RecommendArchiveExecutionSurfaceInput,
} from "./hybrid-archive-surface.js";
export { ArchivePluginRegistry } from "./archive-plugin-registry.js";
export { suggestedCacheControlForArchiveDownload } from "./archive-cdn-hints.js";
export type { SuggestedCacheControlForArchiveOptions } from "./archive-cdn-hints.js";
export { summarizeArchiveControlPlaneSnapshot } from "./archive-control-plane.js";
export type {
  ArchiveControlPlaneSnapshot,
  SummarizeArchiveControlPlaneSnapshotInput,
} from "./archive-control-plane.js";
export {
  ArchiveJobIdConflictError,
  ArchiveJobFailedError,
  ArchiveJobNotCompletedError,
  ArchiveJobNotFoundError,
  InMemoryArchiveJobRegistry,
} from "./archive-background-jobs.js";
export type {
  ArchiveBackgroundJobSnapshot,
  ArchiveJobErrorSnapshot,
  CreateArchiveBackgroundJobOptions,
} from "./archive-background-jobs.js";

/**
 * Create a readable byte stream of the archive. Errors surface as `error` on the stream.
 * Pipe to an HTTP response, file, or S3 multipart upload body.
 */
export function createFolderArchiveStream(
  options: CreateFolderArchiveStreamOptions,
): Readable {
  const out = new PassThrough();
  void pumpArchiveToWritable(out, options).catch((e) =>
    out.destroy(e instanceof Error ? e : new Error(String(e))),
  );
  return out;
}
