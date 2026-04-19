# Architecture & concepts

## Data plane

s3-archive-download implements a **streaming data plane**:

1. **Discover objects** — `ListObjectsV2` (or merged roots, prepared NDJSON, or injected `StorageProvider.listObjects`).
2. **Filter & schedule** — glob / size / optional `predicate`; optional checkpoint skip; optional dedupe and `deltaBaseline`.
3. **GetObject** — byte streams with retries, optional MD5 verify, optional transforms.
4. **Encode** — ZIP (`yazl`) or tar / tar.gz (`tar-stream`), with format-specific concurrency rules.
5. **Sink** — `Writable` (file, HTTP response, multipart upload body, discard sink for benchmarks).

Backpressure is propagated with **`stream/promises.pipeline`** (and related mechanics) so a slow consumer slows producers instead of buffering unbounded data in memory.

## Stages and stats

Runs expose **`ArchiveStats`**: list vs download vs archive-encoding time (occupancy-style attribution under load), retry counts, optional rolling throughput samples, and optional Prometheus observation on completion.

Use **`explain: true`** for structured step traces; for huge prefixes prefer **`onExplainStep`** over buffering the full trace.

## Failure modes

- **`failureMode: 'fail-fast'`** (default) — first terminal error aborts the run.
- **`failureMode: 'best-effort'`** — collect **`omissions`** for failed objects; you may persist them as a dead-letter list.

See [Errors and codes](errors.md) for **`S3ArchiveError`** and `describeArchiveFailure`.

## What the library does not do

- **Orchestration** — no built-in global queue, cost caps, or multi-tenant isolation; you integrate with your scheduler (BullMQ helpers are optional).
- **Authorization** — IAM and application-level allowlists are **your** responsibility; see [IAM & selective exports](guides/iam-selective-exports.md).
- **Full-archive cryptographic digest** — optional per-object ETag MD5 verify exists; whole-archive hashing is out of scope unless you add it downstream.

## Design principles (summary)

The root [README § Design principles](../README.md#design-principles) states: injectable behavior, optional entrypoints, advisory helpers (cost, hybrid browser vs server hint), and **authorization scope at the call site**.
