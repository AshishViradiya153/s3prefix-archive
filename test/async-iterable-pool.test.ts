import { describe, expect, it } from "vitest";
import {
  forEachAsyncIterablePool,
  forEachAsyncIterablePriorityPool,
} from "../src/async-iterable-pool.js";

async function* range(n: number): AsyncGenerator<number> {
  for (let i = 0; i < n; i++) {
    yield i;
  }
}

describe("forEachAsyncIterablePool", () => {
  it("runs all items with bounded concurrency", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const seen: number[] = [];

    await forEachAsyncIterablePool(range(20), 4, async (i) => {
      current += 1;
      maxConcurrent = Math.max(maxConcurrent, current);
      seen.push(i);
      await new Promise((r) => setTimeout(r, 2));
      current -= 1;
    });

    expect(seen.length).toBe(20);
    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });
});

describe("forEachAsyncIterablePriorityPool", () => {
  async function* nums(...values: number[]): AsyncGenerator<number> {
    for (const v of values) yield v;
  }

  it("schedules higher-priority items first (small-first via negative size)", async () => {
    const order: number[] = [];
    await forEachAsyncIterablePriorityPool(
      nums(100, 1, 50),
      1,
      (n) => -n,
      10,
      async (n) => {
        order.push(n);
      },
    );
    expect(order).toEqual([1, 50, 100]);
  });

  it("uses FIFO among equal scores", async () => {
    const order: string[] = [];
    await forEachAsyncIterablePriorityPool(
      (async function* () {
        yield "a";
        yield "b";
        yield "c";
      })(),
      1,
      () => 0,
      10,
      async (s) => {
        order.push(s);
      },
    );
    expect(order).toEqual(["a", "b", "c"]);
  });
});
