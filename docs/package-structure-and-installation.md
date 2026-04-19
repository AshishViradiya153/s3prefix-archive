# Installation & package layout

## What gets installed

The published tarball includes `dist/` (compiled JS + `.d.ts`), `README.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and this **`docs/`** tree. After `npm install s3download`, you can open `node_modules/s3download/docs/README.md` offline.

## Entry points (`exports`)

| Import path             | Role                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `s3download`            | Core **library** API (`import` from `"s3download"`): list → archive → `Writable` / file helpers, checkpoints, prepared index, presigned URLs, metrics, job registry helpers, etc. The same npm package **also** ships the **`s3download` CLI** via `package.json` **`bin`** — not a module import; see [CLI guide](guides/cli.md). |
| `s3download/platform`   | Multipart upload of the archive to S3 (`runFolderArchiveToS3`, `runFolderArchiveToWritable`), plus checkpoint/logger re-exports used by workers.                                                                                                                                                                                   |
| `s3download/bullmq`     | JSON-safe job payloads + `createFolderArchiveToS3Processor` / `enqueueFolderArchiveToS3` for BullMQ workers.                                                                                                                                                                                                                       |
| `s3download/gcs`        | `GcsStorageProvider` (+ `GcsStorageProviderOptions`) — list/get via `@google-cloud/storage`.                                                                                                                                                                                                                                       |
| `s3download/azure-blob` | `AzureBlobStorageProvider` (+ `AzureBlobStorageProviderOptions`) — list/get via `@azure/storage-blob`.                                                                                                                                                                                                                             |

Both **ESM** and **CJS** are supported; TypeScript resolves types per `exports` in `package.json`.

## Peer dependencies

Peers are **optional** (`peerDependenciesMeta.optional: true`): you only install the peer for the integration you use.

- **`@aws-sdk/lib-storage`** — required for `runFolderArchiveToS3` and multipart upload paths.
- **`bullmq`** — required for `s3download/bullmq`.
- **`@google-cloud/storage`** — required for `s3download/gcs`.
- **`@azure/storage-blob`** — required for `s3download/azure-blob`.
