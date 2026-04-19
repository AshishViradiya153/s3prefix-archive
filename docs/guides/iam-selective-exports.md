# Guide: IAM & selective exports

AWS IAM typically separates **`s3:ListBucket`** (often scoped with `Condition` on `s3:prefix`) from **`s3:GetObject`**. s3prefix-archive needs to align **how you enumerate keys** with what the role allows.

## Patterns

| Goal                                  | Mechanism                                                                                              | Listing still happens?                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Subset of keys under one prefix       | **`filters.include` / `exclude` / `predicate`**                                                        | Yes, for the full **`source`** prefix; filtered keys are skipped after list.                                 |
| Several disjoint prefixes or buckets  | **`additionalListSources`**                                                                            | Yes, one list per root; see [additional-sources example](../../examples/additional-sources-multi-prefix.ts). |
| No `ListObjectsV2` during the archive | **`preparedIndexNdjson`** — NDJSON built by your app (DB, entitlement API, etc.)                       | No (for that run).                                                                                           |
| Policy not expressible as S3 list     | Custom **`StorageProvider`**: **`listObjects`** returns approved keys; **`getObjectStream`** calls S3. | Controlled by your adapter.                                                                                  |

## Prepared index vs filters

- **Filters** reduce what gets archived but **still require** permission to list the parent prefix (unless you narrow **`source`** to a listable prefix).
- **Prepared index** avoids listing inside the pump; you only need **`GetObject`** on the keys in the file (plus whatever you use to build accurate index lines).

## Validation

Use **`parseAdditionalListSources`** before enqueueing multi-root jobs so duplicate or primary-repeated URIs fail fast with **`INVALID_ADDITIONAL_SOURCES`**. For checkpoint resume, use **`assertAdditionalListSourcesMatchCheckpoint`** when building custom tooling.

See the root README section [Selective files, multiple folders, and IAM](../../README.md#selective-files-multiple-folders-and-iam) for the summary table and links to examples.
