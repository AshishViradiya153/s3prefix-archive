import { describe, expect, it } from "vitest";
import {
  createInFlightReadByteLimiter,
  readReservationBytes,
} from "../src/in-flight-read-bytes.js";

describe("createInFlightReadByteLimiter", () => {
  it("serializes when two grants exceed max", async () => {
    const lim = createInFlightReadByteLimiter(150);
    const order: number[] = [];
    let releaseFirst!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const p1 = (async () => {
      await lim.acquire(100);
      order.push(1);
      await hold;
      lim.release(100);
    })();
    const p2 = (async () => {
      await lim.acquire(100);
      order.push(2);
      lim.release(100);
    })();
    await new Promise<void>((r) => queueMicrotask(r));
    expect(order).toEqual([1]);
    releaseFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("allows two grants when sum fits", async () => {
    const lim = createInFlightReadByteLimiter(250);
    let g1 = 0;
    let g2 = 0;
    await Promise.all([
      (async () => {
        g1 = await lim.acquire(100);
        lim.release(g1);
      })(),
      (async () => {
        g2 = await lim.acquire(100);
        lim.release(g2);
      })(),
    ]);
    expect(g1).toBe(100);
    expect(g2).toBe(100);
  });

  it("acquire(0) is a no-op", async () => {
    const lim = createInFlightReadByteLimiter(10);
    expect(await lim.acquire(0)).toBe(0);
    lim.release(0);
  });

  it("treats non-finite requested bytes as 0 (avoids NaN pool corruption)", async () => {
    const lim = createInFlightReadByteLimiter(100);
    expect(await lim.acquire(Number.NaN)).toBe(0);
    expect(await lim.acquire(Number.POSITIVE_INFINITY)).toBe(0);
    expect(await lim.acquire(-5)).toBe(0);
    expect(await lim.acquire(50)).toBe(50);
    lim.release(50);
  });
});

describe("readReservationBytes", () => {
  it("clamps positive size to cap", () => {
    expect(readReservationBytes({ key: "k", size: 999 }, 100)).toBe(100);
  });

  it("returns 0 for non-positive size", () => {
    expect(readReservationBytes({ key: "k", size: 0 }, 100)).toBe(0);
    expect(readReservationBytes({ key: "k", size: -1 }, 100)).toBe(0);
  });
});
