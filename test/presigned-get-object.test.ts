import { describe, expect, it, vi, beforeEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://example.invalid/presigned"),
}));

describe("presigned-get-object", () => {
  beforeEach(async () => {
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    vi.mocked(getSignedUrl).mockClear();
  });

  it("signGetObjectDownloadUrl delegates to getSignedUrl", async () => {
    const { signGetObjectDownloadUrl } =
      await import("../src/presigned-get-object.js");
    const client = new S3Client({ region: "us-east-1" });
    const url = await signGetObjectDownloadUrl(
      client,
      { bucket: "b", key: "k/a.txt" },
      120,
    );
    expect(url).toBe("https://example.invalid/presigned");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    expect(getSignedUrl).toHaveBeenCalledOnce();
  });

  it("signGetObjectDownloadUrls returns one entry per key", async () => {
    const { signGetObjectDownloadUrls } =
      await import("../src/presigned-get-object.js");
    const client = new S3Client({ region: "us-east-1" });
    const rows = await signGetObjectDownloadUrls(client, "b", ["a", "b"], 60);
    expect(rows).toEqual([
      { key: "a", url: "https://example.invalid/presigned" },
      { key: "b", url: "https://example.invalid/presigned" },
    ]);
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });
});
