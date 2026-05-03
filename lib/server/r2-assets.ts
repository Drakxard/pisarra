import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { PutObjectCommandInput } from "@aws-sdk/client-s3";

const ASSETS_PREFIX = "study-assets";
const LOCAL_ASSETS_ROOT = path.join(process.cwd(), ASSETS_PREFIX);
const MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

let client: S3Client | null = null;

function requireR2Env() {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Faltan variables R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY.");
  }

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

function getR2Client() {
  const env = requireR2Env();

  client ??= new S3Client({
    region: "auto",
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    forcePathStyle: true,
  });

  return client;
}

function getBucketName() {
  return requireR2Env().bucket;
}

export function getAssetContentType(assetPath: string) {
  return MIME_TYPES[path.extname(assetPath).toLowerCase()] ?? "application/octet-stream";
}

export function normalizeAssetKey(assetPath: string) {
  const normalized = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment && segment !== "..");

  if (segments[0] !== ASSETS_PREFIX || segments.length < 2) {
    throw new Error("Ruta de asset invalida.");
  }

  return segments.join("/");
}

export function getLocalAssetPath(assetKey: string) {
  const normalizedKey = normalizeAssetKey(assetKey);
  const relativePath = normalizedKey.slice(`${ASSETS_PREFIX}/`.length);

  return path.join(LOCAL_ASSETS_ROOT, ...relativePath.split("/"));
}

export async function putAsset({
  assetPath,
  body,
  contentType,
}: {
  assetPath: string;
  body: PutObjectCommandInput["Body"];
  contentType?: string;
}) {
  const key = normalizeAssetKey(assetPath);

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType ?? getAssetContentType(key),
    }),
  );

  return key;
}

export async function getAsset(assetPath: string) {
  const key = normalizeAssetKey(assetPath);

  try {
    const response = await getR2Client().send(
      new GetObjectCommand({
        Bucket: getBucketName(),
        Key: key,
      }),
    );

    if (!response.Body) {
      return null;
    }

    return {
      key,
      body: response.Body.transformToWebStream(),
      contentType: response.ContentType ?? getAssetContentType(key),
    };
  } catch (error) {
    if (
      error instanceof NoSuchKey ||
      (error instanceof S3ServiceException && (error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404))
    ) {
      return null;
    }

    throw error;
  }
}

async function collectLocalAssetFiles(directory: string, prefix = ASSETS_PREFIX): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      const assetPath = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        return collectLocalAssetFiles(absolutePath, assetPath);
      }

      if (entry.isFile()) {
        return [assetPath];
      }

      return [];
    }),
  );

  return files.flat();
}

export async function uploadLocalStudyAssets() {
  const assetPaths = await collectLocalAssetFiles(LOCAL_ASSETS_ROOT);
  const uploaded: string[] = [];

  for (const assetPath of assetPaths) {
    const localPath = getLocalAssetPath(assetPath);

    await putAsset({
      assetPath,
      body: createReadStream(localPath),
      contentType: getAssetContentType(assetPath),
    });
    uploaded.push(assetPath);
  }

  return uploaded;
}

export async function readLocalAssetFallback(assetPath: string) {
  const localPath = getLocalAssetPath(assetPath);

  return {
    body: await readFile(localPath),
    contentType: getAssetContentType(localPath),
  };
}
