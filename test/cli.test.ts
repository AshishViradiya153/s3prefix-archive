import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function expectCliFailure(args: string[]): void {
  try {
    execFileSync(process.execPath, args, { encoding: "utf8" });
    expect.fail("expected non-zero exit");
  } catch (e: unknown) {
    const err = e as { status?: number };
    expect(err.status, "exit code").toBeDefined();
    expect(err.status).not.toBe(0);
  }
}

const cli = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "cli.js",
);

describe.skipIf(!existsSync(cli))("cli", () => {
  it("prints global --help", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], {
      encoding: "utf8",
    });
    expect(out).toContain("archive");
    expect(out).toContain("index");
    expect(out).toContain("benchmark");
  });

  it("prints archive subcommand help", () => {
    const out = execFileSync(process.execPath, [cli, "archive", "--help"], {
      encoding: "utf8",
    });
    expect(out).toContain("--source");
  });

  it("prints benchmark subcommand help", () => {
    const out = execFileSync(process.execPath, [cli, "benchmark", "--help"], {
      encoding: "utf8",
    });
    expect(out).toContain("--source");
    expect(out).toContain("--profile");
    expect(out).toContain("--json");
  });

  it("fails when archive is missing required --source", () => {
    expectCliFailure([cli, "archive"]);
  });

  it("fails when benchmark is missing required --source", () => {
    expectCliFailure([cli, "benchmark"]);
  });

  it("fails on invalid --format for archive", () => {
    expectCliFailure([
      cli,
      "archive",
      "--source",
      "s3://b/p/",
      "--format",
      "not-a-format",
    ]);
  });
});
