import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArchiveFormat } from "./types.js";

/**
 * One row of {@link CheckpointState.resumeDedupe}, aligned by index with {@link CheckpointState.completedKeys}.
 */
export interface CheckpointResumeDedupeEntry {
  entryName: string;
  /** Set when content dedupe was enabled and a fingerprint existed at commit time. */
  contentFp?: string;
}

export interface CheckpointState {
  version: 1;
  bucket: string;
  prefix: string;
  format: ArchiveFormat;
  completedKeys: string[];
  /**
   * Canonical sorted `s3://bucket/prefix` roots when {@link CreateFolderArchiveStreamOptions.additionalListSources}
   * was used; must match on resume.
   */
  additionalListSources?: string[];
  /**
   * Restores in-memory path/content dedupe across resume. Length must equal {@link completedKeys}
   * whenever either dedupe mode is used with checkpoint (see pump validation).
   */
  resumeDedupe?: {
    entries: CheckpointResumeDedupeEntry[];
  };
}

export interface CheckpointStore {
  load(jobId: string): Promise<CheckpointState | null>;
  save(jobId: string, state: CheckpointState): Promise<void>;
}

export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly directory: string) {}

  private path(jobId: string): string {
    return join(this.directory, `${encodeURIComponent(jobId)}.json`);
  }

  async load(jobId: string): Promise<CheckpointState | null> {
    try {
      const raw = await readFile(this.path(jobId), "utf8");
      return JSON.parse(raw) as CheckpointState;
    } catch {
      return null;
    }
  }

  async save(jobId: string, state: CheckpointState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(jobId), JSON.stringify(state, null, 2), "utf8");
  }
}
