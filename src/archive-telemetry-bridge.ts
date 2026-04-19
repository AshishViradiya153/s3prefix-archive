import { EventEmitter } from "node:events";
import type {
  ArchiveS3RetryContext,
  ArchiveSlowGetObjectStreamInfo,
  CreateFolderArchiveStreamOptions,
} from "./types.js";

/** All S3 retries (List/Get), after any user `retry.onRetry`. */
export const ARCHIVE_TELEMETRY_EVENT_S3_RETRY = "archive:s3-retry" as const;

/** Subset where {@link ArchiveS3RetryContext.kind} is `throttle`, after any `retry.onS3ThrottleRetry`. */
export const ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY =
  "archive:s3-throttle-retry" as const;

/** One event per object when {@link CreateFolderArchiveStreamOptions.onSlowGetObjectStream} fires. */
export const ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM =
  "archive:slow-get-object-stream" as const;

export type ArchiveTelemetryEventName =
  | typeof ARCHIVE_TELEMETRY_EVENT_S3_RETRY
  | typeof ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY
  | typeof ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM;

export interface CreateArchiveTelemetryBridgeResult {
  /**
   * Subscribe with `on` / `once`. Payload types: {@link ArchiveS3RetryContext} for retry events,
   * {@link ArchiveSlowGetObjectStreamInfo} for slow-stream.
   */
  readonly emitter: EventEmitter;
  /**
   * Returns a shallow copy of `options` with `retry` / slow-stream callbacks wrapped so the
   * `emitter` receives the same signals (user callbacks run first).
   */
  augmentArchivePumpOptions(
    options: CreateFolderArchiveStreamOptions,
  ): CreateFolderArchiveStreamOptions;
}

/**
 * Optional **Node {@link EventEmitter}** wiring for archive telemetry: duplicates
 * `retry.onRetry`, `retry.onS3ThrottleRetry`, and `onSlowGetObjectStream` onto named channels for
 * dashboards or tests. Does not replace callbacks—composes with them.
 */
export function createArchiveTelemetryBridge(): CreateArchiveTelemetryBridgeResult {
  const emitter = new EventEmitter();
  return {
    emitter,
    augmentArchivePumpOptions(
      options: CreateFolderArchiveStreamOptions,
    ): CreateFolderArchiveStreamOptions {
      const r = options.retry;
      const prevOnSlow = options.onSlowGetObjectStream;
      const hasSlow =
        options.slowGetObjectReadBytesPerSecondThreshold != null &&
        options.slowGetObjectReadBytesPerSecondThreshold > 0 &&
        prevOnSlow != null;
      return {
        ...options,
        retry: {
          ...r,
          onRetry: (ctx: ArchiveS3RetryContext) => {
            r?.onRetry?.(ctx);
            emitter.emit(ARCHIVE_TELEMETRY_EVENT_S3_RETRY, ctx);
          },
          onS3ThrottleRetry: (ctx: ArchiveS3RetryContext) => {
            r?.onS3ThrottleRetry?.(ctx);
            emitter.emit(ARCHIVE_TELEMETRY_EVENT_S3_THROTTLE_RETRY, ctx);
          },
        },
        onSlowGetObjectStream: hasSlow
          ? (info: ArchiveSlowGetObjectStreamInfo) => {
              prevOnSlow!(info);
              emitter.emit(
                ARCHIVE_TELEMETRY_EVENT_SLOW_GET_OBJECT_STREAM,
                info,
              );
            }
          : prevOnSlow,
      };
    },
  };
}
