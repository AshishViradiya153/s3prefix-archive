import type {
  ArchiveFormat,
  CreateFolderArchiveStreamOptions,
} from "./types.js";
import { S3ArchiveError } from "./errors.js";

/**
 * Normalized archive pump flags derived from {@link CreateFolderArchiveStreamOptions}.
 * Centralizes option validation so the archive pump entrypoint stays orchestration-only.
 */
export class ArchivePumpResolvedOptions {
  private constructor(
    readonly format: ArchiveFormat,
    readonly isZip: boolean,
    readonly zipConcurrency: number,
    readonly wantsPathDedupe: boolean,
    readonly wantsContentDedupe: boolean,
    readonly deterministicOrdering: boolean,
  ) {}

  /**
   * Validates format/concurrency/dedupe/objectPriority rules that do not depend on the parsed URI.
   */
  static from(
    options: CreateFolderArchiveStreamOptions,
  ): ArchivePumpResolvedOptions {
    const format: ArchiveFormat = options.format ?? "zip";
    const isZip = format === "zip";
    if (!isZip && options.concurrency != null && options.concurrency !== 1) {
      throw new S3ArchiveError(
        `concurrency=${options.concurrency} is only supported for format "zip"; use 1 or omit for tar/tar.gz.`,
        "UNSUPPORTED_OPTION",
      );
    }
    if (!isZip && options.objectPriority != null) {
      throw new S3ArchiveError(
        `objectPriority is only supported for format "zip"; omit for tar/tar.gz.`,
        "UNSUPPORTED_OPTION",
      );
    }
    const deterministicOrdering = Boolean(options.deterministicOrdering);
    if (deterministicOrdering && options.objectPriority != null) {
      throw new S3ArchiveError(
        "deterministicOrdering cannot be used with objectPriority (priority scheduling reorders work).",
        "UNSUPPORTED_OPTION",
      );
    }
    if (
      deterministicOrdering &&
      isZip &&
      options.concurrency != null &&
      options.concurrency !== 1
    ) {
      throw new S3ArchiveError(
        `deterministicOrdering requires ZIP concurrency: 1; got concurrency=${options.concurrency}.`,
        "UNSUPPORTED_OPTION",
      );
    }
    const zipConcurrency = isZip
      ? deterministicOrdering
        ? (options.concurrency ?? 1)
        : Math.min(16, Math.max(1, options.concurrency ?? 2))
      : 1;
    const wantsPathDedupe = Boolean(options.dedupeArchivePaths);
    const wantsContentDedupe = Boolean(options.dedupeContentByEtag);
    if (
      isZip &&
      zipConcurrency > 1 &&
      (wantsPathDedupe || wantsContentDedupe)
    ) {
      throw new S3ArchiveError(
        "dedupeArchivePaths and dedupeContentByEtag require ZIP concurrency: 1. Set concurrency: 1 or omit dedupe options.",
        "UNSUPPORTED_OPTION",
      );
    }
    const zsm = options.zipStoreMinBytes;
    if (zsm != null && (!Number.isFinite(zsm) || zsm < 1)) {
      throw new S3ArchiveError(
        `zipStoreMinBytes must be a finite number >= 1 when set; got ${String(zsm)}`,
        "UNSUPPORTED_OPTION",
      );
    }
    return new ArchivePumpResolvedOptions(
      format,
      isZip,
      zipConcurrency,
      wantsPathDedupe,
      wantsContentDedupe,
      deterministicOrdering,
    );
  }
}
