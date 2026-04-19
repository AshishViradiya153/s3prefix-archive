<div align="center">

# s3-archive-download

[![npm version](https://img.shields.io/npm/v/s3-archive-download?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/s3-archive-download)
[![CI](https://img.shields.io/github/actions/workflow/status/AshishViradiya153/s3download/ci.yml?branch=main&logo=github&label=CI&style=flat-square)](https://github.com/AshishViradiya153/s3download/actions/workflows/ci.yml?query=branch%3Amain)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square&logo=opensourceinitiative&logoColor=white)](https://github.com/AshishViradiya153/s3download/blob/main/LICENSE)

</div>

**s3-archive-download** is a Node.js library for **streaming an Amazon S3 prefix into a ZIP, tar, or tar.gz archive** with paginated listing, `GetObject` as byte streams, and **`stream/promises.pipeline`** so backpressure propagates end to end. It is built for production workloads: retries, checkpoints, optional multipart upload of the archive back to S3, NDJSON prepared indexes, metrics (including Prometheus), and a small CLI.

The package uses a **modular layout**: the default entry covers listing, archiving, and file/HTTP sinks; optional subpaths add multipart upload (`s3-archive-download/platform`), BullMQ helpers (`s3-archive-download/bullmq`), and cloud **`StorageProvider`** adapters (`s3-archive-download/gcs`, `s3-archive-download/azure-blob`). TypeScript types ship with the package—open `dist/*.d.ts` or use your editor’s IntelliSense after `npm install s3-archive-download`.

Source code and issues: **[github.com/AshishViradiya153/s3download](https://github.com/AshishViradiya153/s3download)**.

**Full documentation** (guides for checkpoints, IAM, prepared index, platform/BullMQ, CLI, troubleshooting): **[docs/README.md](docs/README.md)** — also shipped under `node_modules/s3-archive-download/docs/` after install.

# Table of Contents

1. [Getting Started](#getting-started)
2. [Installation](#installation)
3. [Package structure](#package-structure)
4. [Usage](#usage)
5. [Streaming to a local file](#streaming-to-a-local-file)
6. [Download in one call](#download-in-one-call)
7. [Checkpoints and resume](#checkpoints-and-resume)
8. [Prepared NDJSON index](#prepared-ndjson-index)
9. [Selective files, multiple folders, and IAM](#selective-files-multiple-folders-and-iam)
10. [Express (HTTP response)](#express-http-response)
11. [Upload archive to S3 (multipart)](#upload-archive-to-s3-multipart)
12. [Lambda: upload and verify](#lambda-upload-and-verify)
13. [BullMQ: worker with verification](#bullmq-worker-with-verification)
14. [Presigned GET URLs (browser-oriented)](#presigned-get-urls-browser-oriented)
15. [Command line interface](#command-line-interface)
16. [Configuration and credentials](#configuration-and-credentials)
17. [Design principles](#design-principles)
18. [Debug and explain](#debug-and-explain)
19. [API overview](#api-overview)
20. [Engineering notes](#engineering-notes)
21. [Developing s3-archive-download](#developing-s3-archive-download)
22. [Publishing](#publishing)
23. [Giving feedback and contributing](#giving-feedback-and-contributing)
24. [License](#license)

## Getting Started

The following steps use **npm**. They assume you have a supported **Node.js** version installed (see [Installation](#installation)).

1. Create or open a Node.js project and install the package:

```bash
 npm install s3-archive-download
```

Adding the package updates your lock file. You **should** commit your lock file with your application code. See [package-lock.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json) for npm’s guidance.

2. Ensure AWS credentials are available to the SDK (environment, shared config, IAM role, etc.). Pass an **`S3Client`** into s3-archive-download options in production (see [Configuration and credentials](#configuration-and-credentials)).

3. Create a file (for example `archive.mjs` in a project with `"type": "module"`) that builds a ZIP from a prefix and writes it to disk:

```js
import { createWriteStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { createFolderArchiveStream } from "s3-archive-download";

const client = new S3Client({}); // region/credentials from your environment

const stream = createFolderArchiveStream({
  source: "s3://my-bucket/path/to/prefix/",
  format: "zip",
  client,
  onProgress: (p) => console.log(p.objectsIncluded, p.bytesWritten),
});

stream.pipe(createWriteStream("out.zip"));
stream.on("error", console.error);
```

4. Run it:

```bash
 node archive.mjs
```

For more patterns (resume, prepared index, uploading the archive to S3), continue with [Usage](#usage).

## Installation

**Runtime**

- **Node.js >= 20.19** (uses `Readable.fromWeb` for AWS SDK response bodies when needed; matches `engines` in `package.json`).

**Dependencies**

- `@aws-sdk/client-s3` is a **dependency** of s3-archive-download (installed transitively). Pin it in your app if you need a fixed major line, for example:
  ```bash
  npm install s3-archive-download @aws-sdk/client-s3@^3
  ```
- `[mime-types](https://github.com/jshttp/mime-types)` is used for `Content-Type` (HTTP responses and S3 multipart uploads via `resolveArchiveContentType`).

**Optional peer: multipart upload (`s3-archive-download/platform`)**

To stream an archive **to S3** using `@aws-sdk/lib-storage`’s multipart upload, install the peer yourself:

```bash
npm install @aws-sdk/lib-storage
```

`@aws-sdk/lib-storage` is **optional** so projects that only stream to a file or HTTP response are not forced to install it.

**Optional peer: BullMQ**

For the BullMQ worker helpers under `s3-archive-download/bullmq`, install `bullmq` in your worker project.

**Optional peers: GCS / Azure (`s3-archive-download/gcs`, `s3-archive-download/azure-blob`)**

To archive from **Google Cloud Storage** or **Azure Blob** via **`storageProvider`**, install the matching SDK:

```bash
npm install @google-cloud/storage
# or
npm install @azure/storage-blob
```

Pass **`storageProvider: new GcsStorageProvider(bucket)`** (or **`AzureBlobStorageProvider(containerClient)`**) and keep **`source: "s3://&lt;bucket-or-container&gt;/prefix/"`** so the URI parser supplies prefix routing; data is read from GCS/Azure, not AWS.

**Contributors**

Use **Node 24** when developing this repository (see [.nvmrc](.nvmrc)): `nvm use && npm install`. This repo lists `[packageManager](https://nodejs.org/api/packages.html#packagemanager)`: **pnpm**—after `corepack enable`, use `pnpm install` and `pnpm run …` if you prefer.

## Package structure

s3-archive-download follows a **modular entry** pattern similar in spirit to per-service packages in AWS SDK for JavaScript v3: import only what you need.

| Import path                      | Role                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `s3-archive-download`            | Core: list → get → archive → your `Writable` or HTTP; file helpers; checkpoints; metrics; CLI binary `s3-archive-download`. |
| `s3-archive-download/platform`   | Multipart upload of the archive to S3 (`runFolderArchiveToS3`, checkpoint types, job helpers).                              |
| `s3-archive-download/bullmq`     | JSON-safe job payloads and processor for `runFolderArchiveToS3` (install `bullmq` peer).                                    |
| `s3-archive-download/gcs`        | `GcsStorageProvider` for **Google Cloud Storage** lists + reads (install `@google-cloud/storage` peer).                     |
| `s3-archive-download/azure-blob` | `AzureBlobStorageProvider` for **Azure Blob Storage** (install `@azure/storage-blob` peer).                                 |

Example:

```ts
import { createFolderArchiveStream } from "s3-archive-download";
import { runFolderArchiveToS3 } from "s3-archive-download/platform";
```

**Examples:** the repository includes runnable sketches for each major integration (core download, checkpoints, prepared index, explicit-key and multi-root IAM-style flows, HTTP, multipart upload, Lambda, BullMQ producer/worker, presigned URLs, GCS/Azure providers, Prometheus metrics, cost/strategy hints, in-memory demos). See [examples/README.md](examples/README.md).

## Usage

### Streaming to a local file

```ts
import { createWriteStream } from "node:fs";
import { createFolderArchiveStream } from "s3-archive-download";

const stream = createFolderArchiveStream({
  source: "s3://my-bucket/path/to/folder/",
  format: "zip",
  client: myS3Client,
  onProgress: (p) => console.log(p.objectsIncluded, p.bytesWritten),
});

stream.pipe(createWriteStream("out.zip"));
```

### Download in one call

```ts
import { downloadFolderToFile } from "s3-archive-download";

const { stats } = await downloadFolderToFile("out.zip", {
  source: "s3://my-bucket/path/to/folder/",
  format: "zip",
  client: myS3Client,
});
```

The alias **`downloadFolderAsArchive`** points to the same function.

### Checkpoints and resume

Use the same `jobId`, `CheckpointStore`, and `source` / `format` as the original run. Resume helpers validate scope so you do not append to the wrong job.

```ts
import {
  downloadFolderToFile,
  resumeFolderArchiveToFile,
  FileCheckpointStore,
} from "s3-archive-download";

const store = new FileCheckpointStore(".checkpoints");
const checkpoint = { jobId: "export-1", store };

await downloadFolderToFile("out.zip", {
  source: "s3://my-bucket/prefix/",
  format: "zip",
  client: myS3Client,
  checkpoint,
});

await resumeFolderArchiveToFile("out.zip", {
  source: "s3://my-bucket/prefix/",
  format: "zip",
  client: myS3Client,
  checkpoint,
});
```

**Other stores:** **`RedisCheckpointStore`** (JSON blob per job in Redis) and **`SqlTableCheckpointStore`** (Postgres, MySQL, or SQLite via a tiny **`SqlCheckpointClient`** adapter—bring your own `pg` / `mysql2` / `better-sqlite3` / ORM). Create a table with columns `job_id` (text PK) and `payload` (text, JSON body). See [src/sql-checkpoint-store.ts](src/sql-checkpoint-store.ts). For Postgres, a **`pg.Pool` → `SqlCheckpointClient`** sketch lives in [examples/sql-checkpoint-adapter.ts](examples/sql-checkpoint-adapter.ts).

### Prepared NDJSON index

List once to a file, then build the archive from that index (no second `ListObjectsV2`). Each line is one JSON object (`key`, `size`, optional `etag` / `lastModified`).

```ts
import {
  prepareFolderArchiveIndexToFile,
  downloadFolderToFileFromPreparedIndex,
} from "s3-archive-download";

await prepareFolderArchiveIndexToFile("prefix.ndjson", {
  source: "s3://my-bucket/prefix/",
  client: myS3Client,
});

await downloadFolderToFileFromPreparedIndex("out.zip", "prefix.ndjson", {
  source: "s3://my-bucket/prefix/",
  format: "zip",
  client: myS3Client,
});
```

For HTTP or custom pipelines, pass any `Readable` as `preparedIndexNdjson` on `createFolderArchiveStream` / `pumpArchiveToWritable` instead of listing live.

**Reuse the index between runs:** keep `prefix.ndjson` on disk or in object storage, then pass `fs.createReadStream("prefix.ndjson")` (or another `Readable`) as **`preparedIndexNdjson`** on later archives so you avoid a second **`ListObjectsV2`** until you refresh the file. Expiry / invalidation is operator-owned—s3-archive-download does not cache or TTL the NDJSON for you.

### Selective files, multiple folders, and IAM

s3-archive-download is built around **list → filter → get → encode**. AWS IAM is usually split between **`s3:ListBucket`** (often constrained with `Condition` `StringLike` on `s3:prefix`) and **`s3:GetObject`** on specific keys or prefixes. Your integration should match how your org grants those actions.

| Goal                                                                       | What s3-archive-download does                                                                                                                                                                                                       | IAM / operations note                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Only some objects under one prefix**                                     | Use **`filters.include`** / **`filters.exclude`** / **`filters.predicate`** (see [filters.ts](src/filters.ts)).                                                                                                                     | Listing still runs for the full **`source`** prefix; keys that fail the filter are skipped **after** list. You need **`ListBucket`** on that prefix (or a narrower `source` you are allowed to list).                                            |
| **Several disjoint “folders” (same or other buckets)**                     | Use **`additionalListSources`**: extra `s3://bucket/prefix/` roots merged after the primary list ([archive-pump-flow.ts](src/archive-pump-flow.ts)). Each object can carry **`ObjectMeta.bucket`** for the correct **`GetObject`**. | Incompatible with **`preparedIndexNdjson`**. Your role needs list + get on **every** root you pass.                                                                                                                                              |
| **No live listing during the archive** (catalog, DB, or ABAC decides keys) | Build NDJSON (or a stream) and pass **`preparedIndexNdjson`**. Only **`GetObject`** runs for lines in the file; **`ListObjectsV2` is skipped** for that run.                                                                        | Each line’s **`key`** must sit under the same **`source`** prefix ([ndjson-prepared-index.ts](src/ndjson-prepared-index.ts)). **`size`** should match **`Content-Length`** if you use **`maxInFlightReadBytes`** (reservations use listed size). |
| **Permissions are not expressible as one S3 list**                         | Your service resolves allowed keys, then either supplies **`preparedIndexNdjson`** or a custom **`StorageProvider`** whose **`listObjects`** yields only approved keys and **`getObjectStream`** calls S3.                          | **`MemoryStorageProvider`** is for tests; a thin adapter around **`S3Client`** is the usual production pattern for “list from our policy engine, get from S3”.                                                                                   |

**Checkpoints** store the primary prefix, optional **`additionalListSources`**, and completed keys—keep job scope aligned with what IAM allows on resume.

Repository examples:

- **Explicit keys (no live list during pump):** [examples/explicit-keys-prepared-index.ts](examples/explicit-keys-prepared-index.ts)
- **Multiple list roots + fail-fast validation:** [examples/additional-sources-multi-prefix.ts](examples/additional-sources-multi-prefix.ts)

### Express (HTTP response)

```ts
import { createFolderArchiveStream } from "s3-archive-download";

app.get("/export.zip", (req, res) => {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="export.zip"');
  const stream = createFolderArchiveStream({
    source: "s3://bucket/prefix/",
    format: "zip",
  });
  stream.on("error", (err) => {
    if (!res.headersSent) res.status(500);
    res.end(String(err.message));
  });
  stream.pipe(res);
});
```

### Upload archive to S3 (multipart)

```ts
import { runFolderArchiveToS3 } from "s3-archive-download/platform";

await runFolderArchiveToS3({
  source: "s3://src-bucket/folder/",
  format: "zip",
  output: {
    type: "s3-multipart",
    bucket: "dst-bucket",
    key: "exports/archive.zip",
  },
});
```

Requires `@aws-sdk/lib-storage` installed (see [Installation](#installation)).

### Lambda: upload and verify

For **AWS Lambda**, stream a prefix to a destination object with `runFolderArchiveToS3`, then confirm the object size with **`verifyS3ObjectBytesMatchArchiveStats`** (a cheap `HeadObject` against `stats.bytesWritten`). Grant **`s3:GetObject` on the destination key** for that step (IAM treats `HeadObject` like GET on the object). The repository includes an annotated handler you can adapt:

- `[examples/lambda-archive-to-s3.ts](examples/lambda-archive-to-s3.ts)`

Published imports:

```ts
import { verifyS3ObjectBytesMatchArchiveStats } from "s3-archive-download";
import { runFolderArchiveToS3 } from "s3-archive-download/platform";
```

### BullMQ: worker with verification

For a **Redis-backed queue**, use **`createFolderArchiveToS3Processor`** from `s3-archive-download/bullmq` on a BullMQ `Worker`. The repo shows a processor that wraps the default runner and fails the job if post-upload byte verification does not match (same **`s3:GetObject`** on the output object as in the Lambda section):

- `[examples/bullmq-archive-worker.ts](examples/bullmq-archive-worker.ts)`

Minimal shape (see the file for shutdown and env):

```ts
import { Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createFolderArchiveToS3Processor,
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
} from "s3-archive-download/bullmq";

const client = new S3Client({});
new Worker(
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
  createFolderArchiveToS3Processor({ client }),
  { connection: { host: "127.0.0.1", port: 6379 } },
);
```

Enqueue jobs with **`enqueueFolderArchiveToS3`** (same module); install the **`bullmq`** peer (see [Installation](#installation)).

### Presigned GET URLs (browser-oriented)

For UIs that must **not** hold long-lived AWS keys in the browser, issue **short-lived presigned GET URLs** on your API (IAM on the server role only). Use **`signGetObjectDownloadUrl`** / **`signGetObjectDownloadUrls`** from **`s3-archive-download`**, then let the client `fetch()` each URL and assemble a ZIP with a browser library (s3-archive-download is Node-first; it does not ship a browser bundle).

Before building a large client-side archive, call **`recommendArchiveExecutionSurface`** with rough **byte** and **object** estimates—it returns **`"browser"`** vs **`"server"`** with stable rationale strings (defaults favor server for big jobs).

```ts
import {
  recommendArchiveExecutionSurface,
  signGetObjectDownloadUrls,
} from "s3-archive-download";
import { S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({});
const keys = ["a/1.txt", "a/2.txt"]; // from your list/index step
const signed = await signGetObjectDownloadUrls(client, "my-bucket", keys, 900);
const hint = recommendArchiveExecutionSurface({
  totalBytesEstimate: 12_000_000,
  objectCountEstimate: keys.length,
});
```

Longer notes (TTL, batch sizing, hybrid thresholds): [docs/presigned-urls.md](docs/presigned-urls.md). Repository example: [examples/presigned-batch-sign.ts](examples/presigned-batch-sign.ts).

## Command line interface

Installing the package adds the **`s3-archive-download`** command (`package.json` **`bin`**). The published tarball already includes `dist/`, so you do **not** need to build locally to use the CLI after `npm install s3-archive-download`.

```bash
npx s3-archive-download archive --source s3://bucket/prefix/ -o out.zip
npx s3-archive-download index --source s3://bucket/prefix/ -o index.ndjson
```

**Benchmark** runs the same pipeline as the library but discards bytes so disk I/O does not dominate. Use **`--profile list`** to measure **ListObjectsV2 + NDJSON serialization** only (no `GetObject`).

When developing **this repository**, after `npm run build` (or `pnpm run build`):

```bash
npm run benchmark -- --source s3://bucket/prefix/ --format zip --json
npm run benchmark -- --source s3://bucket/prefix/ --profile list
```

Human-readable summaries go to **stderr**; **`--json`** prints one machine-readable line on **stdout**.

## Configuration and credentials

Pass an **`S3Client`** configured with your credential provider (environment variables, IAM role, SSO, etc.). Do not embed long-lived access keys in application code.

Reuse **one long-lived `S3Client`** across jobs or requests where possible so connections amortize TLS and DNS. When `client` is omitted, a new client is created from `clientConfig` for that run only. For concurrent List/Get under load, tune the HTTP stack (for example Node `https.Agent` `maxSockets`, `keepAlive`) via AWS SDK v3 `requestHandler` / `NodeHttpHandler` options on `clientConfig`.

See [AWS SDK for JavaScript v3 Developer Guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/) for credential and region configuration.

## Design principles

s3-archive-download is a **data-plane** library (list → get → encode → sink) with **hooks**, not a closed hosted platform.

- **You own policy**—where jobs run, how they are queued, cost limits, and how checkpoints are stored are your decisions. The library provides streaming, backpressure, stats, and **advisory** helpers (strategy hints, cost estimates, hybrid browser vs server recommendation); it does not replace your orchestration.
- **Important behavior is injectable**—`S3Client`, optional `StorageProvider`, `CheckpointStore`, `retry`, `AbortSignal`, `transformGetObjectBody`, `filters`, `deltaBaseline`, `failureMode`, and callbacks such as `onProgress`, `onStats`, `onArchiveEntryStart` / `onArchiveEntryEnd`, `retry.onRetry`.
- **Optional entrypoints**—`s3-archive-download/platform`, `s3-archive-download/bullmq`, prepared index, presigned URLs, and the in-memory job registry are add-ons; use only what your architecture needs.
- **Authorization scope stays at the call site**—which keys enter an archive comes from list roots, **`filters`**, **`preparedIndexNdjson`**, or a custom **`StorageProvider`**. Align that with IAM and org policy; see [Selective files, multiple folders, and IAM](#selective-files-multiple-folders-and-iam).

## Debug and explain

Set **`debug: true`** on archive or prepared-index options for structured **debug**-level logs: list pages, GetObject lifecycle, per-object skips, durations, retries, and an end-of-run stage breakdown (heuristic when ZIP concurrency overlaps phases). If you omit `logger`, a shared stderr JSON logger at `debug` is used; with your own Pino logger, a child is created at `debug`.

```ts
import { createFolderArchiveStream } from "s3-archive-download";

createFolderArchiveStream({
  source: "s3://bucket/prefix/",
  format: "zip",
  debug: true,
});
```

Use **`resolveArchiveLogger({ logger, debug })`** when you supply your own Pino instance and want the same conventions.

Set **`explain: true`** for structured **`ArchiveExplainStep`** events (config, per-object begin/finish, summary). Use **`onExplainStep`** for large prefixes; otherwise `pumpArchiveToWritable` returns a capped **`explainTrace`**. The summary’s **`dominant`** field aligns with **`ArchiveStats.bottleneck`** (see **`classifyArchiveBottleneck`**).

## API overview

| Export                                                                                                                                            | Purpose                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFolderArchiveStream(options)`                                                                                                              | Returns a `Readable` archive stream.                                                                                                                                                                                                                                          |
| `pumpArchiveToWritable(dest, options)`                                                                                                            | Same pipeline; writes to your `Writable` (await completion + stats).                                                                                                                                                                                                          |
| `downloadFolderToFile` / `downloadFolderAsArchive`, `resumeFolderArchiveToFile` / `resumeFolderArchiveToWritable`                                 | One-call download + resume with checkpoint validation ([src/download-to-file.ts](src/download-to-file.ts), [src/resume-download.ts](src/resume-download.ts)).                                                                                                                 |
| `prepareFolderArchiveIndexToFile`, `streamPrefixIndexNdjson`, `createPreparedIndexReadable`, `downloadFolderToFileFromPreparedIndex`              | List to NDJSON once, then archive from the index ([src/prepared-index.ts](src/prepared-index.ts), [src/download-from-prepared-index-file.ts](src/download-from-prepared-index-file.ts)).                                                                                      |
| `S3StorageProvider`, `MemoryStorageProvider`, `StorageProvider`                                                                                   | Inject list/get (`MemoryStorageProvider` for tests; default path uses AWS `S3Client`) ([src/s3-provider.ts](src/s3-provider.ts), [src/memory-storage-provider.ts](src/memory-storage-provider.ts)).                                                                           |
| `suggestedCacheControlForArchiveDownload`, `globFiltersForExtensions`                                                                             | CDN-friendly `Cache-Control` defaults; build extension filters for `filters` ([src/archive-cdn-hints.ts](src/archive-cdn-hints.ts), [src/filters.ts](src/filters.ts)).                                                                                                        |
| `parseS3Uri(uri)`                                                                                                                                 | Parse `s3://bucket/prefix`.                                                                                                                                                                                                                                                   |
| `signGetObjectDownloadUrl` / `signGetObjectDownloadUrls`                                                                                          | Presigned GET URLs for browser `fetch()` (server IAM only).                                                                                                                                                                                                                   |
| `recommendArchiveExecutionSurface`                                                                                                                | Advises **browser** vs **server** zip from byte/object estimates.                                                                                                                                                                                                             |
| `suggestZipConcurrencyFromCompletedRun`, `estimatePipelineOverlapRatio`                                                                           | Cold-start **ZIP** concurrency advice from a finished run’s stats ([src/archive-concurrency-advice.ts](src/archive-concurrency-advice.ts)).                                                                                                                                   |
| `ArchivePumpFlowEngine`                                                                                                                           | Advanced: same pipeline as `pumpArchiveToWritable`, exposed for embedding/tests ([src/archive-pump-flow.ts](src/archive-pump-flow.ts)).                                                                                                                                       |
| `createBenchmarkDiscardWritable`                                                                                                                  | Writable sink that drops bytes (timing / `benchmark` CLI).                                                                                                                                                                                                                    |
| `buildEntryMappingLookup`                                                                                                                         | Normalize `entryMappings` keys (`meta.key` or `s3://bucket/key`).                                                                                                                                                                                                             |
| `classifyArchiveBottleneck`                                                                                                                       | List / download / archive-write heuristic (matches explain summary).                                                                                                                                                                                                          |
| `objectContentFingerprint`                                                                                                                        | ETag+size string for `dedupeContentByEtag`.                                                                                                                                                                                                                                   |
| `verifyGetObjectMd5Etag` (option) / `pipeThroughEtagMd5Verifier`                                                                                  | Optional per-object GET vs single-part ETag MD5 ([src/etag-md5-verify.ts](src/etag-md5-verify.ts)).                                                                                                                                                                           |
| `verifyLocalArchiveFileBytesMatchStats` / `verifyS3ObjectBytesMatchArchiveStats`                                                                  | Post-run size check vs `stats.bytesWritten` (file or `HeadObject`).                                                                                                                                                                                                           |
| `parseAdditionalListSources` / `canonicalizeAdditionalListSources` / `assertAdditionalListSourcesMatchCheckpoint`                                 | Validate, canonicalize, and compare extra list roots (including checkpoint resume).                                                                                                                                                                                           |
| `FileCheckpointStore` / `RedisCheckpointStore` / `SqlTableCheckpointStore` + `checkpoint`                                                         | Resume by skipping completed keys (file, Redis, or SQL table).                                                                                                                                                                                                                |
| `suggestArchiveRunStrategyHints`, `classifyArchiveWorkloadSize`, `classifyArchiveRetryStress`, `classifyArchiveRetryStressFromStats`              | Advisory tuning from stats / workload (no automatic actuator); [archive-strategy-hints](src/archive-strategy-hints.ts), [archive-workload-profile](src/archive-workload-profile.ts), [archive-retry-profile](src/archive-retry-profile.ts).                                   |
| `createArchiveTelemetryBridge`                                                                                                                    | Returns `{ emitter, augmentArchivePumpOptions }` to mirror S3 retries and slow-stream events on a Node **`EventEmitter`** ([src/archive-telemetry-bridge.ts](src/archive-telemetry-bridge.ts)).                                                                               |
| `summarizeArchiveControlPlaneSnapshot`                                                                                                            | Read-only snapshot of workload / retry / dominant-plane signals for dashboards ([src/archive-control-plane.ts](src/archive-control-plane.ts)).                                                                                                                                |
| `summarizeArchiveRunClassifications`                                                                                                              | Workload + retry-stress labels from completed `ArchiveStats` ([src/archive-run-diagnostics.ts](src/archive-run-diagnostics.ts)).                                                                                                                                              |
| `estimateS3ApiRequestCostUsd`, `estimateDataTransferOutCostUsd`, `estimateArchiveRunS3Usd`, `estimateKmsRequestCostUsd`, `computeS3WorkloadUnits` | Linear **USD** estimates and dimensionless workload score from list/get counts and bytes read ([src/s3-workload-units.ts](src/s3-workload-units.ts), [src/s3-data-transfer-cost.ts](src/s3-data-transfer-cost.ts), [src/s3-archive-run-cost.ts](src/s3-archive-run-cost.ts)). |

Use **`entryMappings`** for a static map from full object key (or `s3://bucket/key`) to archive path.

**Lifecycle hooks:** `onArchiveEntryStart` runs before each `GetObject` for objects that pass filters, `deltaBaseline`, checkpoint, and in-archive dedupe. `onArchiveEntryEnd` runs for every listed object (`included`, `skipped`, `omitted`, or `failed` before rethrow in fail-fast mode).

**Failure queue (best-effort):** when `failureMode: 'best-effort'`, completed runs return structured **`omissions`** (`ArchiveFailureQueue`); use **`onOmission`** to stream the same rows during the run. Persist externally if you need a durable dead-letter list.

Full options (`filters`, `failureMode`, `includeManifest`, `signal`, retries, `explain`, `additionalListSources`, …) are documented in **`dist/*.d.ts`**.

## Engineering notes

- **ZIP concurrency:** uses [`p-limit`](https://github.com/sindresorhus/p-limit) for bounded parallel `GetObject` (streams start **paused** until serialized append). Default **2**, max **16**. **tar / tar.gz** use **`1`** (or omit).
- **ZIP scheduling:** optional **`objectPriority`** + **`objectPriorityBufferMax`** reorder which objects **start** next from a bounded read-ahead buffer. Not available for tar.
- **Per-object transform:** optional **`transformGetObjectBody`** on pump/stream options can wrap each `GetObject` body after optional MD5 verify ([src/archive-object-processor.ts](src/archive-object-processor.ts)); linear pipeline, not a DAG of transforms.
- **Dedupe:** **`dedupeArchivePaths`** and **`dedupeContentByEtag`** require ZIP **`concurrency: 1`**. Helpers export **`objectContentFingerprint`**.
- **Multi-root:** **`additionalListSources`** merges extra `s3://` list roots; not combinable with **`preparedIndexNdjson`**. Checkpoints store canonical extra roots and composite keys; **`resumeFolderArchiveToWritable`** validates them.
- **Delta:** **`deltaBaseline(meta)`** can skip `GetObject` when you return `true` (combine with your own ETag/size map).
- **Manifest:** optional `includeManifest`; cap with `manifestMaxEntries` or use NDJSON index helpers for huge prefixes.
- **Integrity:** optional **`verifyGetObjectMd5Etag`** checks streamed bytes against the object ETag when it is a single-part MD5 hex; after a run, **`verifyLocalArchiveFileBytesMatchStats`** or **`verifyS3ObjectBytesMatchArchiveStats`** compares output size to **`stats.bytesWritten`**. A full cryptographic digest of the whole archive is not built in—add your own policy if required.
- **Idempotency:** the SDK retries S3 List/Get per your **`retry`** policy; **`checkpoint`** with a stable **`jobId`** skips keys already archived, and **`dedupeArchivePaths`** / **`dedupeContentByEtag`** avoid duplicate paths or bytes within a run. There is no separate “idempotency key” API—if you need exactly-once **job** semantics across process restarts or duplicate queue deliveries, enforce that in your orchestrator (for example dedupe on `jobId` before calling s3-archive-download).
- **Abort, crash, partial files:** **`AbortSignal`** stops work cooperatively; a **cancelled** run may still leave a **truncated or invalid** ZIP/tar on disk or in your `Writable`. Treat partial output as **not** a guaranteed-openable archive. With **`checkpoint`**, the **next** run skips completed keys and can finish the archive—this is the supported recovery path, not “repair in place” of a half-written zip.

## Developing s3-archive-download

```bash
npm run build       # ESM + CJS + types (tsup)
npm test            # vitest (runs release build first)
npm run lint        # eslint
npm run typecheck
npm run verify      # typecheck, lint, format, knip, test, publint, attw
npm run benchmark -- --help
npm run pack:dry-run
```

**Resilience tests:** the repository ships a small in-memory harness, **`ChaosMemoryStorageProvider`** ([test/chaos-memory-storage-provider.ts](test/chaos-memory-storage-provider.ts)), exercised by [test/chaos-storage-provider.integration.test.ts](test/chaos-storage-provider.integration.test.ts). It layers artificial **`getObject`** latency and injected open failures on top of **`MemoryStorageProvider`** so you can validate fail-fast vs **`failureMode: 'best-effort'`** without AWS. For assertions that **`getObject`** itself rejects, those tests use **`format: 'tar'`**; the ZIP encoder wraps downloads in an extra limiter, which can confuse Vitest’s unhandled-rejection reporting in isolation.

**Checkpoint resume:** [test/checkpoint-abort-resume.integration.test.ts](test/checkpoint-abort-resume.integration.test.ts) aborts from **`onArchiveEntryEnd`** after the first **included** object (so **`store.save`** has already run—see `ArchiveObjectProcessor`). It asserts **`CheckpointState`** shape, then resume skips that key via **`skipReason: 'checkpoint'`** with **`objectsSkipped`** on final stats. Covers both **tar** and **ZIP** (`concurrency: 1`).

## Publishing

1. Confirm **`repository`**, **`bugs`**, and **`homepage`** in `package.json` match your GitHub repository.
2. Update **[CHANGELOG.md](CHANGELOG.md)** for user-visible fixes and features (semver-facing notes).
3. Run **`npm run verify`**. **`prepublishOnly`** runs the same checks on **`npm publish`**. Pull requests should stay green: CI runs the same **`verify`** script on Node.js **20, 22, and 24** (see `.github/workflows/ci.yml`).
4. Run **`npm run pack:dry-run`** to confirm the published tarball contains `dist/`, `docs/`, `README.md`, `LICENSE`, and other `files` from `package.json` (for example `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`).

## Giving feedback and contributing

- **Issues:** report bugs or request features via [GitHub Issues](https://github.com/AshishViradiya153/s3download/issues) (adjust the URL if the repository moves).
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md) (setup, `verify`, PR expectations).
- **Security:** see [SECURITY.md](SECURITY.md); do not open public issues for undisclosed vulnerabilities.

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file.
