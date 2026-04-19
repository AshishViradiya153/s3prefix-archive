import { describe, expect, it, vi } from "vitest";
import {
  ArchiveJobFailedError,
  ArchiveJobIdConflictError,
  ArchiveJobNotCompletedError,
  ArchiveJobNotFoundError,
  InMemoryArchiveJobRegistry,
} from "../src/archive-background-jobs.js";
import type { ArchiveJobResult, ArchiveStats } from "../src/types.js";

const baseStats = {
  objectsListed: 1,
  objectsIncluded: 1,
  objectsSkipped: 0,
  bytesRead: 10,
  bytesWritten: 10,
  listMs: 0,
  downloadMs: 1,
  archiveWriteMs: 1,
  retries: 0,
  bottleneck: "download" as const,
  s3ListObjectsV2Requests: 1,
  s3GetObjectRequests: 1,
} as ArchiveStats;

function sampleResult(jobId: string): ArchiveJobResult {
  return {
    jobId,
    bucket: "my-bucket",
    key: "out.zip",
    stats: baseStats,
    omissions: [],
  };
}

describe("InMemoryArchiveJobRegistry", () => {
  it("runs createJob → getStatus → downloadResult for a successful run", async () => {
    const registry = new InMemoryArchiveJobRegistry();
    let resolveRun!: (v: ArchiveJobResult) => void;
    const p = new Promise<ArchiveJobResult>((res) => {
      resolveRun = res;
    });
    const { jobId } = registry.createJob({ run: () => p });
    expect(registry.getStatus(jobId)?.status).toBe("queued");
    resolveRun(sampleResult(jobId));
    await vi.waitFor(() =>
      expect(registry.getStatus(jobId)?.status).toBe("completed"),
    );
    const r = registry.downloadResult(jobId) as ArchiveJobResult;
    expect(r.bucket).toBe("my-bucket");
    expect(r.key).toBe("out.zip");
  });

  it("marks failed and downloadResult throws ArchiveJobFailedError", async () => {
    const registry = new InMemoryArchiveJobRegistry();
    const { jobId } = registry.createJob({
      run: async () => {
        throw new Error("boom");
      },
    });
    await vi.waitFor(() =>
      expect(registry.getStatus(jobId)?.status).toBe("failed"),
    );
    expect(() => registry.downloadResult(jobId)).toThrow(ArchiveJobFailedError);
    try {
      registry.downloadResult(jobId);
    } catch (e) {
      expect(e).toBeInstanceOf(ArchiveJobFailedError);
      const snap = (e as ArchiveJobFailedError).snapshot;
      expect(snap.error?.message).toBe("boom");
    }
  });

  it("downloadResult throws when still running", async () => {
    const registry = new InMemoryArchiveJobRegistry();
    let finish!: () => void;
    const barrier = new Promise<void>((res) => {
      finish = res;
    });
    const { jobId } = registry.createJob({
      run: async () => {
        await barrier;
        return sampleResult(jobId);
      },
    });
    await vi.waitFor(() =>
      expect(registry.getStatus(jobId)?.status).toBe("running"),
    );
    expect(() => registry.downloadResult(jobId)).toThrow(
      ArchiveJobNotCompletedError,
    );
    finish();
    await vi.waitFor(() =>
      expect(registry.getStatus(jobId)?.status).toBe("completed"),
    );
    expect((registry.downloadResult(jobId) as ArchiveJobResult).key).toBe(
      "out.zip",
    );
  });

  it("throws ArchiveJobNotFoundError for unknown id", () => {
    const registry = new InMemoryArchiveJobRegistry();
    expect(() => registry.downloadResult("nope")).toThrow(
      ArchiveJobNotFoundError,
    );
  });

  it("throws ArchiveJobIdConflictError for duplicate jobId", () => {
    const registry = new InMemoryArchiveJobRegistry();
    registry.createJob({
      jobId: "same",
      run: async () => sampleResult("same"),
    });
    expect(() =>
      registry.createJob({
        jobId: "same",
        run: async () => sampleResult("same"),
      }),
    ).toThrow(ArchiveJobIdConflictError);
  });

  it("clear removes jobs", async () => {
    const registry = new InMemoryArchiveJobRegistry();
    const { jobId } = registry.createJob({
      run: async () => sampleResult(jobId),
    });
    await vi.waitFor(() =>
      expect(registry.getStatus(jobId)?.status).toBe("completed"),
    );
    registry.clear();
    expect(registry.getStatus(jobId)).toBeUndefined();
  });
});
