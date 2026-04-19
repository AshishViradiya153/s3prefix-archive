import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { Logger } from "pino";
import type {
  ArchiveS3RetryContext,
  ObjectMeta,
  StorageProvider,
} from "./types.js";
import {
  classifyAwsS3RetryKind,
  isRetryableAwsError,
  withRetry,
} from "./retry.js";
import type { FailedAttemptError } from "p-retry";
import { toNodeReadable } from "./node-readable.js";
import { mergeAbortSignalWithTimeout } from "./abort-signal-util.js";
import { S3ArchiveError } from "./errors.js";
import { s3RequestFailed } from "./s3-request-failure.js";

/** Mutable counters incremented after successful S3 commands (for {@link ArchiveStats}). */
export interface S3StorageProviderRequestCounters {
  listObjectsV2Requests: number;
  getObjectRequests: number;
}

export interface S3StorageProviderExtras {
  /** Incremented after each successful `ListObjectsV2` / `GetObject` `client.send`. */
  requestCounters?: S3StorageProviderRequestCounters;
  /** Merged into each command's abort signal (see {@link CreateFolderArchiveStreamOptions.s3RequestTimeoutMs}). */
  requestTimeoutMs?: number;
}

function errorOutline(err: Error): {
  name?: string;
  message?: string;
  code?: string;
} {
  const e = err as Error & NodeJS.ErrnoException;
  return {
    name: typeof e.name === "string" ? e.name : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
  };
}

export class S3StorageProvider implements StorageProvider {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly listDefaults: { maxKeys: number; delimiter?: string },
    private readonly retry: {
      maxAttempts?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      signal?: AbortSignal;
      onS3Retry?: (ctx: ArchiveS3RetryContext) => void;
    },
    private readonly log: Logger,
    private readonly extras: S3StorageProviderExtras = {},
  ) {}

  #effectiveSignal(base?: AbortSignal): AbortSignal | undefined {
    return mergeAbortSignalWithTimeout(
      base ?? this.retry.signal,
      this.extras.requestTimeoutMs,
    );
  }

  async *listObjects(
    prefix: string,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ObjectMeta> {
    const signal = this.#effectiveSignal(options?.signal);
    let ContinuationToken: string | undefined;
    do {
      let resp;
      try {
        resp = await withRetry(
          async () =>
            this.client.send(
              new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: prefix || undefined,
                Delimiter: this.listDefaults.delimiter,
                MaxKeys: this.listDefaults.maxKeys,
                ContinuationToken,
              }),
              { abortSignal: signal },
            ),
          {
            maxAttempts: this.retry.maxAttempts,
            baseDelayMs: this.retry.baseDelayMs,
            maxDelayMs: this.retry.maxDelayMs,
            signal,
            onRetry: (failed: FailedAttemptError, scheduledDelayMs: number) => {
              this.retry.onS3Retry?.({
                operation: "listObjectsV2",
                attemptNumber: failed.attemptNumber,
                retriesLeft: failed.retriesLeft,
                kind: classifyAwsS3RetryKind(failed),
                error: failed,
                delayMs: scheduledDelayMs,
                bucket: this.bucket,
                prefix,
              });
              this.log.debug(
                {
                  op: "ListObjectsV2",
                  bucket: this.bucket,
                  prefix,
                  attempt: failed.attemptNumber,
                  delayMs: scheduledDelayMs,
                  retriesLeft: failed.retriesLeft,
                  kind: classifyAwsS3RetryKind(failed),
                  ...errorOutline(failed),
                },
                "s3 ListObjectsV2 retry scheduled",
              );
              this.log.warn(
                {
                  err: failed,
                  attempt: failed.attemptNumber,
                  delayMs: scheduledDelayMs,
                  op: "ListObjectsV2",
                  bucket: this.bucket,
                },
                "S3 ListObjectsV2 retry",
              );
            },
          },
        );
      } catch (e) {
        if (e instanceof S3ArchiveError) throw e;
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof Error) {
          throw s3RequestFailed({
            operation: "listObjectsV2",
            bucket: this.bucket,
            prefix,
            cause: e,
          });
        }
        throw e;
      }
      if (this.extras.requestCounters) {
        this.extras.requestCounters.listObjectsV2Requests += 1;
      }
      const contents = resp.Contents ?? [];
      let keysThisPage = 0;
      for (const c of contents) {
        if (!c.Key) continue;
        keysThisPage += 1;
      }
      this.log.debug(
        {
          op: "ListObjectsV2",
          bucket: this.bucket,
          prefix,
          keysThisPage,
          truncated: Boolean(resp.IsTruncated),
        },
        "s3 ListObjectsV2 page",
      );
      for (const c of contents) {
        if (!c.Key) continue;
        yield {
          key: c.Key,
          size: Number(c.Size ?? 0),
          etag: c.ETag?.replaceAll('"', ""),
          lastModified: c.LastModified,
        };
      }
      ContinuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (ContinuationToken);
  }

  async getObjectStream(
    key: string,
    options?: { signal?: AbortSignal; bucket?: string },
  ): Promise<Readable> {
    const signal = this.#effectiveSignal(options?.signal);
    const b = options?.bucket ?? this.bucket;
    this.log.debug({ op: "GetObject", bucket: b, key }, "s3 GetObject request");
    let out;
    try {
      out = await withRetry(
        async () => {
          const r = await this.client.send(
            new GetObjectCommand({ Bucket: b, Key: key }),
            { abortSignal: signal },
          );
          return toNodeReadable(r.Body, `GetObject s3://${b}/${key}`);
        },
        {
          maxAttempts: this.retry.maxAttempts,
          baseDelayMs: this.retry.baseDelayMs,
          maxDelayMs: this.retry.maxDelayMs,
          signal,
          isRetryable: isRetryableAwsError,
          onRetry: (failed: FailedAttemptError, scheduledDelayMs: number) => {
            this.retry.onS3Retry?.({
              operation: "getObject",
              attemptNumber: failed.attemptNumber,
              retriesLeft: failed.retriesLeft,
              kind: classifyAwsS3RetryKind(failed),
              error: failed,
              delayMs: scheduledDelayMs,
              bucket: b,
              key,
            });
            this.log.debug(
              {
                op: "GetObject",
                bucket: b,
                key,
                attempt: failed.attemptNumber,
                delayMs: scheduledDelayMs,
                retriesLeft: failed.retriesLeft,
                kind: classifyAwsS3RetryKind(failed),
                ...errorOutline(failed),
              },
              "s3 GetObject retry scheduled",
            );
            this.log.warn(
              {
                err: failed,
                attempt: failed.attemptNumber,
                delayMs: scheduledDelayMs,
                op: "GetObject",
                bucket: b,
                key,
              },
              "S3 GetObject retry",
            );
          },
        },
      );
    } catch (e) {
      if (e instanceof S3ArchiveError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw e;
      if (e instanceof Error) {
        throw s3RequestFailed({
          operation: "getObject",
          bucket: b,
          key,
          cause: e,
        });
      }
      throw e;
    }
    if (this.extras.requestCounters) {
      this.extras.requestCounters.getObjectRequests += 1;
    }
    this.log.debug(
      { op: "GetObject", bucket: b, key },
      "s3 GetObject stream open",
    );
    return out;
  }
}
