import { S3ArchiveError } from "./errors.js";
import { GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES } from "./get-object-read-buffer-cap.js";
import type {
  ArchiveFormat,
  CreateFolderArchiveStreamOptions,
} from "./types.js";

/**
 * Context for rules that depend on resolved format / concurrency / list topology (after the URI
 * and `additionalListSources` are parsed).
 */
export interface ArchivePumpCrossCutValidationInput {
  options: CreateFolderArchiveStreamOptions;
  format: ArchiveFormat;
  zipConcurrency: number;
  /** True when `additionalListSources` yielded at least one extra root. */
  multiRoot: boolean;
}

/**
 * Validate cross-cutting pump options that are not covered by {@link ArchivePumpResolvedOptions.from}
 * (format/concurrency/dedupe). Call once per run after URI and extra list roots are known.
 */
export function assertCrossCutArchivePumpOptions(
  input: ArchivePumpCrossCutValidationInput,
): void {
  const { options, format, zipConcurrency, multiRoot } = input;

  if (multiRoot && options.preparedIndexNdjson) {
    throw new S3ArchiveError(
      "additionalListSources cannot be used with preparedIndexNdjson",
      "UNSUPPORTED_OPTION",
    );
  }
  if (options.storageProvider != null && multiRoot) {
    throw new S3ArchiveError(
      "storageProvider cannot be used with additionalListSources",
      "UNSUPPORTED_OPTION",
    );
  }

  assertMaxInFlightReadBytesOption(options.maxInFlightReadBytes);

  if (
    options.experimentalAdaptiveZipConcurrency &&
    options.experimentalThroughputAdaptiveZipConcurrency
  ) {
    throw new S3ArchiveError(
      "experimentalAdaptiveZipConcurrency cannot be combined with experimentalThroughputAdaptiveZipConcurrency.",
      "UNSUPPORTED_OPTION",
    );
  }

  if (options.experimentalAdaptiveZipConcurrency) {
    if (format !== "zip") {
      throw new S3ArchiveError(
        'experimentalAdaptiveZipConcurrency is only supported when format is "zip".',
        "UNSUPPORTED_OPTION",
      );
    }
    if (zipConcurrency < 2) {
      throw new S3ArchiveError(
        "experimentalAdaptiveZipConcurrency requires ZIP concurrency >= 2 (nothing to adapt at 1).",
        "UNSUPPORTED_OPTION",
      );
    }
  }

  if (options.experimentalThroughputAdaptiveZipConcurrency) {
    if (format !== "zip") {
      throw new S3ArchiveError(
        'experimentalThroughputAdaptiveZipConcurrency is only supported when format is "zip".',
        "UNSUPPORTED_OPTION",
      );
    }
    if (zipConcurrency < 2) {
      throw new S3ArchiveError(
        "experimentalThroughputAdaptiveZipConcurrency requires ZIP concurrency >= 2 (nothing to adapt at 1).",
        "UNSUPPORTED_OPTION",
      );
    }
    const rollMs = options.statsThroughputRollingWindowMs;
    if (rollMs == null || rollMs <= 0) {
      throw new S3ArchiveError(
        "experimentalThroughputAdaptiveZipConcurrency requires statsThroughputRollingWindowMs > 0.",
        "UNSUPPORTED_OPTION",
      );
    }
  }

  const slowTh = options.slowGetObjectReadBytesPerSecondThreshold;
  const slowCb = options.onSlowGetObjectStream;
  if ((slowTh != null) !== (slowCb != null)) {
    throw new S3ArchiveError(
      "slowGetObjectReadBytesPerSecondThreshold and onSlowGetObjectStream must both be set or both omitted.",
      "UNSUPPORTED_OPTION",
    );
  }
  if (slowTh != null && (!Number.isFinite(slowTh) || slowTh <= 0)) {
    throw new S3ArchiveError(
      "slowGetObjectReadBytesPerSecondThreshold must be a finite number > 0 when set.",
      "UNSUPPORTED_OPTION",
    );
  }

  const readHwm = options.getObjectReadBufferHighWaterMark;
  if (readHwm != null) {
    if (
      !Number.isFinite(readHwm) ||
      readHwm < GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES
    ) {
      throw new S3ArchiveError(
        `getObjectReadBufferHighWaterMark must be a finite number >= ${GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES} when set.`,
        "UNSUPPORTED_OPTION",
      );
    }
  }
}

/** Standalone check for {@link CreateFolderArchiveStreamOptions.maxInFlightReadBytes}. */
export function assertMaxInFlightReadBytesOption(
  maxInFlightReadBytes: number | undefined,
): void {
  if (maxInFlightReadBytes == null) return;
  if (!Number.isFinite(maxInFlightReadBytes) || maxInFlightReadBytes < 1) {
    throw new S3ArchiveError(
      "maxInFlightReadBytes must be a finite number >= 1 when set.",
      "UNSUPPORTED_OPTION",
    );
  }
}
