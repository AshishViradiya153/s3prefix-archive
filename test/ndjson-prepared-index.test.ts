import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { iterateObjectMetaFromNdjsonIndex } from "../src/ndjson-prepared-index.js";

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("iterateObjectMetaFromNdjsonIndex", () => {
  it("parses valid NDJSON lines and skips blanks", async () => {
    const input = new PassThrough();
    const iter = iterateObjectMetaFromNdjsonIndex(input, { keyPrefix: "p/" });
    input.write(
      '{"key":"p/a.txt","size":3,"etag":"abc","lastModified":"2020-01-01T00:00:00.000Z"}\n\n{"key":"p/b.txt","size":0}\n',
    );
    input.end();
    const rows = await collect(iter);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "p/a.txt", size: 3, etag: "abc" });
    expect(rows[0]?.lastModified?.toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );
    expect(rows[1]).toMatchObject({ key: "p/b.txt", size: 0 });
  });

  it("throws PREPARED_INDEX_KEY_PREFIX_MISMATCH", async () => {
    const input = new PassThrough();
    const iter = iterateObjectMetaFromNdjsonIndex(input, {
      keyPrefix: "good/",
    });
    input.write('{"key":"other/x","size":1}\n');
    input.end();
    await expect(collect(iter)).rejects.toMatchObject({
      code: "PREPARED_INDEX_KEY_PREFIX_MISMATCH",
    });
  });

  it("throws INVALID_PREPARED_INDEX_LINE for bad JSON", async () => {
    const input = new PassThrough();
    const iter = iterateObjectMetaFromNdjsonIndex(input, { keyPrefix: "" });
    input.write("not json\n");
    input.end();
    await expect(collect(iter)).rejects.toMatchObject({
      code: "INVALID_PREPARED_INDEX_LINE",
    });
  });

  it("allows any key when keyPrefix is empty", async () => {
    const input = new PassThrough();
    const iter = iterateObjectMetaFromNdjsonIndex(input, { keyPrefix: "" });
    input.write('{"key":"anywhere/x","size":2}\n');
    input.end();
    const rows = await collect(iter);
    expect(rows[0]?.key).toBe("anywhere/x");
  });
});
