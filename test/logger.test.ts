import { describe, expect, it } from "vitest";
import pino from "pino";
import { resolveLogger } from "../src/logger.js";

describe("resolveLogger", () => {
  it("returns the same silent singleton when no override is passed", () => {
    expect(resolveLogger()).toBe(resolveLogger());
    expect(resolveLogger(undefined)).toBe(resolveLogger());
  });

  it("returns the caller logger when provided", () => {
    const custom = pino({ level: "fatal" });
    expect(resolveLogger(custom)).toBe(custom);
  });
});
