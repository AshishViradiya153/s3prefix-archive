/**
 * Archive from **Azure Blob Storage** using `AzureBlobStorageProvider`.
 * `source` uses `s3://container/prefix/` as a stand-in bucket segment (parser only).
 *
 * Install peer: `npm install @azure/storage-blob`
 * Environment: `AZURE_STORAGE_CONNECTION_STRING`, `CONTAINER_NAME`, optional `PREFIX`, `OUT_PATH`
 */
import { createWriteStream } from "node:fs";
import { BlobServiceClient } from "@azure/storage-blob";
import { createFolderArchiveStream } from "s3-archive-download";
import { AzureBlobStorageProvider } from "s3-archive-download/azure-blob";

async function main(): Promise<void> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.CONTAINER_NAME;
  const prefix = process.env.PREFIX ?? "";
  const outPath = process.env.OUT_PATH ?? "./out-azure.zip";
  if (!conn || !containerName) {
    throw new Error("Set AZURE_STORAGE_CONNECTION_STRING and CONTAINER_NAME");
  }

  const blobService = BlobServiceClient.fromConnectionString(conn);
  const container = blobService.getContainerClient(containerName);
  const storageProvider = new AzureBlobStorageProvider(container);

  const source = `s3://${containerName}/${prefix}`;
  const out = createWriteStream(outPath);
  const stream = createFolderArchiveStream({
    source,
    format: "zip",
    storageProvider,
  });

  await new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    stream.on("error", reject);
    out.on("finish", () => resolve());
    stream.pipe(out);
  });

  console.log("wrote", outPath);
}

void main();
