import { describe, expect, it } from "vitest";
import { Registry } from "prom-client";
import {
  observeArchiveCompletion,
  observePreparedIndexLine,
} from "../src/prometheus.js";

describe("prometheus helpers", () => {
  it("registers archive metrics once and records observations", async () => {
    const register = new Registry();
    const integration = { register, prefix: "test_s3_arch" };
    observeArchiveCompletion(integration, {
      format: "zip",
      failureMode: "fail-fast",
      stats: {
        objectsListed: 10,
        objectsIncluded: 7,
        objectsSkipped: 3,
        bytesRead: 1000,
        bytesWritten: 800,
        listMs: 1,
        downloadMs: 2,
        archiveWriteMs: 3,
        stageIdleMs: 0,
        retries: 2,
        bottleneck: "archive-write",
        s3ListObjectsV2Requests: 2,
        s3GetObjectRequests: 7,
        s3RetriesListObjectsV2: 1,
        s3RetriesGetObject: 1,
        s3WorkloadUnits: 2 + 7 + 0.25 * 2,
        zipGetObjectMaxQueueDepth: 3,
        zipGetObjectMaxActiveConcurrent: 4,
        destinationDrainWaits: 5,
        destinationDrainEventCount: 12,
      },
      wallSeconds: 1.5,
    });
    observeArchiveCompletion(integration, {
      format: "zip",
      failureMode: "fail-fast",
      stats: {
        objectsListed: 2,
        objectsIncluded: 2,
        objectsSkipped: 0,
        bytesRead: 50,
        bytesWritten: 40,
        listMs: 0,
        downloadMs: 0,
        archiveWriteMs: 0,
        retries: 0,
        bottleneck: "even",
      },
      wallSeconds: 0.2,
    });
    const text = await register.metrics();
    expect(text).toContain("test_s3_arch_objects_listed_total");
    expect(text).toContain("test_s3_arch_wall_duration_seconds");
    expect(text).toContain("test_s3_arch_s3_list_objects_requests_total");
    expect(text).toContain("test_s3_arch_s3_get_object_requests_total");
    expect(text).toContain("test_s3_arch_s3_retries_list_objects_total");
    expect(text).toContain("test_s3_arch_s3_retries_get_object_total");
    expect(text).toContain("test_s3_arch_archive_stage_occupancy_seconds");
    expect(text).toContain("test_s3_arch_s3_workload_units");
    expect(text).toContain("test_s3_arch_zip_get_object_max_queue_depth");
    expect(text).toContain("test_s3_arch_zip_get_object_max_active_concurrent");
    expect(text).toContain("test_s3_arch_destination_drain_waits_total");
    expect(text).toContain("test_s3_arch_destination_drain_events_total");
    expect(text).toContain("test_s3_arch_run_classifications_total");
    expect(text).toContain('workload_size="many-small"');
    expect(text).toContain('retry_stress="moderate"');
    expect(text).toContain('retry_stress="na"');
    expect(text).toContain('failure_mode="fail-fast"');
  });

  it("increments prepared index line counter", async () => {
    const register = new Registry();
    const integration = { register, prefix: "idx_test" };
    observePreparedIndexLine(integration);
    observePreparedIndexLine(integration);
    const text = await register.metrics();
    expect(text).toContain("idx_test_prepared_index_lines_total");
    const line = text
      .split("\n")
      .find((l) => l.startsWith("idx_test_prepared_index_lines_total "));
    expect(line?.trim().endsWith("2")).toBe(true);
  });
});
