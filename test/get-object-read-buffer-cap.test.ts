import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES,
  wrapReadableWithReadBufferHighWaterMark,
} from "../src/get-object-read-buffer-cap.js";

describe("wrapReadableWithReadBufferHighWaterMark", () => {
  it("preserves byte length through the pass-through", async () => {
    const buf = Buffer.alloc(50_000, 7);
    const wrapped = wrapReadableWithReadBufferHighWaterMark(
      Readable.from(buf),
      GET_OBJECT_READ_BUFFER_HWM_MIN_BYTES * 4,
    );
    const chunks: Buffer[] = [];
    for await (const c of wrapped) {
      chunks.push(c as Buffer);
    }
    expect(Buffer.concat(chunks).length).toBe(buf.length);
  });
});
