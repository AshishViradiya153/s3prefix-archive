import { describe, expect, it, vi } from "vitest";
import {
  buildRetryBackoffTimeouts,
  classifyAwsS3RetryKind,
  isRetryableAwsError,
  withRetry,
} from "../src/retry.js";

describe("isRetryableAwsError", () => {
  it("returns true for 503", () => {
    expect(isRetryableAwsError({ $metadata: { httpStatusCode: 503 } })).toBe(
      true,
    );
  });

  it("returns false for 403", () => {
    expect(isRetryableAwsError({ $metadata: { httpStatusCode: 403 } })).toBe(
      false,
    );
  });

  it("returns false for non-objects", () => {
    expect(isRetryableAwsError(null)).toBe(false);
    expect(isRetryableAwsError("x")).toBe(false);
  });

  it("retries throttle-shaped errors aligned with classifyAwsS3RetryKind", () => {
    expect(isRetryableAwsError({ name: "RequestLimitExceeded" })).toBe(true);
    expect(isRetryableAwsError({ name: "TooManyRequestsException" })).toBe(
      true,
    );
  });
});

describe("classifyAwsS3RetryKind", () => {
  it("classifies 429 as throttle", () => {
    expect(classifyAwsS3RetryKind({ $metadata: { httpStatusCode: 429 } })).toBe(
      "throttle",
    );
  });

  it("classifies 503 as server-error", () => {
    expect(classifyAwsS3RetryKind({ $metadata: { httpStatusCode: 503 } })).toBe(
      "server-error",
    );
  });

  it("classifies ThrottlingException by name", () => {
    expect(classifyAwsS3RetryKind({ name: "ThrottlingException" })).toBe(
      "throttle",
    );
  });

  it("classifies TimeoutError", () => {
    expect(classifyAwsS3RetryKind({ name: "TimeoutError" })).toBe("timeout");
  });
});

describe("withRetry", () => {
  it("returns first success", async () => {
    const fn = vi.fn().mockResolvedValueOnce(42);
    await expect(withRetry(fn, { maxAttempts: 3 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const e503 = Object.assign(new Error("503"), {
      $metadata: { httpStatusCode: 503 },
    });
    const fn = vi.fn().mockRejectedValueOnce(e503).mockResolvedValueOnce("ok");
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("passes FailedAttemptError and scheduled delay to onRetry", async () => {
    const e503 = Object.assign(new Error("503"), {
      $metadata: { httpStatusCode: 503 },
    });
    const seen: {
      attemptNumber: number;
      retriesLeft: number;
      delayMs: number;
    }[] = [];
    const fn = vi.fn().mockRejectedValueOnce(e503).mockResolvedValueOnce("ok");
    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 500,
      onRetry: (err, delayMs) => {
        seen.push({
          attemptNumber: err.attemptNumber,
          retriesLeft: err.retriesLeft,
          delayMs,
        });
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.attemptNumber).toBe(1);
    expect(seen[0]!.retriesLeft).toBe(2);
    expect(seen[0]!.delayMs).toBeGreaterThanOrEqual(1);
    expect(seen[0]!.delayMs).toBeLessThanOrEqual(500);
  });
});

describe("buildRetryBackoffTimeouts", () => {
  it("returns sorted delays matching retry count", () => {
    const t = buildRetryBackoffTimeouts(3, 2, 100, 10_000, false);
    expect(t).toHaveLength(3);
    expect(t[0]).toBeLessThanOrEqual(t[1]!);
    expect(t[1]).toBeLessThanOrEqual(t[2]!);
  });
});
