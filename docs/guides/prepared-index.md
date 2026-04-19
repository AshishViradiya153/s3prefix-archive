# Guide: prepared NDJSON index

## Why

For very large prefixes, **listing twice** (once to explore, once to archive) doubles `ListObjectsV2` cost and time. You can:

1. **List once** to an NDJSON file (one JSON object per line: `key`, `size`, optional `etag`, `lastModified`).
2. **Archive later** from that file by passing **`preparedIndexNdjson`** (a `Readable`) so the pump **skips live listing** for that run.

## APIs (all from `s3prefix-archive`)

- **`streamPrefixIndexNdjson`** — async generator of NDJSON lines (list only).
- **`createPreparedIndexReadable`** — `Readable` of NDJSON lines (same data as above).
- **`prepareFolderArchiveIndexToFile`** — pipes that stream to a file path.
- **`downloadFolderToFileFromPreparedIndex`** — convenience: archive from an on-disk index file.
- **`iterateObjectMetaFromNdjsonIndex`** — parse a `Readable` NDJSON stream into **`ObjectMeta`** (used internally when **`preparedIndexNdjson`** is set on the pump).
- **`createFolderArchiveStream` / `pumpArchiveToWritable`** — pass **`preparedIndexNdjson`** (e.g. `fs.createReadStream("…")`) for custom sinks.

## Rules

- Each **`key`** in the index must **start with** the **`source`** prefix (validated while parsing lines).
- **Single bucket** per run for the prepared-index path (bucket comes from **`source`**).
- **`additionalListSources`** cannot be combined with **`preparedIndexNdjson`**.
- If you use **`maxInFlightReadBytes`**, keep **`size`** accurate (e.g. from listing or `HeadObject`) so byte reservations stay correct.

## Operational note

Invalidation (when the index is stale) is **your** policy—s3prefix-archive does not TTL the NDJSON.

Examples: [examples/prepared-index-two-step.ts](../../examples/prepared-index-two-step.ts), [examples/explicit-keys-prepared-index.ts](../../examples/explicit-keys-prepared-index.ts).
