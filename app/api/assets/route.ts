import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ASSETS_ROOT = path.join(process.cwd(), "study-assets");

function getSafeAssetPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment && segment !== "..");

  if (segments[0] !== "study-assets" || segments.length < 2) {
    throw new Error("Ruta de asset invalida.");
  }

  return path.join(ASSETS_ROOT, ...segments.slice(1));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("file");
    const paths = formData.getAll("path");

    if (files.length !== paths.length) {
      return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relativePath = paths[index];

      if (!(file instanceof File) || typeof relativePath !== "string") {
        return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
      }

      const filePath = getSafeAssetPath(relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron guardar assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
