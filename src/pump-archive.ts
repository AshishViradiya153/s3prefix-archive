import type { Writable } from "node:stream";
import type {
  CreateFolderArchiveStreamOptions,
  PumpArchiveResult,
} from "./types.js";
import { ArchivePumpFlowEngine } from "./archive-pump-flow.js";

export type { PumpArchiveResult };

/**
 * Pump an S3 prefix (or prepared index) into an archive stream written to `destination`.
 * Delegates to {@link ArchivePumpFlowEngine} (resolve → checkpoint → explain → data plane → finalize).
 */
export async function pumpArchiveToWritable(
  destination: Writable,
  options: CreateFolderArchiveStreamOptions,
): Promise<PumpArchiveResult> {
  return new ArchivePumpFlowEngine(destination, options).run();
}
