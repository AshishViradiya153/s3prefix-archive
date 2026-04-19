import { describe, expect, it } from "vitest";
import pino from "pino";
import { resolveArchiveLogger, resolveLogger } from "../src/logger.js";

describe("resolveArchiveLogger", () => {
  it("matches resolveLogger when debug is false or omitted", () => {
    expect(resolveArchiveLogger({})).toBe(resolveLogger());
    expect(resolveArchiveLogger({ debug: false })).toBe(resolveLogger());
  });

  it("returns the same default debug logger when debug without custom logger", () => {
    const a = resolveArchiveLogger({ debug: true });
    const b = resolveArchiveLogger({ debug: true });
    expect(a).toBe(b);
    expect(a.isLevelEnabled("debug")).toBe(true);
  });

  it("forces debug on a child when debug is true with a custom logger", () => {
    const parent = pino({ level: "info" });
    const child = resolveArchiveLogger({ debug: true, logger: parent });
    expect(child.isLevelEnabled("debug")).toBe(true);
  });

  it("enables debug when parent is the shared silent logger", () => {
    const silent = resolveLogger();
    const child = resolveArchiveLogger({ debug: true, logger: silent });
    expect(child.isLevelEnabled("debug")).toBe(true);
  });
});
