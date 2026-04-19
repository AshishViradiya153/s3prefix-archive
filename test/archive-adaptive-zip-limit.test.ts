import { describe, expect, it, vi, afterEach } from "vitest";
import { AdaptiveZipGetObjectLimit } from "../src/archive-adaptive-zip-limit.js";

describe("AdaptiveZipGetObjectLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never exceeds initial cap", async () => {
    const a = new AdaptiveZipGetObjectLimit(3, 0, 0);
    let running = 0;
    let maxRunning = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        a.limit(async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((r) => setImmediate(r));
          running--;
        }),
      ),
    );
    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(a.getCap()).toBe(3);
    expect(a.getMinCapObserved()).toBe(3);
    a.dispose();
  });

  it("lowers cap on throttle and tracks min observed", () => {
    const a = new AdaptiveZipGetObjectLimit(4, 0, 0);
    expect(a.getCap()).toBe(4);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(3);
    expect(a.getMinCapObserved()).toBe(3);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(2);
    expect(a.getMinCapObserved()).toBe(2);
    a.dispose();
  });

  it("does not go below 1", () => {
    const a = new AdaptiveZipGetObjectLimit(2, 0, 0);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(1);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(1);
    a.dispose();
  });

  it("recovers toward max after quiet window (fake timers)", () => {
    vi.useFakeTimers();
    const a = new AdaptiveZipGetObjectLimit(3, 1000, 400);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(a.getCap()).toBe(3);
    a.dispose();
  });

  it("tracks peak waiter queue depth and peak active concurrency", async () => {
    const a = new AdaptiveZipGetObjectLimit(1, 0, 0);
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const running = a.limit(async () => {
      await hold;
    });
    await new Promise<void>((r) => {
      setImmediate(r);
    });
    const queued = [a.limit(async () => {}), a.limit(async () => {})];
    await new Promise<void>((r) => {
      setImmediate(r);
    });
    expect(a.getMaxActiveConcurrent()).toBe(1);
    expect(a.getMaxWaiterQueueDepth()).toBe(2);
    release!();
    await Promise.all([running, ...queued]);
    a.dispose();
  });

  it("dispose clears recovery timer", () => {
    vi.useFakeTimers();
    const a = new AdaptiveZipGetObjectLimit(2, 500, 100);
    a.onThrottleRetry();
    expect(a.getCap()).toBe(1);
    a.dispose();
    vi.advanceTimersByTime(10_000);
    expect(a.getCap()).toBe(1);
  });
});
