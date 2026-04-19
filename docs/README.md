# s3-archive-download documentation

In-depth guides for using **s3-archive-download** as an npm package: streaming S3 (and compatible providers) into ZIP / tar / tar.gz archives with production-oriented hooks.

**Accuracy:** these guides describe only what exists under **`src/`** and the **`exports`** map in `package.json`. Published **`dist/*.d.ts`** types win over prose if anything drifts; open an issue if you spot a mismatch.

**Quick links**

| If you want to…                                                                        | Read                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Install, Node version, peer dependencies                                               | [Installation & package layout](package-structure-and-installation.md)         |
| First successful archive from a prefix                                                 | [Getting started](getting-started.md)                                          |
| How listing, get, encoding, and backpressure fit together                              | [Architecture & concepts](architecture.md)                                     |
| Map imports (`s3-archive-download`, `s3-archive-download/platform`, …) to capabilities | [Reference: exports & modules](reference-exports.md)                           |
| Resume after crash, Redis/SQL checkpoints                                              | [Guide: checkpoints & resume](guides/checkpoints-and-resume.md)                |
| NDJSON index, skip live listing                                                        | [Guide: prepared index](guides/prepared-index.md)                              |
| Filters, IAM, multiple prefixes, explicit keys                                         | [Guide: IAM & selective exports](guides/iam-selective-exports.md)              |
| Multipart upload to S3, Lambda, BullMQ                                                 | [Guide: platform, multipart & BullMQ](guides/platform-multipart-and-bullmq.md) |
| GCS, Azure Blob, custom `StorageProvider`                                              | [Guide: storage providers](guides/storage-providers.md)                        |
| Prometheus, cost USD estimates, explain mode                                           | [Guide: observability & cost](guides/observability-and-cost.md)                |
| `s3-archive-download` CLI (`archive`, `index`, `benchmark`)                            | [Guide: CLI](guides/cli.md)                                                    |
| Error codes, `describeArchiveFailure`                                                  | [Errors and codes](errors.md)                                                  |
| Presigned GET URLs for browser flows                                                   | [Presigned URLs](presigned-urls.md)                                            |
| Common failures, FAQ                                                                   | [Troubleshooting](troubleshooting.md)                                          |
| Why s3-archive-download is useful to the ecosystem                                     | [Community value](community-value.md)                                          |

**Repository**

- Examples (runnable): [`examples/`](../examples/README.md)
- Contributing & security: [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md)
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md)

The root [`README.md`](../README.md) remains the single-page overview and API table; this folder goes deeper without duplicating every code sample.
