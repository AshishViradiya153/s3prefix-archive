import { Buffer } from "node:buffer";
import type { ArchiveFormat, FailureMode, OmissionRecord } from "./types.js";
import type { ArchiveManifestRow } from "./archive-object-processor.js";

export interface ArchiveManifestEncodeInput {
  source: string;
  format: ArchiveFormat;
  objects: ArchiveManifestRow[];
  omissions: OmissionRecord[];
  failureMode: FailureMode;
}

/** Pretty-printed JSON manifest as UTF-8 bytes (same shape for ZIP and tar). */
export function encodeArchiveManifestJsonUtf8(
  input: ArchiveManifestEncodeInput,
): Buffer {
  const manifestBody = JSON.stringify(
    {
      version: 1,
      source: input.source,
      format: input.format,
      generatedAt: new Date().toISOString(),
      objects: input.objects,
      omissions:
        input.failureMode === "best-effort" ? input.omissions : undefined,
    },
    null,
    2,
  );
  return Buffer.from(manifestBody, "utf8");
}
