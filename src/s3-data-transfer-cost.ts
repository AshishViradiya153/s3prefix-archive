import type { ArchiveStats } from "./types.js";

/** One gibibyte in bytes (1024³), consistent with typical object size reporting. */
export const BYTES_PER_GIB = 1024 ** 3;

/**
 * Convert a published **USD per GiB** egress price to **USD per byte** (linear rate within a tier).
 *
 * \[
 *   c_{\text{byte}} = \frac{c_{\text{GiB}}}{1024^3}
 * \]
 */
export function usdPerGibToUsdPerByte(usdPerGib: number): number {
  return usdPerGib / BYTES_PER_GIB;
}

/**
 * Cumulative **AWS-style** egress band: bytes in \([b_{i-1}, b_i)\) are charged at `usdPerByte`,
 * where \(b_i\) is {@link untilBytesExclusive} and \(b_{-1} = 0\).
 * The last band must use {@link Number.POSITIVE_INFINITY} so all remaining bytes are covered.
 */
export interface CumulativeDataTransferPriceBand {
  /** Exclusive upper bound on cumulative bytes for this band (first band starts at 0). */
  untilBytesExclusive: number;
  /** Linear price for each byte in this band. */
  usdPerByte: number;
}

function assertSortedCumulativeBands(
  bands: readonly CumulativeDataTransferPriceBand[],
): CumulativeDataTransferPriceBand[] {
  if (bands.length === 0) {
    throw new TypeError(
      "data transfer pricing bands: expected at least one band",
    );
  }
  const sorted = [...bands].sort(
    (a, b) => a.untilBytesExclusive - b.untilBytesExclusive,
  );
  const last = sorted[sorted.length - 1]!;
  if (last.untilBytesExclusive !== Number.POSITIVE_INFINITY) {
    throw new TypeError(
      "data transfer pricing bands: last band must use untilBytesExclusive: Infinity",
    );
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.untilBytesExclusive;
    const cur = sorted[i]!.untilBytesExclusive;
    if (!(prev < cur)) {
      throw new TypeError(
        "data transfer pricing bands: untilBytesExclusive must be strictly increasing (except the final Infinity)",
      );
    }
  }
  for (const b of sorted) {
    if (!Number.isFinite(b.usdPerByte) || b.usdPerByte < 0) {
      throw new TypeError(
        "data transfer pricing bands: usdPerByte must be finite and non-negative",
      );
    }
  }
  return sorted;
}

/**
 * Piecewise-linear **data transfer OUT** cost from total bytes using ordered cumulative bands.
 * Complexity **O(k)** in the number of bands.
 *
 * For `totalBytes <= 0`, returns **0** (no egress).
 */
export function estimateDataTransferOutCostUsd(
  totalBytes: number,
  bands: readonly CumulativeDataTransferPriceBand[],
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const sorted = assertSortedCumulativeBands(bands);
  let prev = 0;
  let cost = 0;
  for (const band of sorted) {
    const cap = Math.min(totalBytes, band.untilBytesExclusive);
    if (cap > prev) {
      cost += (cap - prev) * band.usdPerByte;
      prev = cap;
    }
    if (prev >= totalBytes) break;
  }
  return cost;
}

/**
 * Convenience: {@link estimateDataTransferOutCostUsd} using {@link ArchiveStats.bytesRead} as egress volume.
 * (Assumes all read bytes leave the S3 path you price—same caveat as any egress model.)
 */
export function estimateS3DataTransferOutCostUsdFromArchiveBytesRead(
  stats: Pick<ArchiveStats, "bytesRead">,
  bands: readonly CumulativeDataTransferPriceBand[],
): number {
  return estimateDataTransferOutCostUsd(stats.bytesRead, bands);
}
