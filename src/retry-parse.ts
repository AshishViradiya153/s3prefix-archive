import type { CreateFolderArchiveStreamOptions } from "./types.js";

/** String fields as produced by CLI / env parsers before `Number()`. */
export interface RetryCliStringFields {
  retryMaxAttempts?: string;
  retryBaseMs?: string;
  retryMaxMs?: string;
}

export function parseArchiveRetryFromCli(
  fields: RetryCliStringFields,
): CreateFolderArchiveStreamOptions["retry"] | undefined {
  const { retryMaxAttempts, retryBaseMs, retryMaxMs } = fields;
  if (retryMaxAttempts == null && retryBaseMs == null && retryMaxMs == null)
    return undefined;
  return {
    maxAttempts:
      retryMaxAttempts !== undefined ? Number(retryMaxAttempts) : undefined,
    baseDelayMs: retryBaseMs !== undefined ? Number(retryBaseMs) : undefined,
    maxDelayMs: retryMaxMs !== undefined ? Number(retryMaxMs) : undefined,
  };
}
