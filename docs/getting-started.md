# Getting started

## Prerequisites

- **Node.js** `>= 20.19.0` (see `engines` in `package.json`).
- **AWS credentials** for the default S3 path: environment variables, shared config, IAM role, SSO, or any method supported by [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/).

## Install

```bash
npm install s3flow @aws-sdk/client-s3
```

Pin `@aws-sdk/client-s3` in your app if you need a fixed major line. The library depends on it transitively; declaring it keeps Renovate/Dependabot and your lockfile explicit.

Optional peers (install only what you use):

| Feature                                    | Package                 |
| ------------------------------------------ | ----------------------- |
| Multipart upload of the archive to S3      | `@aws-sdk/lib-storage`  |
| BullMQ workers                             | `bullmq`                |
| Google Cloud Storage via `storageProvider` | `@google-cloud/storage` |
| Azure Blob via `storageProvider`           | `@azure/storage-blob`   |

## Minimal program

Reuse **one** `S3Client` across requests or jobs when possible (connection reuse, TLS).

```ts
import { createWriteStream } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { downloadFolderToFile } from "s3flow";

const client = new S3Client({}); // region/credentials from environment

await downloadFolderToFile("out.zip", {
  source: "s3://my-bucket/path/to/prefix/",
  format: "zip",
  client,
});
```

## Next steps

- [Architecture & concepts](architecture.md) — what the pipeline does in order.
- [Reference: exports & modules](reference-exports.md) — `s3flow` vs `s3flow/platform` / `bullmq` / `gcs` / `azure-blob`.
- [`examples/`](../examples/README.md) — copy-paste scripts (HTTP, checkpoints, prepared index, IAM-style flows).
