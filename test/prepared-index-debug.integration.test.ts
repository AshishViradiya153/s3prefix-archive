import { describe, expect, it, beforeEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { streamPrefixIndexNdjson } from "../src/prepared-index.js";

describe("streamPrefixIndexNdjson debug", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it("logs sampled prepared-index progress at debug", async () => {
    const chunks: Buffer[] = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    const logger = pino({ level: "debug" }, logStream);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "pre/a.txt", Size: 1, ETag: '"e"' }],
      IsTruncated: false,
    });

    const gen = streamPrefixIndexNdjson({
      source: "s3://bucket/pre/",
      client: new S3Client({}),
      debug: true,
      logger,
    });
    const linesOut: string[] = [];
    for await (const line of gen) {
      linesOut.push(line);
    }
    expect(linesOut.length).toBeGreaterThanOrEqual(1);

    const raw = Buffer.concat(chunks).toString("utf8").trim();
    const msgs = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { msg?: string }).msg);

    expect(msgs.some((m) => m === "prepared index progress")).toBe(true);
    expect(msgs.some((m) => String(m).includes("s3 ListObjectsV2 page"))).toBe(
      true,
    );
  });
});
