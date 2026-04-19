import { describe, expect, it } from "vitest";
import {
  classifyThroughputReadWritePace,
  DEFAULT_THROUGHPUT_READ_WRITE_RELATIVE_TOLERANCE,
} from "../src/archive-throughput.js";

describe("classifyThroughputReadWritePace", () => {
  it("default relative tolerance matches exported constant", () => {
    expect(DEFAULT_THROUGHPUT_READ_WRITE_RELATIVE_TOLERANCE).toBe(0.05);
  });

  it("returns balanced when rates match within relative tolerance", () => {
    expect(classifyThroughputReadWritePace(100, 100)).toBe("balanced");
    expect(classifyThroughputReadWritePace(100, 104)).toBe("balanced");
    // |106-100| = 6 > 5% * max(106,100) = 5.3 → outside band; read < write ⇒ write-faster
    expect(classifyThroughputReadWritePace(100, 106)).toBe("write-faster");
    expect(classifyThroughputReadWritePace(106, 100)).toBe("read-faster");
  });

  it("returns read-faster when read dominates", () => {
    expect(classifyThroughputReadWritePace(200, 50)).toBe("read-faster");
  });

  it("returns write-faster when write dominates", () => {
    expect(classifyThroughputReadWritePace(50, 200)).toBe("write-faster");
  });

  it("treats both tiny rates as balanced", () => {
    expect(classifyThroughputReadWritePace(0, 0)).toBe("balanced");
  });
});
