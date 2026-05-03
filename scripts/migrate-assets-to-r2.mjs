import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const ASSETS_PREFIX = "study-assets";
const LOCAL_ASSETS_ROOT = path.join(process.cwd(), ASSETS_PREFIX);
const MIME_TYPES = {
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function loadLocalEnv() {
  try {
    const raw = await readFile(".env.local", "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} no esta configurada.`);
  }

  return value;
}

function getContentType(assetPath) {
  return MIME_TYPES[path.extname(assetPath).toLowerCase()] ?? "application/octet-stream";
}

async function collectFiles(directory, prefix = ASSETS_PREFIX) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      const assetPath = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        return collectFiles(absolutePath, assetPath);
      }

      if (entry.isFile()) {
        return [{ assetPath, absolutePath }];
      }

      return [];
    }),
  );

  return files.flat();
}

await loadLocalEnv();

const endpoint = requireEnv("R2_ENDPOINT");
const bucket = requireEnv("R2_BUCKET_NAME");
const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});
const files = await collectFiles(LOCAL_ASSETS_ROOT);

for (const file of files) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.assetPath,
      Body: createReadStream(file.absolutePath),
      ContentType: getContentType(file.assetPath),
    }),
  );
  console.log(`Subido ${file.assetPath}`);
}

console.log(`Migracion R2 completa: ${files.length} archivo(s).`);
