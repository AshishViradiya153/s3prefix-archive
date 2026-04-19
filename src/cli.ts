import { createWriteStream, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stderr, stdout, exit } from "node:process";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import cliProgress from "cli-progress";
import {
  createFolderArchiveStream,
  createPreparedIndexReadable,
  pumpArchiveToWritable,
} from "./index.js";
import { createBenchmarkDiscardWritable } from "./benchmark-sink.js";
import { parseArchiveRetryFromCli } from "./retry-parse.js";
import type { ArchiveFormat, ArchiveProgress, FailureMode } from "./types.js";
import type { CaughtValue } from "./errors.js";

const FORMATS = new Set<string>(["zip", "tar", "tar.gz"]);

function readVersion(): string {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return JSON.parse(readFileSync(pkgPath, "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
}

function parseFormat(s: string): ArchiveFormat {
  if (!FORMATS.has(s)) {
    throw new Error(`Invalid --format: ${s} (expected zip, tar, tar.gz)`);
  }
  return s as ArchiveFormat;
}

function parseFailureMode(s: string): FailureMode {
  if (s !== "fail-fast" && s !== "best-effort") {
    throw new Error(
      `Invalid --failure-mode: ${s} (expected fail-fast, best-effort)`,
    );
  }
  return s;
}

function openOut(path: string | undefined): Writable {
  if (path === undefined || path === "-") return stdout;
  return createWriteStream(path);
}

function collectOpt(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let i = -1;
  let v = n;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function truncateKey(key: string | undefined, max: number): string {
  if (!key) return "";
  return key.length <= max ? key : `…${key.slice(-(max - 1))}`;
}

/** stderr progress bar driven by {@link ArchiveProgress} (unknown final object count). */
function createArchiveProgressBar(): {
  onProgress: (p: ArchiveProgress) => void;
  stop: () => void;
} {
  const bar = new cliProgress.SingleBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      barsize: 18,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      format:
        "archive |{bar}| {percentage}% | listed {listed} | in archive {inc} | skipped {skip} | read {readW} | write {writeW} | {key}",
      stream: stderr,
      fps: 8,
      stopOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(1, 0, {
    listed: "0",
    inc: "0",
    skip: "0",
    readW: "0 B",
    writeW: "0 B",
    key: "",
  });
  let lastTotal = 1;
  return {
    onProgress: (p) => {
      const total = Math.max(1, p.objectsListed);
      if (total !== lastTotal) {
        bar.setTotal(total);
        lastTotal = total;
      }
      const done = Math.min(p.objectsIncluded + p.objectsSkipped, total);
      bar.update(done, {
        listed: String(p.objectsListed),
        inc: String(p.objectsIncluded),
        skip: String(p.objectsSkipped),
        readW: formatBytes(p.bytesRead),
        writeW: formatBytes(p.bytesWritten),
        key: truncateKey(p.currentKey, 44),
      });
    },
    stop: () => {
      bar.stop();
    },
  };
}

const program = new Command()
  .name("s3prefix-archive")
  .description("Stream S3 prefixes to ZIP/tar archives or NDJSON indexes.")
  .version(readVersion());

program
  .command("archive")
  .description("Write an archive of an S3 prefix to a file or stdout.")
  .requiredOption("--source <s3-uri>", "Source prefix, e.g. s3://bucket/path/")
  .option("-f, --format <fmt>", "zip | tar | tar.gz", "zip")
  .option("-o, --output <path>", 'Destination file ("-" for stdout)', "-")
  .option("--region <code>", "AWS region for the default S3 client")
  .option("--concurrency <n>", "ZIP GetObject concurrency (1–16)")
  .option("--failure-mode <mode>", "fail-fast | best-effort", "fail-fast")
  .option("--delimiter <char>", "S3 list delimiter")
  .option("--max-keys <n>", "ListObjectsV2 page size (1–1000)")
  .option("--zip-level <0-9>", "ZIP deflate level (zip only)")
  .option(
    "--zip-store-min-bytes <n>",
    "Objects ≥ this size (bytes) use STORE in zip; smaller use --zip-level",
  )
  .option("--gzip-level <1-9>", "gzip level (tar.gz only)")
  .option(
    "--include-glob <pattern>",
    "Micromatch include glob vs full S3 key (repeatable)",
    collectOpt,
    [],
  )
  .option(
    "--exclude-glob <pattern>",
    "Micromatch exclude glob vs full S3 key (repeatable)",
    collectOpt,
    [],
  )
  .option("--include-manifest", "Append manifest.json (uses RAM)", false)
  .option(
    "--manifest-name <name>",
    "Archive entry name for manifest",
    "manifest.json",
  )
  .option(
    "--manifest-max-entries <n>",
    "Skip manifest when object count exceeds this",
  )
  .option("--retry-max-attempts <n>", "S3 retry max attempts")
  .option("--retry-base-ms <n>", "S3 retry base delay (ms)")
  .option("--retry-max-ms <n>", "S3 retry max delay (ms)")
  .option("--progress", "Show stderr progress bar (cli-progress)", false)
  .action(async (opts) => {
    const progressUi = opts.progress ? createArchiveProgressBar() : null;
    let archiveErr: CaughtValue | undefined;
    try {
      const format = parseFormat(opts.format);
      const failureMode = parseFailureMode(opts.failureMode);
      const clientConfig = opts.region ? { region: opts.region } : undefined;
      const includeGlobs = (opts.includeGlob ?? ([] as string[])).filter(
        Boolean,
      );
      const excludeGlobs = (opts.excludeGlob ?? ([] as string[])).filter(
        Boolean,
      );
      const globFilters =
        includeGlobs.length > 0 || excludeGlobs.length > 0
          ? {
              ...(includeGlobs.length > 0 ? { include: includeGlobs } : {}),
              ...(excludeGlobs.length > 0 ? { exclude: excludeGlobs } : {}),
            }
          : undefined;
      const stream = createFolderArchiveStream({
        source: opts.source,
        format,
        clientConfig,
        concurrency:
          opts.concurrency !== undefined ? Number(opts.concurrency) : undefined,
        failureMode,
        delimiter: opts.delimiter,
        maxKeys: opts.maxKeys !== undefined ? Number(opts.maxKeys) : undefined,
        zipLevel:
          opts.zipLevel !== undefined ? Number(opts.zipLevel) : undefined,
        zipStoreMinBytes:
          opts.zipStoreMinBytes !== undefined
            ? Number(opts.zipStoreMinBytes)
            : undefined,
        gzipLevel:
          opts.gzipLevel !== undefined ? Number(opts.gzipLevel) : undefined,
        includeManifest: Boolean(opts.includeManifest),
        manifestName: opts.manifestName,
        manifestMaxEntries:
          opts.manifestMaxEntries !== undefined
            ? Number(opts.manifestMaxEntries)
            : undefined,
        retry: parseArchiveRetryFromCli(opts),
        onProgress: progressUi?.onProgress,
        filters: globFilters,
      });
      const dest = openOut(opts.output);
      await pipeline(stream, dest);
    } catch (e) {
      archiveErr = e as CaughtValue;
    } finally {
      progressUi?.stop();
    }
    if (archiveErr !== undefined) {
      const msg =
        archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
      stderr.write(`archive: ${msg}\n`);
      exit(1);
    }
  });

program
  .command("benchmark")
  .description(
    "Measure wall time and internal stage stats for prefix → archive (payload written to a discard sink).",
  )
  .requiredOption("--source <s3-uri>", "Source prefix, e.g. s3://bucket/path/")
  .option("-f, --format <fmt>", "zip | tar | tar.gz", "zip")
  .option("--region <code>", "AWS region for the default S3 client")
  .option("--concurrency <n>", "ZIP GetObject concurrency (1–16)")
  .option("--failure-mode <mode>", "fail-fast | best-effort", "fail-fast")
  .option("--delimiter <char>", "S3 list delimiter")
  .option("--max-keys <n>", "ListObjectsV2 page size (1–1000)")
  .option("--zip-level <0-9>", "ZIP deflate level (zip only)")
  .option(
    "--zip-store-min-bytes <n>",
    "Objects ≥ this size (bytes) use STORE in zip; smaller use --zip-level",
  )
  .option("--gzip-level <1-9>", "gzip level (tar.gz only)")
  .option(
    "--include-glob <pattern>",
    "Micromatch include glob vs full S3 key (repeatable)",
    collectOpt,
    [],
  )
  .option(
    "--exclude-glob <pattern>",
    "Micromatch exclude glob vs full S3 key (repeatable)",
    collectOpt,
    [],
  )
  .option("--json", "Print one JSON line with wallMs + stats to stdout", false)
  .addOption(
    new Option(
      "--profile <kind>",
      "archive: full pump to discard sink | list: listing + NDJSON only",
    )
      .choices(["archive", "list"] as const)
      .default("archive"),
  )
  .action(async (opts) => {
    const clientConfig = opts.region ? { region: opts.region } : undefined;
    const profile = opts.profile as "archive" | "list";

    if (profile === "list") {
      const t0 = performance.now();
      let lines = 0;
      let bytes = 0;
      try {
        const stream = createPreparedIndexReadable({
          source: opts.source,
          clientConfig,
          delimiter: opts.delimiter,
          maxKeys:
            opts.maxKeys !== undefined ? Number(opts.maxKeys) : undefined,
          retry: parseArchiveRetryFromCli(opts),
        });
        for await (const chunk of stream) {
          const buf =
            typeof chunk === "string"
              ? Buffer.from(chunk, "utf8")
              : Buffer.from(chunk);
          bytes += buf.length;
          for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 10) lines += 1;
          }
        }
        const wallMs = performance.now() - t0;
        if (opts.json) {
          stdout.write(
            `${JSON.stringify({
              profile: "list",
              wallMs,
              newlineCount: lines,
              bytes,
              source: opts.source,
            })}\n`,
          );
        } else {
          stderr.write(
            `benchmark list | wall ${wallMs.toFixed(0)} ms | ndjson newlines ${lines} | bytes ${formatBytes(bytes)} | ${opts.source}\n`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stderr.write(`benchmark: ${msg}\n`);
        exit(1);
      }
      return;
    }

    const format = parseFormat(opts.format);
    const failureMode = parseFailureMode(opts.failureMode);
    const includeGlobs = (opts.includeGlob ?? ([] as string[])).filter(Boolean);
    const excludeGlobs = (opts.excludeGlob ?? ([] as string[])).filter(Boolean);
    const globFilters =
      includeGlobs.length > 0 || excludeGlobs.length > 0
        ? {
            ...(includeGlobs.length > 0 ? { include: includeGlobs } : {}),
            ...(excludeGlobs.length > 0 ? { exclude: excludeGlobs } : {}),
          }
        : undefined;

    const t0 = performance.now();
    try {
      const { stats, omissions } = await pumpArchiveToWritable(
        createBenchmarkDiscardWritable(),
        {
          source: opts.source,
          format,
          clientConfig,
          concurrency:
            opts.concurrency !== undefined
              ? Number(opts.concurrency)
              : undefined,
          failureMode,
          delimiter: opts.delimiter,
          maxKeys:
            opts.maxKeys !== undefined ? Number(opts.maxKeys) : undefined,
          zipLevel:
            opts.zipLevel !== undefined ? Number(opts.zipLevel) : undefined,
          zipStoreMinBytes:
            opts.zipStoreMinBytes !== undefined
              ? Number(opts.zipStoreMinBytes)
              : undefined,
          gzipLevel:
            opts.gzipLevel !== undefined ? Number(opts.gzipLevel) : undefined,
          retry: parseArchiveRetryFromCli(opts),
          filters: globFilters,
        },
      );
      const wallMs = performance.now() - t0;
      if (opts.json) {
        stdout.write(
          `${JSON.stringify({
            profile: "archive",
            wallMs,
            stats,
            omissionsCount: omissions.length,
            source: opts.source,
            format,
          })}\n`,
        );
      } else {
        stderr.write(
          [
            `benchmark archive | ${opts.source}`,
            `  wall ${wallMs.toFixed(0)} ms | listed ${stats.objectsListed} | included ${stats.objectsIncluded} | skipped ${stats.objectsSkipped}`,
            `  read ${formatBytes(stats.bytesRead)} | written ${formatBytes(stats.bytesWritten)} | retries ${stats.retries}`,
            `  stages (occupancy wall) list ${stats.listMs.toFixed(0)} ms | download ${stats.downloadMs.toFixed(0)} ms | archive-write ${stats.archiveWriteMs.toFixed(0)} ms${stats.stageIdleMs != null && stats.stageIdleMs > 0 ? ` | idle ${stats.stageIdleMs.toFixed(0)} ms` : ""}`,
            omissions.length > 0
              ? `  omissions ${omissions.length} (best-effort detail omitted; use --json)`
              : "",
          ]
            .filter(Boolean)
            .join("\n") + "\n",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stderr.write(`benchmark: ${msg}\n`);
      exit(1);
    }
  });

program
  .command("index")
  .description(
    "Stream one JSON object per line (NDJSON) for keys under a prefix.",
  )
  .requiredOption("--source <s3-uri>", "Prefix to list")
  .option("-o, --output <path>", 'Output file ("-" for stdout)', "-")
  .option("--region <code>", "AWS region for the default S3 client")
  .option("--delimiter <char>", "S3 list delimiter")
  .option("--max-keys <n>", "ListObjectsV2 page size (1–1000)")
  .option("--retry-max-attempts <n>", "S3 retry max attempts")
  .option("--retry-base-ms <n>", "S3 retry base delay (ms)")
  .option("--retry-max-ms <n>", "S3 retry max delay (ms)")
  .action(async (opts) => {
    try {
      const clientConfig = opts.region ? { region: opts.region } : undefined;
      const stream = createPreparedIndexReadable({
        source: opts.source,
        clientConfig,
        delimiter: opts.delimiter,
        maxKeys: opts.maxKeys !== undefined ? Number(opts.maxKeys) : undefined,
        retry: parseArchiveRetryFromCli(opts),
      });
      const dest = openOut(opts.output);
      await pipeline(stream, dest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stderr.write(`index: ${msg}\n`);
      exit(1);
    }
  });

await program.parseAsync(process.argv);
