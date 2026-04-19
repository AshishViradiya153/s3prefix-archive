# Guide: CLI

Installing the package adds the **`s3prefix-archive`** binary (`package.json` **`bin`**).

```bash
npx s3prefix-archive archive --source s3://bucket/prefix/ -o out.zip
npx s3prefix-archive index --source s3://bucket/prefix/ -o index.ndjson
```

## Benchmark

Discards bytes so disk I/O does not dominate; use **`--profile list`** to stress **`ListObjectsV2`** + NDJSON serialization without **`GetObject`**.

```bash
s3prefix-archive benchmark --source s3://bucket/prefix/ --format zip --json
```

Human-readable output on stderr; **`--json`** prints one machine-readable line on stdout (see root README [CLI section](../../README.md#command-line-interface)).

## Credentials

Same as the SDK: configure **`AWS_REGION`**, credentials, or instance role before invoking the CLI.
