import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  verifyLocalArchiveFileBytesMatchStats,
  verifyS3ObjectBytesMatchArchiveStats,
} from "../src/archive-output-verify.js";

describe("archive-output-verify", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("verifyLocalArchiveFileBytesMatchStats succeeds when sizes match", async () => {
    const p = join(tmpdir(), `s3prefix-archive-verify-${Date.now()}.bin`);
    const buf = Buffer.alloc(42, 7);
    await writeFile(p, buf);
    try {
      const r = await verifyLocalArchiveFileBytesMatchStats(p, {
        bytesWritten: buf.length,
      });
      expect(r.ok).toBe(true);
      expect(r.expectedBytes).toBe(42);
      expect(r.actualBytes).toBe(42);
      expect(r.deltaBytes).toBe(0);
    } finally {
      await unlink(p).catch(() => {});
    }
  });

  it("verifyLocalArchiveFileBytesMatchStats fails on mismatch", async () => {
    const p = join(tmpdir(), `s3prefix-archive-verify-bad-${Date.now()}.bin`);
    await writeFile(p, Buffer.from("ab"));
    try {
      const r = await verifyLocalArchiveFileBytesMatchStats(p, {
        bytesWritten: 99,
      });
      expect(r.ok).toBe(false);
      expect(r.actualBytes).toBe(2);
      expect(r.deltaBytes).toBe(2 - 99);
      expect(r.reason).toBeDefined();
    } finally {
      await unlink(p).catch(() => {});
    }
  });

  it("verifyLocalArchiveFileBytesMatchStats respects toleranceBytes", async () => {
    const p = join(tmpdir(), `s3prefix-archive-verify-tol-${Date.now()}.bin`);
    await writeFile(p, Buffer.from("x"));
    try {
      const r = await verifyLocalArchiveFileBytesMatchStats(
        p,
        { bytesWritten: 2 },
        { toleranceBytes: 1 },
      );
      expect(r.ok).toBe(true);
    } finally {
      await unlink(p).catch(() => {});
    }
  });

  it("verifyS3ObjectBytesMatchArchiveStats uses HeadObject ContentLength", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 100 });
    const client = new S3Client({});
    const r = await verifyS3ObjectBytesMatchArchiveStats(
      client,
      { bucket: "b", key: "k.zip" },
      { bytesWritten: 100 },
    );
    expect(r.ok).toBe(true);
    expect(r.actualBytes).toBe(100);
  });

  it("verifyS3ObjectBytesMatchArchiveStats fails when HeadObject length mismatches", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 5 });
    const client = new S3Client({});
    const r = await verifyS3ObjectBytesMatchArchiveStats(
      client,
      { bucket: "b", key: "k.zip" },
      { bytesWritten: 10 },
    );
    expect(r.ok).toBe(false);
    expect(r.deltaBytes).toBe(-5);
  });

  it("verifyS3ObjectBytesMatchArchiveStats rejects non-finite ContentLength", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: Number.NaN });
    const client = new S3Client({});
    const r = await verifyS3ObjectBytesMatchArchiveStats(
      client,
      { bucket: "b", key: "k.zip" },
      { bytesWritten: 10 },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/finite non-negative/);
  });
});
