/** Effective deflate level for one object (0 = STORE). */
export function resolveZipEntryLevel(
  baseZipLevel: number,
  zipStoreMinBytes: number | undefined,
  uncompressedSize: number,
): number {
  if (
    zipStoreMinBytes != null &&
    Number.isFinite(zipStoreMinBytes) &&
    zipStoreMinBytes >= 1 &&
    Number.isFinite(uncompressedSize) &&
    uncompressedSize >= zipStoreMinBytes
  ) {
    return 0;
  }
  return baseZipLevel;
}
