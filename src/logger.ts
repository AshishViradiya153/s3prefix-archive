import pino, { type Logger } from "pino";

/** Shared silent logger when no `logger` is passed (no I/O). */
const silentRoot: Logger = pino({ level: "silent" });

/** Default logger when `debug: true` and no `logger` is passed (JSON to stderr). */
let debugDefaultLogger: Logger | null = null;

function getDebugDefaultLogger(): Logger {
  debugDefaultLogger ??= pino({ level: "debug" });
  return debugDefaultLogger;
}

/**
 * Returns the caller-supplied Pino logger, or a shared silent logger.
 * Prefer passing your app root `logger.child({ module: "…" })` for structured context.
 */
export function resolveLogger(override?: Logger): Logger {
  return override ?? silentRoot;
}

/** Logger for archive/index flows: when `debug` is true, uses stderr JSON or a `debug`-level child. */
export function resolveArchiveLogger(opts: {
  logger?: Logger;
  debug?: boolean;
}): Logger {
  if (!opts.debug) {
    return resolveLogger(opts.logger);
  }
  if (opts.logger) {
    return opts.logger.child({ lib: "s3flow" }, { level: "debug" });
  }
  return getDebugDefaultLogger();
}

export type { Logger } from "pino";
