import { Writable } from "node:stream";

/** Writable that accepts archive bytes without storing them (for throughput timing). */
export function createBenchmarkDiscardWritable(): Writable {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
    writev(_chunks, cb) {
      cb();
    },
  });
}
