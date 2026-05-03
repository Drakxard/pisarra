import { NextResponse } from "next/server";
import { putAsset } from "@/lib/server/r2-assets";

export const runtime = "nodejs";

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

      await putAsset({
        assetPath: relativePath,
        body: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || undefined,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron guardar assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
