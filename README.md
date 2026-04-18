# s3flow

[npm version](https://www.npmjs.com/package/s3flow)
[Node.js](https://nodejs.org/)
[License: MIT](https://github.com/ashishviradiya/s3flow/blob/main/LICENSE)

**s3flow** is a Node.js library for **streaming an Amazon S3 prefix into a ZIP, tar, or tar.gz archive** with paginated listing, `GetObject` as byte streams, and `**stream/promises.pipeline`\*\* so backpressure propagates end to end. It is built for production workloads: retries, checkpoints, optional multipart upload of the archive back to S3, NDJSON prepared indexes, metrics (including Prometheus), and a small CLI.

The package uses a **modular layout**: the default entry covers listing, archiving, and file/HTTP sinks; optional subpaths add multipart upload (`s3flow/platform`) and BullMQ helpers (`s3flow/bullmq`). TypeScript types ship with the package—open `dist/*.d.ts` or use your editor’s IntelliSense after `npm install s3flow`.

Source code and issues: **[github.com/ashishviradiya/s3flow](https://github.com/ashishviradiya/s3flow)**.

# Table of Contents

1. [Getting Started](#getting-started)
2. [Installation](#installation)
3. [Package structure](#package-structure)
4. [Usage](#usage)
5. [Streaming to a local file](#streaming-to-a-local-file)
6. [Download in one call](#download-in-one-call)
7. [Checkpoints and resume](#checkpoints-and-resume)
8. [Prepared NDJSON index](#prepared-ndjson-index)
9. [Express (HTTP response)](#express-http-response)
10. [Upload archive to S3 (multipart)](#upload-archive-to-s3-multipart)
11. [Lambda: upload and verify](#lambda-upload-and-verify)
12. [BullMQ: worker with verification](#bullmq-worker-with-verification)
13. [Command line interface](#command-line-interface)
14. [Configuration and credentials](#configuration-and-credentials)
15. [Design principles](#design-principles)
16. [Debug and explain](#debug-and-explain)
17. [API overview](#api-overview)
18. [Engineering notes](#engineering-notes)
19. [Developing s3flow](#developing-s3flow)
20. [Publishing](#publishing)
21. [Giving feedback and contributing](#giving-feedback-and-contributing)
22. [License](#license)

## Getting Started

The following steps use **npm**. They assume you have a supported **Node.js** version installed (see [Installation](#installation)).

1. Create or open a Node.js project and install the package:

```bash
 npm install s3flow
```

Adding the package updates your lock file. You **should** commit your lock file with your application code. See [package-lock.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json) for npm’s guidance. 2. Ensure AWS credentials are available to the SDK (environment, shared config, IAM role, etc.). Pass an `**S3Client`\*\* into s3flow options in production (see [Configuration and credentials](#configuration-and-credentials)). 3. Create a file (for example `archive.mjs` in a project with `"type": "module"`) that builds a ZIP from a prefix and writes it to disk:

```js
import { createWriteStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { createFolderArchiveStream } from "s3flow";

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

- **Node.js >= 18.18** (uses `Readable.fromWeb` for AWS SDK response bodies when needed).

**Dependencies**

- `@aws-sdk/client-s3` is a **dependency** of s3flow (installed transitively). Pin it in your app if you need a fixed major line, for example:
  ```bash
  npm install s3flow @aws-sdk/client-s3@^3
  ```
- `[mime-types](https://github.com/jshttp/mime-types)` is used for `Content-Type` (HTTP responses and S3 multipart uploads via `resolveArchiveContentType`).

**Optional peer: multipart upload (`s3flow/platform`)**

To stream an archive **to S3** using `@aws-sdk/lib-storage`’s multipart upload, install the peer yourself:

```bash
npm install @aws-sdk/lib-storage
```

`@aws-sdk/lib-storage` is **optional** so projects that only stream to a file or HTTP response are not forced to install it.

**Optional peer: BullMQ**

For the BullMQ worker helpers under `s3flow/bullmq`, install `bullmq` in your worker project.

**Contributors**

Use **Node 24** when developing this repository (see [.nvmrc](.nvmrc)): `nvm use && npm install`. This repo lists `[packageManager](https://nodejs.org/api/packages.html#packagemanager)`: **pnpm**—after `corepack enable`, use `pnpm install` and `pnpm run …` if you prefer.

## Package structure

s3flow follows a **modular entry** pattern similar in spirit to per-service packages in AWS SDK for JavaScript v3: import only what you need.

| Import path       | Role                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `s3flow`          | Core: list → get → archive → your `Writable` or HTTP; file helpers; checkpoints; metrics; CLI binary `s3flow`. |
| `s3flow/platform` | Multipart upload of the archive to S3 (`runFolderArchiveToS3`, checkpoint types, job helpers).                 |
| `s3flow/bullmq`   | JSON-safe job payloads and processor for `runFolderArchiveToS3` (install `bullmq` peer).                       |

Example:

```ts
import { createFolderArchiveStream } from "s3flow";
import { runFolderArchiveToS3 } from "s3flow/platform";
```

## Usage

### Streaming to a local file

```ts
import { createWriteStream } from "node:fs";
import { createFolderArchiveStream } from "s3flow";

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
import { downloadFolderToFile } from "s3flow";

const { stats } = await downloadFolderToFile("out.zip", {
  source: "s3://my-bucket/path/to/folder/",
  format: "zip",
  client: myS3Client,
});
```

The alias `**downloadFolderAsArchive**` points to the same function.

### Checkpoints and resume

Use the same `jobId`, `CheckpointStore`, and `source` / `format` as the original run. Resume helpers validate scope so you do not append to the wrong job.

```ts
import {
  downloadFolderToFile,
  resumeFolderArchiveToFile,
  FileCheckpointStore,
} from "s3flow";

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

### Prepared NDJSON index

List once to a file, then build the archive from that index (no second `ListObjectsV2`). Each line is one JSON object (`key`, `size`, optional `etag` / `lastModified`).

```ts
import {
  prepareFolderArchiveIndexToFile,
  downloadFolderToFileFromPreparedIndex,
} from "s3flow";

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

### Express (HTTP response)

```ts
import { createFolderArchiveStream } from "s3flow";

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
import { runFolderArchiveToS3 } from "s3flow/platform";

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
import { verifyS3ObjectBytesMatchArchiveStats } from "s3flow";
import { runFolderArchiveToS3 } from "s3flow/platform";
```

### BullMQ: worker with verification

For a **Redis-backed queue**, use `**createFolderArchiveToS3Processor`\*\* from `s3flow/bullmq` on a BullMQ `Worker`. The repo shows a processor that wraps the default runner and fails the job if post-upload byte verification does not match:

- `[examples/bullmq-archive-worker.ts](examples/bullmq-archive-worker.ts)`

Minimal shape (see the file for shutdown and env):

```ts
import { Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createFolderArchiveToS3Processor,
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
} from "s3flow/bullmq";

const client = new S3Client({});
new Worker(
  DEFAULT_FOLDER_ARCHIVE_QUEUE_NAME,
  createFolderArchiveToS3Processor({ client }),
  { connection: { host: "127.0.0.1", port: 6379 } },
);
```

Enqueue jobs with `**enqueueFolderArchiveToS3**` (same module); install the `**bullmq**` peer (see [Installation](#installation)).

## Command line interface

Installing the package adds the `**s3flow**` command (`package.json` `**bin**`). The published tarball already includes `dist/`, so you do **not** need to build locally to use the CLI after `npm install s3flow`.

```bash
npx s3flow archive --source s3://bucket/prefix/ -o out.zip
npx s3flow index --source s3://bucket/prefix/ -o index.ndjson
```

**Benchmark** runs the same pipeline as the library but discards bytes so disk I/O does not dominate. Use `**--profile list`** to measure **ListObjectsV2 + NDJSON serialization\*\* only (no `GetObject`).

When developing **this repository**, after `npm run build` (or `pnpm run build`):

```bash
npm run benchmark -- --source s3://bucket/prefix/ --format zip --json
npm run benchmark -- --source s3://bucket/prefix/ --profile list
```

Human-readable summaries go to **stderr**; `**--json`** prints one machine-readable line on **stdout\*\*.

## Configuration and credentials

Pass an `**S3Client`\*\* configured with your credential provider (environment variables, IAM role, SSO, etc.). Do not embed long-lived access keys in application code.

Reuse **one long-lived `S3Client`** across jobs or requests where possible so connections amortize TLS and DNS. When `client` is omitted, a new client is created from `clientConfig` for that run only. For concurrent List/Get under load, tune the HTTP stack (for example Node `https.Agent` `maxSockets`, `keepAlive`) via AWS SDK v3 `requestHandler` / `NodeHttpHandler` options on `clientConfig`.

See [AWS SDK for JavaScript v3 Developer Guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/) for credential and region configuration.

## Design principles

s3flow is a **data-plane** library (list → get → encode → sink) with **hooks**, not a closed hosted platform.

- **You own policy**—where jobs run, how they are queued, cost limits, and how checkpoints are stored are your decisions. The library provides streaming, backpressure, stats, and **advisory** helpers (strategy hints, cost estimates, hybrid browser vs server recommendation); it does not replace your orchestration.
- **Important behavior is injectable**—`S3Client`, optional `StorageProvider`, `CheckpointStore`, `retry`, `AbortSignal`, `transformGetObjectBody`, `filters`, `deltaBaseline`, `failureMode`, and callbacks such as `onProgress`, `onStats`, `onArchiveEntryStart` / `onArchiveEntryEnd`, `retry.onRetry`.
- **Optional entrypoints**—`s3flow/platform`, `s3flow/bullmq`, prepared index, presigned URLs, and the in-memory job registry are add-ons; use only what your architecture needs.

## Debug and explain

Set `**debug: true`** on archive or prepared-index options for structured **debug\*\*-level logs: list pages, GetObject lifecycle, per-object skips, durations, retries, and an end-of-run stage breakdown (heuristic when ZIP concurrency overlaps phases). If you omit `logger`, a shared stderr JSON logger at `debug` is used; with your own Pino logger, a child is created at `debug`.

```ts
import { createFolderArchiveStream } from "s3flow";

createFolderArchiveStream({
  source: "s3://bucket/prefix/",
  format: "zip",
  debug: true,
});
```

Use `**resolveArchiveLogger({ logger, debug })**` when you supply your own Pino instance and want the same conventions.

Set `**explain: true**` for structured `**ArchiveExplainStep**` events (config, per-object begin/finish, summary). Use `**onExplainStep**` for large prefixes; otherwise `pumpArchiveToWritable` returns a capped `**explainTrace**`. The summary’s `**dominant**` field aligns with `**ArchiveStats.bottleneck**` (see `**classifyArchiveBottleneck**`).

## API overview

| Export                                                             | Purpose                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `createFolderArchiveStream(options)`                               | Returns a `Readable` archive stream.                                 |
| `pumpArchiveToWritable(dest, options)`                             | Same pipeline; writes to your `Writable` (await completion + stats). |
| `parseS3Uri(uri)`                                                  | Parse `s3://bucket/prefix`.                                          |
| `createPreparedIndexReadable`                                      | NDJSON lines of object metadata (large prefixes).                    |
| `createBenchmarkDiscardWritable`                                   | Writable sink that drops bytes (timing / `benchmark` CLI).           |
| `buildEntryMappingLookup`                                          | Normalize `entryMappings` keys (`meta.key` or `s3://bucket/key`).    |
| `classifyArchiveBottleneck`                                        | List / download / archive-write heuristic (matches explain summary). |
| `objectContentFingerprint`                                         | ETag+size string for `dedupeContentByEtag`.                          |
| `parseAdditionalListSources` / `canonicalizeAdditionalListSources` | Validate and sort extra list roots for multi-bucket archives.        |
| `FileCheckpointStore` + `checkpoint` option                        | Resume by skipping completed keys.                                   |

Use `**entryMappings**` for a static map from full object key (or `s3://bucket/key`) to archive path.

**Lifecycle hooks:** `onArchiveEntryStart` runs before each `GetObject` for objects that pass filters, `deltaBaseline`, checkpoint, and in-archive dedupe. `onArchiveEntryEnd` runs for every listed object (`included`, `skipped`, `omitted`, or `failed` before rethrow in fail-fast mode).

Full options (`filters`, `failureMode`, `includeManifest`, `signal`, retries, `explain`, `additionalListSources`, …) are documented in `**dist/*.d.ts`\*\*.

## Engineering notes

- **ZIP concurrency:** uses `[p-limit](https://github.com/sindresorhus/p-limit)` for bounded parallel `GetObject` (streams start **paused** until serialized append). Default **2**, max **16**. **tar / tar.gz** use `**1`\*\* (or omit).
- **ZIP scheduling:** optional `**objectPriority`** + `**objectPriorityBufferMax`** reorder which objects **start\*\* next from a bounded read-ahead buffer. Not available for tar.
- **Dedupe:** `**dedupeArchivePaths`** and `**dedupeContentByEtag`** require ZIP `**concurrency: 1**`. Helpers export `**objectContentFingerprint**`.
- **Multi-root:** `**additionalListSources`** merges extra `s3://` list roots; not combinable with `**preparedIndexNdjson`**. Checkpoints store canonical extra roots and composite keys; `**resumeFolderArchiveToWritable**` validates them.
- **Delta:** `**deltaBaseline(meta)`\*\* can skip `GetObject` when you return `true` (combine with your own ETag/size map).
- **Manifest:** optional `includeManifest`; cap with `manifestMaxEntries` or use NDJSON index helpers for huge prefixes.

## Developing s3flow

```bash
npm run build       # ESM + CJS + types (tsup)
npm test            # vitest (runs release build first)
npm run lint        # eslint
npm run typecheck
npm run verify      # typecheck, lint, format, knip, test, publint, attw
npm run benchmark -- --help
npm run pack:dry-run
```

## Publishing

1. Confirm `**repository**`, `**bugs**`, and `**homepage**` in `package.json` match your GitHub repository.
2. Run `**npm run verify**`. `**prepublishOnly**` runs the same checks on `**npm publish**`.
3. Run `**npm run pack:dry-run**` to confirm the published tarball contains `dist/`, `README.md`, and `LICENSE` (see the `files` field in `package.json`).
4. `**publishConfig.provenance**` is set for [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Local publishes without OIDC may need `**npm publish --no-provenance**` unless you use trusted publishing (for example GitHub Actions).

## Giving feedback and contributing

- **Issues:** report bugs or request features via [GitHub Issues](https://github.com/ashishviradiya/s3flow/issues) (adjust the URL if the repository moves).
- **Contributions:** fork the repository, add tests for behavioral changes, and run `**npm run verify`\*\* before submitting a pull request.

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file.
