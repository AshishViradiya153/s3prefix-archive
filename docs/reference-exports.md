# Reference: exports & modules

**Source of truth:** every symbol and option field is in the published declarations — `dist/index.d.ts`, `dist/platform.d.ts`, `dist/bullmq.d.ts`, `dist/gcs.d.ts`, `dist/azure-blob.d.ts` (under `node_modules/s3-archive-download/` after install). The tables below are **representative**, not a complete catalog.

**`package.json` `exports` paths** (only these exist):

| User import                      | Build output        |
| -------------------------------- | ------------------- |
| `s3-archive-download`            | `dist/index.*`      |
| `s3-archive-download/platform`   | `dist/platform.*`   |
| `s3-archive-download/bullmq`     | `dist/bullmq.*`     |
| `s3-archive-download/gcs`        | `dist/gcs.*`        |
| `s3-archive-download/azure-blob` | `dist/azure-blob.*` |

## `s3-archive-download` (default)

Canonical export list: **`src/index.ts`** (published as **`dist/index.d.ts`**). The table below groups **real** exports; it is still not exhaustive.

| Area                                | Exports                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream / file                       | `createFolderArchiveStream`, `pumpArchiveToWritable`, `downloadFolderToFile`, `downloadFolderAsArchive`, `resumeFolderArchiveToFile`, `resumeFolderArchiveToWritable`                                                                                                                       |
| Prepared index                      | `prepareFolderArchiveIndexToFile`, `streamPrefixIndexNdjson`, `createPreparedIndexReadable`, `downloadFolderToFileFromPreparedIndex`, `iterateObjectMetaFromNdjsonIndex`                                                                                                                    |
| S3 URI / clients                    | `parseS3Uri`, `S3StorageProvider`, `signGetObjectDownloadUrl`, `signGetObjectDownloadUrls`                                                                                                                                                                                                  |
| In-tree storage                     | `MemoryStorageProvider` (optional `storageProvider`; default remains S3 when omitted)                                                                                                                                                                                                       |
| Checkpoints                         | `FileCheckpointStore`, `RedisCheckpointStore`, `SqlTableCheckpointStore`, `assertAdditionalListSourcesMatchCheckpoint`, `parseAdditionalListSources`, `canonicalizeAdditionalListSources`, `ArchiveCheckpointCoordinator`, …                                                                |
| Filters / paths                     | `globFiltersForExtensions`, `keyMatchesFilterPattern`, `shouldIncludeObject`, `isDirectoryPlaceholder`, `buildEntryMappingLookup`, `assertSafeArchivePath`, `defaultEntryName`                                                                                                              |
| Errors / retry                      | `S3ArchiveError`, `PathUnsafeError`, `isS3ArchiveError`, `isPathUnsafeError`, `describeArchiveFailure`, `summarizeErrorCauses`, `s3RequestFailed`, `classifyTerminalS3Failure`, `withRetry`, `classifyAwsS3RetryKind`, `isRetryableAwsError`, …                                             |
| Stats / bottleneck                  | `classifyArchiveBottleneck`, `computeArchiveStageOccupancyShares`, `ArchiveStageOccupancyMeter`, `wrapAsyncIterableWithListStage`, throughput helpers (`createArchiveThroughputSampler`, `classifyThroughputReadWritePace`, …)                                                              |
| Prometheus                          | `DEFAULT_PROMETHEUS_METRIC_PREFIX`, `observeArchiveCompletion`, `observePreparedIndexLine` (also driven by **`PreparedIndexOptions.prometheus`** when listing to NDJSON)                                                                                                                    |
| Cost / workload USD                 | `computeS3WorkloadUnits`, `estimateS3ApiRequestCostUsd`, `estimateDataTransferOutCostUsd`, `estimateArchiveRunS3Usd`, `estimateKmsRequestCostUsd`, `usdPerRequestFromPerThousand`, `usdPerGibToUsdPerByte`, `BYTES_PER_GIB`, …                                                              |
| Strategy / advisory                 | `suggestArchiveRunStrategyHints`, `summarizeArchiveRunClassifications`, `classifyArchiveWorkloadSize`, `classifyArchiveRetryStress`, `recommendArchiveExecutionSurface`, `suggestZipConcurrencyFromCompletedRun`, `estimatePipelineOverlapRatio`, `summarizeArchiveControlPlaneSnapshot`, … |
| Post-run checks                     | `verifyLocalArchiveFileBytesMatchStats`, `verifyS3ObjectBytesMatchArchiveStats`                                                                                                                                                                                                             |
| HTTP / CDN                          | `suggestedCacheControlForArchiveDownload`                                                                                                                                                                                                                                                   |
| Extensibility                       | `ArchivePluginRegistry`                                                                                                                                                                                                                                                                     |
| Adaptive ZIP / backpressure helpers | `AdaptiveZipGetObjectLimit`, `ThroughputZipAdaptiveController`, `createInFlightReadByteLimiter`, `createDestinationDownloadGate`, `assertCrossCutArchivePumpOptions`, …                                                                                                                     |
| Telemetry                           | `createArchiveTelemetryBridge`, `ARCHIVE_TELEMETRY_EVENT_*`, `wrapReadableWithSlowGetObjectMonitor`, `wrapReadableWithReadBufferHighWaterMark`, `SLOW_GET_OBJECT_MIN_BYTES`, `SLOW_GET_OBJECT_MIN_ELAPSED_MS`, `GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES`, …                                    |
| Background jobs                     | `InMemoryArchiveJobRegistry`, `ArchiveJobIdConflictError`, `ArchiveJobFailedError`, `ArchiveJobNotCompletedError`, `ArchiveJobNotFoundError`                                                                                                                                                |
| Benchmark                           | `createBenchmarkDiscardWritable`                                                                                                                                                                                                                                                            |
| Prefix tree                         | `buildPrefixTreeFromKeys`, `countPrefixTreeKeys`, `createPrefixTreeRoot`, `insertKeyIntoPrefixTree`                                                                                                                                                                                         |
| Dedupe / manifest                   | `objectContentFingerprint`, `encodeArchiveManifestJsonUtf8`                                                                                                                                                                                                                                 |
| Advanced (same entry)               | `ArchivePumpFlowEngine`, `ArchivePumpResolvedOptions`, `ArchiveObjectProcessor`, `ZipArchiveSink`, `TarArchiveSink`, `forEachAsyncIterablePool`, `forEachAsyncIterablePriorityPool`, `toNodeReadable`, `mergeAbortSignalWithTimeout`, `createExclusiveRunner`, …                            |

Anything not listed here is still discoverable from **`dist/index.d.ts`**.

## `s3-archive-download/platform` (`src/platform.ts`)

- **`runFolderArchiveToS3`** — multipart upload to S3 (requires `@aws-sdk/lib-storage`).
- **`runFolderArchiveToWritable`** — same pump to an arbitrary `Writable`.
- Re-exports: **`FileCheckpointStore`**, **`SqlTableCheckpointStore`**, checkpoint/SQL types, **`resolveArchiveContentType`**, **`resolveArchiveLogger`**, **`resolveLogger`**, and the same **in-memory archive job** errors/registry types as the main entry (`ArchiveJobIdConflictError`, …, **`InMemoryArchiveJobRegistry`**).

## `s3-archive-download/bullmq` (`src/bullmq.ts`)

- **`FOLDER_ARCHIVE_TO_S3_JOB_NAME`**, **`DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME`**
- **`FolderArchiveToS3JobData`**, **`FolderArchiveJobRunContext`**
- **`folderArchiveJobDataToRunOptions`**, **`createFolderArchiveToS3Processor`**, **`enqueueFolderArchiveToS3`**
- **`CreateFolderArchiveToS3ProcessorOptions`**
- Type **`ArchiveJobResult`**

Requires the **`bullmq`** peer where you run workers.

## `s3-archive-download/gcs` (`src/gcs.ts`)

- **`GcsStorageProvider`** (+ options type)

## `s3-archive-download/azure-blob` (`src/azure-blob.ts`)

- **`AzureBlobStorageProvider`** (+ options type)

## CLI

Implemented in **`src/cli.ts`**: subcommands **`archive`**, **`index`**, **`benchmark`**. See [CLI guide](guides/cli.md).
