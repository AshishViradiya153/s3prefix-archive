import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  toNodeReadable,
  type GetObjectBodyInput,
} from "../src/node-readable.js";

describe("toNodeReadable", () => {
  it("passes through Node Readable", () => {
    const r = Readable.from(["x"]);
    expect(toNodeReadable(r as GetObjectBodyInput, "test")).toBe(r);
  });

  it("wraps web ReadableStream", async () => {
    const web = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([97, 98]));
        controller.close();
      },
    });
    const node = toNodeReadable(web as GetObjectBodyInput, "test");
    const chunks: Buffer[] = [];
    for await (const c of node) {
      chunks.push(c as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe("ab");
  });

  it("throws on null", () => {
    expect(() => {
      // @ts-expect-error Runtime may yield null Body though SDK typings omit it
      toNodeReadable(null, "ctx");
    }).toThrow(/empty Body/);
  });
});
