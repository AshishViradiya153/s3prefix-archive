import { defineConfig } from "tsup";

/** Set `SOURCEMAP=false` for release builds (smaller published tarball). Default: emit maps. */
const sourcemap = process.env.SOURCEMAP !== "false";

const cliExternal = [
  "commander",
  "cli-progress",
  "prom-client",
  "@aws-sdk/client-s3",
  "@aws-sdk/lib-storage",
  "yazl",
  "mime-types",
  "p-limit",
  "p-retry",
  "pino",
  "tar-stream",
  "./index.js",
] as const;

const cloudStorageExternal = [
  "@google-cloud/storage",
  "@azure/storage-blob",
] as const;

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      platform: "src/platform.ts",
      bullmq: "src/bullmq.ts",
      gcs: "src/gcs.ts",
      "azure-blob": "src/azure-blob.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap,
    clean: true,
    treeshake: true,
    target: "node18",
    external: [...cloudStorageExternal],
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    outDir: "dist",
    clean: false,
    dts: false,
    sourcemap,
    treeshake: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: [...cliExternal],
  },
]);
