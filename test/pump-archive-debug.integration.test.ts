import { describe, expect, it, beforeEach } from "vitest";
import { Writable } from "node:stream";
import { Readable } from "node:stream";
import pino from "pino";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import { pumpArchiveToWritable } from "../src/pump-archive.js";

describe("pumpArchiveToWritable debug tracing", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("emits structured debug for list page, getObject, object lifecycle, and stage breakdown", async () => {
    const chunks: Buffer[] = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });

    const logger = pino({ level: "debug" }, logStream);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "pre/place/", Size: 0 },
        { Key: "pre/file.bin", Size: 3, ETag: '"x"' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStreamMixin(Readable.from(Buffer.from("abc"))),
    });

    const dest = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });

    await pumpArchiveToWritable(dest, {
      source: "s3://bucket/pre/",
      format: "zip",
      client: new S3Client({}),
      debug: true,
      logger,
      concurrency: 1,
    });

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    const lines = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { msg?: string });
    const msgs = lines.map((l) => String(l.msg ?? ""));

    expect(msgs.some((m) => m.includes("s3 ListObjectsV2 page"))).toBe(true);
    expect(msgs.some((m) => m.includes("s3 GetObject request"))).toBe(true);
    expect(msgs.some((m) => m.includes("s3 GetObject stream open"))).toBe(true);
    expect(
      msgs.filter((m) => m === "archive object skip").length,
    ).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m === "archive object start")).toBe(true);
    expect(msgs.some((m) => m === "archive object done")).toBe(true);
    expect(msgs.some((m) => m === "archive pump stage breakdown")).toBe(true);
  });
});
