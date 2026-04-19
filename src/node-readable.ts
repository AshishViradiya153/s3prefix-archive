import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { S3ArchiveError } from "./errors.js";

/** `GetObject` output body type from the AWS SDK (for tests and adapters). */
export type GetObjectBodyInput = GetObjectCommandOutput["Body"];

type GetObjectBody = GetObjectBodyInput;

function isNodeReadableStream(x: object): x is Readable {
  return (
    typeof (x as Readable).pipe === "function" &&
    typeof (x as Readable).read === "function"
  );
}

function isWebReadableStream(
  body: object,
): body is WebReadableStream<Uint8Array> {
  return (
    typeof (body as WebReadableStream<Uint8Array>).getReader === "function"
  );
}

/**
 * AWS SDK v3 may type `GetObject` `Body` as a web `ReadableStream` or a Node `Readable`.
 * Archiver / tar-stream expect Node streams — normalize here once.
 */
export function toNodeReadable(body: GetObjectBody, context: string): Readable {
  if (body == null) {
    throw new S3ArchiveError(
      `S3 GetObject returned empty Body (${context})`,
      "GET_OBJECT_EMPTY_BODY",
      {
        phase: "getObject",
        context: { context },
      },
    );
  }
  if (typeof body === "object" && isNodeReadableStream(body)) {
    return body;
  }
  if (typeof body === "object" && isWebReadableStream(body)) {
    return Readable.fromWeb(body);
  }
  throw new S3ArchiveError(
    `S3 GetObject Body has unsupported type (${context})`,
    "GET_OBJECT_BODY_UNSUPPORTED",
    {
      phase: "getObject",
      context: { context, typeofBody: typeof body },
    },
  );
}
