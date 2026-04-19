/**
 * Stream a ZIP as an HTTP attachment without buffering the whole archive in RAM.
 * Uses Node's built-in `http` module (no Express dependency).
 *
 * Environment: `SOURCE_URI`, `PORT` (default `3000`).
 */
import http from "node:http";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createFolderArchiveStream,
  suggestedCacheControlForArchiveDownload,
} from "s3flow";

function main(): void {
  const source = process.env.SOURCE_URI;
  if (!source) {
    throw new Error("Set SOURCE_URI");
  }

  const client = new S3Client({});
  const port = Number(process.env.PORT ?? 3000);

  const server = http.createServer((req, res) => {
    if (req.url !== "/export.zip") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="export.zip"');
    res.setHeader(
      "Cache-Control",
      suggestedCacheControlForArchiveDownload({ maxAgeSeconds: 3600 }),
    );

    const stream = createFolderArchiveStream({
      source,
      format: "zip",
      client,
    });

    stream.on("error", (err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end(err instanceof Error ? err.message : String(err));
    });

    stream.pipe(res);
  });

  server.listen(port, () => {
    console.error(`GET http://127.0.0.1:${port}/export.zip`);
  });
}

main();
