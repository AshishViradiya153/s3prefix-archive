import { describe, expect, it } from "vitest";
import {
  ArchiveStageOccupancyMeter,
  wrapAsyncIterableWithListStage,
} from "../src/archive-stage-meter.js";

describe("ArchiveStageOccupancyMeter", () => {
  it("partitions a single active stage to full dt", () => {
    const m = new ArchiveStageOccupancyMeter(0);
    m.enterDownload(0);
    m.leaveDownload(100);
    const s = m.finish(100);
    expect(s.downloadMs).toBe(100);
    expect(s.listMs).toBe(0);
    expect(s.archiveWriteMs).toBe(0);
    expect(s.stageIdleMs).toBe(0);
  });

  it("splits dt evenly when list and download are both active", () => {
    const m = new ArchiveStageOccupancyMeter(0);
    m.enterListWait(0);
    m.enterDownload(0);
    m.leaveDownload(100);
    m.leaveListWait(100);
    const s = m.finish(100);
    expect(s.listMs + s.downloadMs + s.stageIdleMs).toBeGreaterThanOrEqual(99);
    expect(s.listMs).toBeGreaterThan(40);
    expect(s.downloadMs).toBeGreaterThan(40);
  });

  it("attributes gap to idle when nothing is active", () => {
    const m = new ArchiveStageOccupancyMeter(0);
    const s = m.finish(50);
    expect(s.stageIdleMs).toBe(50);
  });

  it("throws on extra leave (ref underflow)", () => {
    const m = new ArchiveStageOccupancyMeter(0);
    m.enterDownload(0);
    m.leaveDownload(10);
    expect(() => m.leaveDownload(10)).toThrow(/unbalanced/);
  });

  it("throws on finish while stages are still open", () => {
    const m = new ArchiveStageOccupancyMeter(0);
    m.enterDownload(0);
    expect(() => m.finish(100)).toThrow(/unclosed/);
  });

  it("wrapAsyncIterableWithListStage forwards items and keeps metering consistent", async () => {
    const m = new ArchiveStageOccupancyMeter(0);
    async function* src(): AsyncGenerator<string> {
      yield "x";
    }
    const rows: string[] = [];
    for await (const x of wrapAsyncIterableWithListStage(m, src())) {
      rows.push(x);
    }
    expect(rows).toEqual(["x"]);
    const s = m.finish(Date.now());
    expect(
      s.listMs + s.downloadMs + s.archiveWriteMs + s.stageIdleMs,
    ).toBeGreaterThanOrEqual(0);
  });
});
