import { describe, expect, it } from "vitest";
import { mergeAbortSignalWithTimeout } from "../src/abort-signal-util.js";

describe("mergeAbortSignalWithTimeout", () => {
  it("returns undefined when no signal and no timeout", () => {
    expect(mergeAbortSignalWithTimeout(undefined, undefined)).toBeUndefined();
  });

  it("returns only timeout signal when base is undefined", () => {
    const s = mergeAbortSignalWithTimeout(undefined, 50_000);
    expect(s).toBeDefined();
    expect(s!.aborted).toBe(false);
  });

  it("aborts when timeout elapses", async () => {
    const s = mergeAbortSignalWithTimeout(undefined, 20);
    await new Promise<void>((resolve, reject) => {
      s!.addEventListener("abort", () => resolve(), { once: true });
      setTimeout(() => reject(new Error("not aborted")), 2000);
    });
    expect(s!.aborted).toBe(true);
  });
});
