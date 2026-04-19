import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type {
  ArchiveFormat,
  ArchiveStats,
  FailureMode,
  PrometheusIntegrationOptions,
} from "./types.js";
import { summarizeArchiveRunClassifications } from "./archive-run-diagnostics.js";

export const DEFAULT_PROMETHEUS_METRIC_PREFIX = "s3_archive_stream";

const WALL_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];

/** Seconds; occupancy-partitioned stage wall times (see `ArchiveStageOccupancyMeter`). */
const STAGE_OCC_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
  300, 600,
];

/** Dimensionless workload units per completed run (see `computeS3WorkloadUnits`). */
const WORKLOAD_BUCKETS = [
  0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000,
];

type ArchiveLabels = "format" | "failure_mode";

type StageLabels = ArchiveLabels | "stage";

type RunClassificationLabels = ArchiveLabels | "workload_size" | "retry_stress";

function normalizePrefix(prefix: string | undefined): string {
  const raw = (
    prefix?.trim() || DEFAULT_PROMETHEUS_METRIC_PREFIX
  ).toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.length > 0 ? cleaned : DEFAULT_PROMETHEUS_METRIC_PREFIX;
}

function metricName(prefix: string, suffix: string): string {
  return `${prefix}_${suffix}`;
}

function getLabeledCounter(
  register: Registry,
  name: string,
  help: string,
): Counter<ArchiveLabels> {
  const existing = register.getSingleMetric(name) as
    | Counter<ArchiveLabels>
    | undefined;
  if (existing) return existing;
  return new Counter<ArchiveLabels>({
    name,
    help,
    labelNames: ["format", "failure_mode"],
    registers: [register],
  });
}

function getLabeledGauge(
  register: Registry,
  name: string,
  help: string,
): Gauge<ArchiveLabels> {
  const existing = register.getSingleMetric(name) as
    | Gauge<ArchiveLabels>
    | undefined;
  if (existing) return existing;
  return new Gauge<ArchiveLabels>({
    name,
    help,
    labelNames: ["format", "failure_mode"],
    registers: [register],
  });
}

function getLabeledHistogram(
  register: Registry,
  name: string,
  help: string,
  buckets: number[],
): Histogram<ArchiveLabels> {
  const existing = register.getSingleMetric(name) as
    | Histogram<ArchiveLabels>
    | undefined;
  if (existing) return existing;
  return new Histogram<ArchiveLabels>({
    name,
    help,
    labelNames: ["format", "failure_mode"],
    buckets,
    registers: [register],
  });
}

function getRunClassificationCounter(
  register: Registry,
  prefix: string,
): Counter<RunClassificationLabels> {
  const name = metricName(prefix, "run_classifications_total");
  const existing = register.getSingleMetric(name) as
    | Counter<RunClassificationLabels>
    | undefined;
  if (existing) return existing;
  return new Counter({
    name,
    help: "Completed archive runs labeled by workload-size and retry-stress heuristics (see summarizeArchiveRunClassifications). retry_stress=na when S3 list/get counts are omitted.",
    labelNames: ["format", "failure_mode", "workload_size", "retry_stress"],
    registers: [register],
  });
}

function getStageHistogram(
  register: Registry,
  name: string,
  help: string,
  buckets: number[],
): Histogram<StageLabels> {
  const existing = register.getSingleMetric(name) as
    | Histogram<StageLabels>
    | undefined;
  if (existing) return existing;
  return new Histogram<StageLabels>({
    name,
    help,
    labelNames: ["format", "failure_mode", "stage"],
    buckets,
    registers: [register],
  });
}

function getPlainCounter(
  register: Registry,
  name: string,
  help: string,
): Counter {
  const existing = register.getSingleMetric(name) as Counter | undefined;
  if (existing) return existing;
  return new Counter({
    name,
    help,
    registers: [register],
  });
}

/**
 * Record archive run totals and wall-clock duration (call once per successful pump completion).
 * Also records occupancy stage seconds, optional ZIP limiter queue peaks, optional destination
 * drain wait/event totals when present on {@link ArchiveStats}, and workload histograms when present.
 */
export function observeArchiveCompletion(
  integration: PrometheusIntegrationOptions,
  params: {
    format: ArchiveFormat;
    failureMode: FailureMode;
    stats: ArchiveStats;
    wallSeconds: number;
  },
): void {
  const prefix = normalizePrefix(integration.prefix);
  const register = integration.register;
  const labels = {
    format: params.format,
    failure_mode: params.failureMode,
  };
  const s = params.stats;

  getLabeledCounter(
    register,
    metricName(prefix, "objects_listed_total"),
    "S3 objects seen from listing (before per-object filter decisions).",
  ).inc(labels, s.objectsListed);

  getLabeledCounter(
    register,
    metricName(prefix, "objects_included_total"),
    "Objects written into the archive.",
  ).inc(labels, s.objectsIncluded);

  getLabeledCounter(
    register,
    metricName(prefix, "objects_skipped_total"),
    "Objects skipped (filters, placeholders, checkpoint, best-effort omissions).",
  ).inc(labels, s.objectsSkipped);

  getLabeledCounter(
    register,
    metricName(prefix, "bytes_read_total"),
    "Bytes read from S3 object bodies (approximate where streamed).",
  ).inc(labels, s.bytesRead);

  getLabeledCounter(
    register,
    metricName(prefix, "bytes_written_total"),
    "Bytes written to the archive output stream.",
  ).inc(labels, s.bytesWritten);

  getLabeledCounter(
    register,
    metricName(prefix, "s3_retries_total"),
    "S3 List/Get retries (from provider retry policy).",
  ).inc(labels, s.retries);

  if (s.s3ListObjectsV2Requests != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "s3_list_objects_requests_total"),
      "Successful ListObjectsV2 client.send calls (pages).",
    ).inc(labels, s.s3ListObjectsV2Requests);
  }
  if (s.s3GetObjectRequests != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "s3_get_object_requests_total"),
      "Successful GetObject client.send calls.",
    ).inc(labels, s.s3GetObjectRequests);
  }
  if (s.s3RetriesListObjectsV2 != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "s3_retries_list_objects_total"),
      "ListObjectsV2 retries scheduled.",
    ).inc(labels, s.s3RetriesListObjectsV2);
  }
  if (s.s3RetriesGetObject != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "s3_retries_get_object_total"),
      "GetObject retries scheduled.",
    ).inc(labels, s.s3RetriesGetObject);
  }

  if (s.destinationDrainWaits != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "destination_drain_waits_total"),
      "Count of sink backpressure waits before starting a new GetObject (respectDestinationBackpressure).",
    ).inc(labels, s.destinationDrainWaits);
  }
  if (s.destinationDrainEventCount != null) {
    getLabeledCounter(
      register,
      metricName(prefix, "destination_drain_events_total"),
      "Destination Writable drain events observed during the run (trackDestinationDrainEvents).",
    ).inc(labels, s.destinationDrainEventCount);
  }

  getLabeledHistogram(
    register,
    metricName(prefix, "wall_duration_seconds"),
    "Wall-clock time for a full archive pump run (seconds).",
    WALL_BUCKETS,
  ).observe(labels, params.wallSeconds);

  const stageHist = getStageHistogram(
    register,
    metricName(prefix, "archive_stage_occupancy_seconds"),
    "Occupancy-partitioned wall time per stage (seconds); parallel ZIP splits overlap fairly.",
    STAGE_OCC_BUCKETS,
  );
  stageHist.observe({ ...labels, stage: "list" }, s.listMs / 1000);
  stageHist.observe({ ...labels, stage: "download" }, s.downloadMs / 1000);
  stageHist.observe({ ...labels, stage: "archive" }, s.archiveWriteMs / 1000);

  if (s.stageIdleMs != null && s.stageIdleMs > 0) {
    stageHist.observe({ ...labels, stage: "idle" }, s.stageIdleMs / 1000);
  }

  if (s.s3WorkloadUnits != null) {
    getLabeledHistogram(
      register,
      metricName(prefix, "s3_workload_units"),
      "Dimensionless S3 API workload score per run (see computeS3WorkloadUnits).",
      WORKLOAD_BUCKETS,
    ).observe(labels, s.s3WorkloadUnits);
  }

  if (s.zipGetObjectMaxQueueDepth != null) {
    getLabeledGauge(
      register,
      metricName(prefix, "zip_get_object_max_queue_depth"),
      "Peak FIFO depth waiting on the ZIP GetObject limiter (last completed run).",
    ).set(labels, s.zipGetObjectMaxQueueDepth);
  }
  if (s.zipGetObjectMaxActiveConcurrent != null) {
    getLabeledGauge(
      register,
      metricName(prefix, "zip_get_object_max_active_concurrent"),
      "Peak in-flight GetObject tasks on the ZIP limiter (last completed run).",
    ).set(labels, s.zipGetObjectMaxActiveConcurrent);
  }

  let workloadSize = "unknown";
  let retryStressLabel = "na";
  try {
    const summary = summarizeArchiveRunClassifications(s);
    workloadSize = summary.workload.profile;
    retryStressLabel = summary.retryStress?.profile ?? "na";
  } catch {
    workloadSize = "unknown";
    retryStressLabel = "na";
  }
  getRunClassificationCounter(register, prefix).inc({
    ...labels,
    workload_size: workloadSize,
    retry_stress: retryStressLabel,
  });
}

/** Increment by one for each NDJSON line emitted from {@link streamPrefixIndexNdjson}. */
export function observePreparedIndexLine(
  integration: PrometheusIntegrationOptions,
): void {
  const prefix = normalizePrefix(integration.prefix);
  getPlainCounter(
    integration.register,
    metricName(prefix, "prepared_index_lines_total"),
    "NDJSON lines emitted from prepared prefix index streaming.",
  ).inc();
}
