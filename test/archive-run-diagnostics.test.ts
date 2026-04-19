import { describe, expect, it } from "vitest";
import { summarizeArchiveRunClassifications } from "../src/archive-run-diagnostics.js";

describe("summarizeArchiveRunClassifications", () => {
  it("combines workload and retry stress and computes retryAttemptShare σ = r/(r+N_ok)", () => {
    const s = summarizeArchiveRunClassifications({
      objectsIncluded: 7,
      bytesRead: 7000,
      retries: 2,
      s3ListObjectsV2Requests: 2,
      s3GetObjectRequests: 7,
    });
    expect(s.workload.profile).toBe("many-small");
    expect(s.retryStress?.profile).toBe("moderate");
    const nOk = 9;
    const r = 2;
    expect(s.retryAttemptShare).toBeCloseTo(r / (r + nOk), 10);
  });

  it("omits retryAttemptShare when S3 request counts are absent", () => {
    const s = summarizeArchiveRunClassifications({
      objectsIncluded: 1,
      bytesRead: 100,
      retries: 0,
    });
    expect(s.retryStress).toBeNull();
    expect(s.retryAttemptShare).toBeUndefined();
  });
});
