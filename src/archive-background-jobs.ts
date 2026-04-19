import type { ArchiveJobStatus, PumpArchiveResult } from "./types.js";

/** Serialized error fields for a failed background job. */
export interface ArchiveJobErrorSnapshot {
  name: string;
  message: string;
  stack?: string;
}

/** Snapshot of an in-memory archive job (see {@link InMemoryArchiveJobRegistry.getStatus}). */
export interface ArchiveBackgroundJobSnapshot {
  jobId: string;
  status: ArchiveJobStatus;
  createdAtMs: number;
  updatedAtMs: number;
  /** Present when {@link ArchiveBackgroundJobSnapshot.status} is `completed`. */
  result?: PumpArchiveResult;
  /** Present when {@link ArchiveBackgroundJobSnapshot.status} is `failed`. */
  error?: ArchiveJobErrorSnapshot;
}

export interface CreateArchiveBackgroundJobOptions {
  /**
   * Stable id (e.g. matches {@link RunFolderArchiveJobOptions.checkpoint.jobId}).
   * Must be unique within this registry instance.
   */
  jobId?: string;
  /** Async work that completes when the archive is fully written (e.g. `runFolderArchiveToS3`). */
  run: () => Promise<PumpArchiveResult>;
}

function toErrorSnapshot(err: unknown): ArchiveJobErrorSnapshot {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Error", message: String(err) };
}

function copySnapshot(
  internal: ArchiveBackgroundJobSnapshot,
): ArchiveBackgroundJobSnapshot {
  return {
    jobId: internal.jobId,
    status: internal.status,
    createdAtMs: internal.createdAtMs,
    updatedAtMs: internal.updatedAtMs,
    result: internal.result,
    error: internal.error,
  };
}

/** No job with this id is registered. */
export class ArchiveJobNotFoundError extends Error {
  override readonly name = "ArchiveJobNotFoundError";
  readonly code = "ARCHIVE_JOB_NOT_FOUND" as const;
  constructor(readonly jobId: string) {
    super(`Archive job not found: ${jobId}`);
  }
}

/** {@link InMemoryArchiveJobRegistry.downloadResult} called before the job finished successfully. */
export class ArchiveJobNotCompletedError extends Error {
  override readonly name = "ArchiveJobNotCompletedError";
  readonly code = "ARCHIVE_JOB_NOT_COMPLETED" as const;
  constructor(
    readonly jobId: string,
    readonly status: ArchiveJobStatus,
  ) {
    super(`Archive job ${jobId} is not completed (status: ${status})`);
  }
}

/** Job ended with `failed` status. */
export class ArchiveJobFailedError extends Error {
  override readonly name = "ArchiveJobFailedError";
  readonly code = "ARCHIVE_JOB_FAILED" as const;
  constructor(
    readonly jobId: string,
    readonly snapshot: ArchiveBackgroundJobSnapshot,
  ) {
    const msg = snapshot.error?.message ?? "Archive job failed";
    super(msg);
  }
}

/** {@link InMemoryArchiveJobRegistry.createJob} was given a `jobId` that already exists. */
export class ArchiveJobIdConflictError extends Error {
  override readonly name = "ArchiveJobIdConflictError";
  readonly code = "ARCHIVE_JOB_ID_CONFLICT" as const;
  constructor(readonly jobId: string) {
    super(`Archive job id already in use: ${jobId}`);
  }
}

/** In-process job registry (`createJob`, `getStatus`, `downloadResult`). For durable jobs use a queue (e.g. BullMQ). */
export class InMemoryArchiveJobRegistry {
  private readonly jobs = new Map<string, ArchiveBackgroundJobSnapshot>();

  /** Queues work and starts `run` asynchronously; returns `jobId` (generated if omitted). */
  createJob(options: CreateArchiveBackgroundJobOptions): { jobId: string } {
    const jobId =
      options.jobId ??
      `archive-job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    if (this.jobs.has(jobId)) {
      throw new ArchiveJobIdConflictError(jobId);
    }
    const now = Date.now();
    const snap: ArchiveBackgroundJobSnapshot = {
      jobId,
      status: "queued",
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.jobs.set(jobId, snap);
    queueMicrotask(() => {
      void this.runJob(jobId, options.run);
    });
    return { jobId };
  }

  private async runJob(
    jobId: string,
    run: () => Promise<PumpArchiveResult>,
  ): Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      return;
    }
    entry.status = "running";
    entry.updatedAtMs = Date.now();
    try {
      const result = await run();
      const e = this.jobs.get(jobId);
      if (!e) {
        return;
      }
      e.status = "completed";
      e.result = result;
      e.updatedAtMs = Date.now();
    } catch (err) {
      const e = this.jobs.get(jobId);
      if (!e) {
        return;
      }
      e.status = "failed";
      e.error = toErrorSnapshot(err);
      e.updatedAtMs = Date.now();
    }
  }

  /** Latest snapshot for the job, or `undefined` if unknown. */
  getStatus(jobId: string): ArchiveBackgroundJobSnapshot | undefined {
    const internal = this.jobs.get(jobId);
    return internal ? copySnapshot(internal) : undefined;
  }

  /**
   * Returns the pump result when `status` is `completed`.
   * @throws {ArchiveJobNotFoundError} Unknown id
   * @throws {ArchiveJobNotCompletedError} Still queued or running
   * @throws {ArchiveJobFailedError} Terminal failure
   */
  downloadResult(jobId: string): PumpArchiveResult {
    const internal = this.jobs.get(jobId);
    if (!internal) {
      throw new ArchiveJobNotFoundError(jobId);
    }
    if (internal.status === "failed") {
      throw new ArchiveJobFailedError(jobId, copySnapshot(internal));
    }
    if (internal.status !== "completed" || internal.result === undefined) {
      throw new ArchiveJobNotCompletedError(jobId, internal.status);
    }
    return internal.result;
  }

  /** Clears all jobs from this registry. */
  clear(): void {
    this.jobs.clear();
  }
}
