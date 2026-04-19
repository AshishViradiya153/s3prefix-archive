import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import {
  parseS3SinglePartEtagMd5Hex,
  pipeThroughEtagMd5Verifier,
} from "../src/etag-md5-verify.js";

describe("parseS3SinglePartEtagMd5Hex", () => {
  it("parses quoted 32-hex ETag", () => {
    expect(
      parseS3SinglePartEtagMd5Hex('"d41d8cd98f00b204e9800998ecf8427e"'),
    ).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("returns null for multipart ETag", () => {
    expect(parseS3SinglePartEtagMd5Hex('"abc123-2"')).toBeNull();
  });
});

describe("pipeThroughEtagMd5Verifier", () => {
  it("passes when stream matches ETag MD5", async () => {
    const payload = Buffer.from("hello", "utf8");
    const hex = createHash("md5").update(payload).digest("hex");
    const r = Readable.from([payload]);
    const out = pipeThroughEtagMd5Verifier(r, hex, { key: "k" });
    const chunks: Buffer[] = [];
    for await (const c of out) {
      chunks.push(c as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("errors when bytes do not match ETag", async () => {
    const r = Readable.from([Buffer.from("a")]);
    const out = pipeThroughEtagMd5Verifier(
      r,
      "d41d8cd98f00b204e9800998ecf8427e",
      { key: "k" },
    );
    await expect(async () => {
      for await (const _ of out) {
        /* drain */
      }
    }).rejects.toMatchObject({ code: "GET_OBJECT_ETAG_MISMATCH" });
  });
});
